import { createHash } from 'node:crypto';
import { execAgentFile } from './invocation.js';
import { AGENT_DEFS } from './registry.js';
import {
  DEFAULT_MODEL_OPTION,
  getRememberedLiveModels,
  mergeFallbackModelMetadata,
  rememberLiveModels,
} from './models.js';
import { applyAgentLaunchEnvAsync as applyAgentLaunchEnv, resolveAgentLaunchAsync as resolveAgentLaunch } from './launch.js';
import { spawnEnvForAgentAsync as spawnEnvForAgent } from './env.js';
import { probeAgentAuthStatus } from './auth.js';
import { agentCapabilities } from './capabilities.js';
import { installMetaForAgent } from './metadata.js';
import { vendorSignInWithoutCli } from './vendor-sign-in.js';
import {
  forgetUnusableExecutables,
  rememberUnusableExecutable,
} from './executables.js';
import {
  buildAuthDiagnostic,
  buildExecutableDiagnosticAsync as buildExecutableDiagnostic,
  buildNotInvocableDiagnostic,
  type NotInvocableCause,
} from './diagnostics.js';
import type {
  AgentDiagnostic,
  DetectedAgent,
  RuntimeAgentDef,
  RuntimeCapabilityMap,
  RuntimeModelSource,
  RuntimeModelOption,
} from './types.js';
import { usesBundledOpenCode } from './byok-opencode.js';

type FetchedRuntimeModels = {
  models: RuntimeModelOption[];
  source: RuntimeModelSource;
};

export interface DetectedRuntimeVersions {
  /** The configured executable successfully spawned, independent of version parsing. */
  invocable: true;
  agentCliVersion?: string;
}

// Detection already pays the bounded `--version` probe cost used by Settings.
// Keep known versions as daemon-lifetime provenance. Missing versions expire
// so a transient probe failure cannot permanently disable version-gated features.
const detectedRuntimeVersions = new Map<string, DetectedRuntimeVersions>();
const detectedRuntimeVersionScopes = new Map<string, string>();
const missingRuntimeVersionRetryAt = new Map<string, number>();
const MISSING_RUNTIME_VERSION_TTL_MS = 5_000;
const detectedRuntimeVersionProbes = new Map<
  string,
  Promise<DetectedRuntimeVersions | null>
>();
const detectedRuntimeCapabilityScopes = new Map<string, string>();
const detectedRuntimeCapabilityProbes = new Map<
  string,
  Promise<RuntimeCapabilityMap | null>
>();
const detectedReadinessAuth = new Map<string, { scope: string; status: 'ok' | 'missing' | 'unknown' }>();

type AgentDetectionSnapshot = {
  scope: string;
  pending?: Promise<DetectedAgent>;
  agent?: DetectedAgent;
  expiresAt: number;
};
const agentDetectionSnapshots = new WeakMap<RuntimeAgentDef, AgentDetectionSnapshot>();
const DETECTION_TTL_MS = 30_000;
// Probe discovery and sandbox inputs affect detection; host ports and other
// runtime metadata can change after startup warming without changing a CLI.
const DETECTION_INHERITED_PIXO_ENV_KEYS = new Set([
  'PIXO_AGENT_HOME',
  'PIXO_DATA_DIR',
  'PIXO_RESOURCE_ROOT',
  'PIXO_SANDBOX_MODE',
  'PIXO_SANDBOX_IMPORT_ALLOWED_ROOTS',
  'PIXO_AGENT_PROFILES_CONFIG',
]);

function detectionEnvironmentScope(def: RuntimeAgentDef, configuredEnv: Record<string, string>): string {
  const sorted = (env: NodeJS.ProcessEnv): Array<[string, string | undefined]> =>
    Object.entries(env).sort(([a], [b]) => a.localeCompare(b));
  const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => {
    const upper = key.toUpperCase();
    return !upper.startsWith('PIXO_') || DETECTION_INHERITED_PIXO_ENV_KEYS.has(upper)
      || upper.startsWith('PIXO_CODEX_');
  }));
  return createHash('sha256').update(JSON.stringify([
    sorted(inheritedEnv), sorted(def.env ?? {}), sorted(configuredEnv),
  ])).digest('hex');
}

// How many unusable binaries detection will walk past before giving up on an
// agent. Each attempt costs one bounded `--version` spawn, and the healthy
// case stops at the first candidate, so this only bounds the pathological
// shape: the same CLI name shadowed in many search directories at once.
const MAX_EXECUTABLE_ATTEMPTS = 8;

function rememberRuntimeVersions(agentId: string, scope: string, versions: DetectedRuntimeVersions): void {
  detectedRuntimeVersions.set(agentId, versions);
  detectedRuntimeVersionScopes.set(agentId, scope);
  if (versions.agentCliVersion) missingRuntimeVersionRetryAt.delete(agentId);
  else missingRuntimeVersionRetryAt.set(agentId, Date.now() + MISSING_RUNTIME_VERSION_TTL_MS);
}

export function getDetectedRuntimeVersions(
  agentId: string | null | undefined,
): DetectedRuntimeVersions | null {
  if (!agentId) return null;
  const remembered = detectedRuntimeVersions.get(agentId);
  return remembered ? { ...remembered } : null;
}

/**
 * Resolve exact runtime provenance for one selected agent without requiring a
 * prior Settings or `/api/agents` request to have warmed the daemon cache.
 *
 * Run admission uses this at its capability boundary. The cache remains the normal
 * fast path; after a daemon restart, the selected CLI is probed once through
 * the same bounded detection path used by the agent picker. A successfully
 * spawned probe remains non-null even when version output is
 * unavailable; only a non-invocable runtime stays null.
 */
export async function ensureDetectedRuntimeVersions(
  agentId: string | null | undefined,
  configuredAgentEnv: Record<string, string> = {},
): Promise<DetectedRuntimeVersions | null> {
  if (!agentId) return null;
  const def = AGENT_DEFS.find((candidate) => candidate.id === agentId);
  if (!def) return null;
  const context = await runtimeVersionProbeContext(def, configuredAgentEnv);
  if (!context) return null;
  const remembered = getDetectedRuntimeVersions(agentId);
  if (
    remembered
    && detectedRuntimeVersionScopes.get(agentId) === context.scope
    && (remembered.agentCliVersion || Date.now() < (missingRuntimeVersionRetryAt.get(agentId) ?? 0))
  ) {
    return remembered;
  }
  const probeKey = `${agentId}:${context.scope}`;
  const existing = detectedRuntimeVersionProbes.get(probeKey);
  if (existing) return existing;
  const probe = probeRuntimeVersionsOnly(def, context);
  detectedRuntimeVersionProbes.set(probeKey, probe);
  try {
    return await probe;
  } finally {
    if (detectedRuntimeVersionProbes.get(probeKey) === probe) {
      detectedRuntimeVersionProbes.delete(probeKey);
    }
  }
}

/**
 * Resolve the advertised `--help` capability flags for one selected agent
 * without requiring a prior Settings or `/api/agents` request to have warmed
 * `agentCapabilities`.
 *
 * `ensureDetectedRuntimeVersions` deliberately probes only `--version`, so an
 * admission path that never ran full detection sees an empty capability map
 * and cannot tell "this CLI does not advertise the flag" apart from "nobody
 * asked the CLI yet". Callers that gate behaviour on an advertised flag must
 * establish the answer through this probe first; it reuses the same bounded
 * `--help` read and the same `agentCapabilities` cache as full detection.
 *
 * Returns null only when the runtime is not resolvable or declares no
 * capability metadata; a CLI whose `--help` simply omits every known flag
 * resolves to a populated map of `false` values.
 */
export async function ensureDetectedRuntimeCapabilities(
  agentId: string | null | undefined,
  configuredAgentEnv: Record<string, string> = {},
): Promise<RuntimeCapabilityMap | null> {
  if (!agentId) return null;
  const def = AGENT_DEFS.find((candidate) => candidate.id === agentId);
  if (!def) return null;
  const context = await runtimeVersionProbeContext(def, configuredAgentEnv);
  if (!context) return null;
  const remembered = agentCapabilities.get(agentId);
  if (
    remembered
    && detectedRuntimeCapabilityScopes.get(agentId) === context.scope
  ) {
    return { ...remembered };
  }
  const probeKey = `${agentId}:${context.scope}`;
  const existing = detectedRuntimeCapabilityProbes.get(probeKey);
  if (existing) return existing;
  const probe = probeCapabilities(def, context.launchPath, context.probeEnv)
    .then((caps) => {
      if (caps) {
        agentCapabilities.set(def.id, caps);
        detectedRuntimeCapabilityScopes.set(def.id, context.scope);
      }
      return caps ? { ...caps } : null;
    });
  detectedRuntimeCapabilityProbes.set(probeKey, probe);
  try {
    return await probe;
  } finally {
    if (detectedRuntimeCapabilityProbes.get(probeKey) === probe) {
      detectedRuntimeCapabilityProbes.delete(probeKey);
    }
  }
}

function configuredEnvForAgent(
  configuredEnvByAgent: Record<string, Record<string, string>>,
  agentId: string,
): Record<string, string> {
  const configAgentId = usesBundledOpenCode(agentId) ? 'opencode' : agentId;
  return configuredEnvByAgent?.[configAgentId] ?? {};
}


async function fetchModels(
  def: RuntimeAgentDef,
  resolvedBin: string,
  env: NodeJS.ProcessEnv,
): Promise<FetchedRuntimeModels> {
  if (typeof def.fetchModels === 'function') {
    try {
      const parsed = await def.fetchModels(resolvedBin, env);
      if (!parsed || parsed.length === 0) {
        return { models: def.fallbackModels, source: 'fallback' };
      }
      return { models: mergeFallbackModelMetadata(def, parsed), source: 'live' };
    } catch {
      return { models: def.fallbackModels, source: 'fallback' };
    }
  }
  if (!def.listModels) {
    return { models: def.fallbackModels, source: 'fallback' };
  }
  try {
    const { stdout } = await execAgentFile(resolvedBin, def.listModels.args, {
      env,
      timeout: def.listModels.timeoutMs ?? 5000,
      // Models lists from popular CLIs (e.g. opencode) easily exceed the
      // default 1MB buffer once you include every openrouter model. Bump
      // it so we don't truncate the listing.
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = def.listModels.parse(String(stdout));
    // Empty / null parse result means the CLI didn't actually return a
    // usable list; fall back
    // to the static hint so the picker isn't stuck on Default-only.
    if (!parsed || parsed.length === 0) {
      return { models: def.fallbackModels, source: 'fallback' };
    }
    return { models: mergeFallbackModelMetadata(def, parsed), source: 'live' };
  } catch {
    return { models: def.fallbackModels, source: 'fallback' };
  }
}

export type VersionProbeOutcome =
  | { kind: 'not-invocable'; cause: NotInvocableCause }
  | { kind: 'spawned'; version: string | null };

// cmd.exe's equivalent of POSIX 127 ("command not found").
const WINDOWS_COMMAND_NOT_FOUND_EXIT = 9009;

// Evidence that the *launcher* never reached the program it stands for, as
// opposed to the program running and reporting its own failure.
//
// Exit status alone cannot make this call on Windows. A global npm wrapper is
// a `.CMD`, which OpenPixo runs through `cmd.exe /d /s /c`; when the package
// behind it has been uninstalled, cmd.exe starts, node starts, and only then
// does node fail to load the script the wrapper names — a plain exit 1 with
// MODULE_NOT_FOUND on stderr. Nothing along that chain failed to *start*, so
// none of the POSIX signals (ENOENT, 126, 127) ever appear, and the wrapper
// looks indistinguishable from a healthy CLI that dislikes `--version`.
//
// So match the launcher's own vocabulary instead, and only that: node's
// missing-module report, and cmd.exe / PowerShell's missing-command and
// missing-path reports. A non-zero exit on its own stays a real answer from
// the right binary — otherwise a CLI that merely rejects its arguments would
// be abandoned in favour of some other install of itself.
//
// `isCliNotInstalledText` in run-failure-classification.ts reads similar
// output, and the overlap is deliberate rather than shared: it buckets a
// finished run for telemetry, where over-matching costs a mislabelled event,
// while this decides whether to abandon a binary mid-resolution, where
// over-matching sends a working CLI's user to a different install. It carries
// broader phrases ("not installed", "not on PATH") that must not leak in here.
const LAUNCHER_TARGET_MISSING_PATTERNS = [
  /\bMODULE_NOT_FOUND\b/,
  /\bCannot find module\b/i,
  /is not recognized as (?:an internal or external command|the name of a cmdlet)/i,
  /\bCommandNotFoundException\b/,
  /The system cannot find the (?:path|file) specified/i,
];

function launcherTargetMissing(err: unknown): boolean {
  const stderr = (err as { stderr?: unknown })?.stderr;
  if (typeof stderr !== 'string' || stderr.length === 0) return false;
  return LAUNCHER_TARGET_MISSING_PATTERNS.some((pattern) => pattern.test(stderr));
}

/**
 * Classify a rejected `--version` probe. There are two distinct failure modes
 * to discriminate:
 *
 *   - **Not invocable.** The OS rejected the spawn outright, OR the
 *     wrapper script spawned but its underlying interpreter / target
 *     failed. We split permission failures (EACCES / exit 126) from
 *     missing-target failures (ENOENT / ENOTDIR / exit 127 / cmd.exe's 9009,
 *     plus the launcher stderr Windows wrappers report instead) so Settings
 *     can offer permission-specific copy instead of treating every failure as
 *     a broken shim. We still mark the agent unavailable so Settings does not
 *     advertise a ghost entry (issue #658, lefarcen review P2 on PR #1301).
 *
 *   - **Spawned but `--version` was unhappy.** The binary itself ran
 *     (any other rejection: timeout, generic non-zero exit, stderr
 *     noise) so the CLI is invocable; we just can't read a version
 *     string. Adapters whose `--version` flag is unsupported land
 *     here and must keep working with `version: null`.
 *
 * `child_process.execFile` reports OS-level rejections with a string
 * `err.code` (`'ENOENT'`, `'EACCES'`, `'ENOTDIR'`) and non-zero exit
 * codes with a *numeric* `err.code` equal to the exit status, so those
 * two arms are unambiguous. Windows wrappers are the case they cannot
 * decide on their own — see `launcherTargetMissing` above.
 *
 * Exported because half of what it decides cannot be reached from a test that
 * spawns a fixture. `9009` and cmd.exe / PowerShell's wording only ever come
 * from a real Windows launcher, and POSIX masks exit statuses to 8 bits, so a
 * shell asked for 9009 reports 49. Since the daemon suite runs on Linux in CI,
 * driving this directly is the only way the merge gate can catch a regression
 * in a signature the Windows fix depends on.
 */
export function classifyVersionProbeFailure(err: unknown): VersionProbeOutcome {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (typeof code === 'string') {
    if (code === 'EACCES') {
      return { kind: 'not-invocable', cause: 'not-executable' };
    }
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { kind: 'not-invocable', cause: 'missing-target' };
    }
  } else if (typeof code === 'number') {
    if (code === 126) {
      return { kind: 'not-invocable', cause: 'not-executable' };
    }
    // 127 is the POSIX shell's "command not found"; 9009 is cmd.exe's.
    if (code === 127 || code === WINDOWS_COMMAND_NOT_FOUND_EXIT) {
      return { kind: 'not-invocable', cause: 'missing-target' };
    }
    if (launcherTargetMissing(err)) {
      return { kind: 'not-invocable', cause: 'missing-target' };
    }
  }
  return { kind: 'spawned', version: null };
}

/** Run the agent's `--version` probe and classify the result. */
async function probeVersionAtPath(
  def: RuntimeAgentDef,
  resolved: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 3000,
  reportTimeout = false,
): Promise<VersionProbeOutcome> {
  try {
    const { stdout } = await execAgentFile(resolved, def.versionArgs, {
      env,
      timeout: timeoutMs,
    });
    const rawVersion = String(stdout).trim().split('\n')[0]?.trim() || null;
    return { kind: 'spawned', version: rawVersion };
  } catch (err) {
    if (reportTimeout && (err as { killed?: boolean })?.killed) throw new ReadinessProbeTimeout();
    return classifyVersionProbeFailure(err);
  }
}

type RuntimeVersionProbeContext = {
  selectedPath: string;
  launchPath: string;
  probeEnv: NodeJS.ProcessEnv;
  scope: string;
};

async function runtimeVersionProbeContext(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string>,
  skipPathCandidates: string[] = [],
): Promise<RuntimeVersionProbeContext | null> {
  const launch = await resolveAgentLaunch(def, configuredEnv, { skipPathCandidates });
  if (!launch.selectedPath || !launch.launchPath) return null;
  const probeEnv = await applyAgentLaunchEnv(
    await spawnEnvForAgent(
      def.id,
      {
        ...process.env,
        ...(def.env || {}),
      },
      configuredEnv,
      undefined,
      { resolvedBin: launch.selectedPath },
    ),
    launch,
  );
  return {
    selectedPath: launch.selectedPath,
    launchPath: launch.launchPath,
    probeEnv,
    scope: createHash('sha256').update(JSON.stringify({
      agentId: def.id,
      selectedPath: launch.selectedPath,
      launchPath: launch.launchPath,
    })).digest('hex'),
  };
}

function readinessAuthScope(context: RuntimeVersionProbeContext): string {
  return createHash('sha256').update(context.scope).update(JSON.stringify(context.probeEnv)).digest('hex');
}

class ReadinessProbeTimeout extends Error {}

export interface AgentReadiness {
  id: string;
  name: string;
  available: boolean;
  version?: string | null;
  authStatus?: 'ok' | 'missing' | 'unknown';
  installUrl?: string;
  probeError?: 'timeout' | 'failed';
}

/**
 * The same executable/version authority as normal detection, restricted to
 * local --version reads. No model-list, capability or authentication commands
 * run here; auth is reused only when full detection already knows this exact
 * executable/environment. Each agent has one short total process budget.
 */
export async function detectAgentReadiness(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
  timeoutMs = 1_500,
): Promise<AgentReadiness> {
  const base: AgentReadiness = { id: def.id, name: def.name, available: false,
    ...installMetaForAgent(def.id, configuredEnv) };
  const deadline = Date.now() + timeoutMs;
  const attempted: string[] = [];
  try {
    for (let attempt = 0; attempt < MAX_EXECUTABLE_ATTEMPTS; attempt++) {
      const context = await runtimeVersionProbeContext(def, configuredEnv, attempted);
      if (!context || attempted.includes(context.selectedPath)) return base;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ReadinessProbeTimeout();
      const outcome = await probeVersionAtPath(def, context.launchPath, context.probeEnv, remaining, true);
      if (outcome.kind === 'not-invocable') { attempted.push(context.selectedPath); continue; }
      const knownAuth = detectedReadinessAuth.get(def.id);
      const authStatus = knownAuth?.scope === readinessAuthScope(context) ? knownAuth.status
        : def.authProbe ? 'unknown' : undefined;
      return { ...base, available: true, version: outcome.version,
        ...(authStatus ? { authStatus } : {}) };
    }
    return base;
  } catch (error) {
    return { ...base, probeError: error instanceof ReadinessProbeTimeout ? 'timeout' : 'failed' };
  }
}

export async function detectAgentsReadiness(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
  timeoutMs = 1_500,
): Promise<AgentReadiness[]> {
  return Promise.all(AGENT_DEFS.filter(def => ['codex', 'claude', 'opencode'].includes(def.id))
    .map(def => detectAgentReadiness(def, configuredEnvForAgent(configuredEnvByAgent, def.id), timeoutMs)));
}

async function probeRuntimeVersionsOnly(
  def: RuntimeAgentDef,
  context: RuntimeVersionProbeContext,
): Promise<DetectedRuntimeVersions | null> {
  const outcome = await probeVersionAtPath(def, context.launchPath, context.probeEnv);
  if (outcome.kind !== 'spawned') return null;
  const versions: DetectedRuntimeVersions = {
    invocable: true,
    ...(outcome.version ? { agentCliVersion: outcome.version } : {}),
  };
  rememberRuntimeVersions(def.id, context.scope, versions);
  return { ...versions };
}

function unavailableAgent(
  def: RuntimeAgentDef,
  diagnostics: AgentDiagnostic[] = [],
  detected?: { path?: string; version?: string | null },
  configuredEnv: Record<string, string> = {},
): DetectedAgent {
  return {
    ...stripFns(def),
    models: def.fallbackModels ?? [DEFAULT_MODEL_OPTION],
    modelsSource: 'fallback',
    available: false,
    ...(detected?.path ? { path: detected.path } : {}),
    ...(detected && 'version' in detected ? { version: detected.version ?? null } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...installMetaForAgent(def.id, configuredEnv),
    ...(vendorSignInWithoutCli(def.id, configuredEnv) ? { vendorSignInWithoutCli: true as const } : {}),
  };
}

// Probe the agent's `--help` once and record which advertised flags the
// installed CLI supports, so buildArgs can consult the cache. Extracted from
// the main probe so it can run concurrently with model + auth probing instead
// of blocking them. Returns the capability map (or null when the agent
// declares no help/capability metadata or the probe failed).
async function probeCapabilities(
  def: RuntimeAgentDef,
  launchPath: string,
  env: NodeJS.ProcessEnv,
): Promise<RuntimeCapabilityMap | null> {
  if (!def.helpArgs || !def.capabilityFlags) return null;
  try {
    const { stdout, stderr } = await execAgentFile(launchPath, def.helpArgs, {
      env,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    // Scan BOTH streams. Which one carries `--help` is a per-CLI accident of the
    // arg parser: OpenCode writes its entire help to stderr and leaves stdout
    // empty, so a stdout-only scan silently resolved every one of its flags to
    // `false`. That made the whole capability mechanism dead for OpenCode —
    // `--dangerously-skip-permissions` was never appended even on builds that
    // support it, and `--dir` (which pins the workspace to the project so the
    // agent stops adopting the enclosing git root) never applied either.
    const help = `${String(stdout)}\n${String(stderr)}`;
    const caps: RuntimeCapabilityMap = {};
    for (const [flag, key] of Object.entries(def.capabilityFlags)) {
      caps[key] = help.includes(flag);
    }
    return caps;
  } catch {
    // If --help fails, leave caps empty so buildArgs falls back to the safe
    // baseline (no optional flags).
    return {};
  }
}

// A value no option can legitimately accept, so the CLI is forced to validate
// the flag before it does any work.
const HIDDEN_FLAG_PROBE_VALUE = '__pixo_capability_probe__';

/**
 * Detect flags the CLI accepts but leaves out of `--help`.
 *
 * Argument parsers reject an unrecognised *option* ("unknown option '--x'")
 * differently from a recognised option carrying an unusable *value*
 * ("option '--x <v>' argument '…' is invalid…"). Both exit non-zero before the
 * agent contacts a model, so this costs one spawn and no tokens.
 *
 * Support is only recorded on positive evidence — the failure text has to name
 * the flag and must not be an unknown-option complaint. A timeout, a missing
 * binary, or any wording this probe does not recognise leaves the capability
 * false, so `buildArgs` keeps the flag off rather than risking a spawn that
 * dies on an unknown option.
 */
async function probeHiddenCapabilityFlags(
  def: RuntimeAgentDef,
  launchPath: string,
  env: NodeJS.ProcessEnv,
): Promise<RuntimeCapabilityMap> {
  const spec = def.hiddenCapabilityFlags;
  if (!spec) return {};
  const caps: RuntimeCapabilityMap = {};
  await Promise.all(
    Object.entries(spec.flags).map(async ([flag, key]) => {
      let output = '';
      try {
        const { stdout, stderr } = await execAgentFile(
          launchPath,
          [...spec.probeArgsPrefix, flag, HIDDEN_FLAG_PROBE_VALUE],
          { env, timeout: 5000, maxBuffer: 1024 * 1024 },
        );
        output = `${stdout ?? ''}\n${stderr ?? ''}`;
      } catch (error) {
        const failure = error as { stdout?: unknown; stderr?: unknown };
        const out = typeof failure?.stdout === 'string' ? failure.stdout : '';
        const err = typeof failure?.stderr === 'string' ? failure.stderr : '';
        output = `${out}\n${err}`;
      }
      caps[key] = output.includes(flag) && !output.includes('unknown option');
    }),
  );
  return caps;
}

async function probe(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string>,
  isCurrent: () => boolean,
): Promise<DetectedAgent> {
  detectedRuntimeVersions.delete(def.id);
  missingRuntimeVersionRetryAt.delete(def.id);
  // Forget what a previous pass proved unusable before re-probing: a rescan
  // after the user repairs or reinstalls a CLI must not keep skipping it.
  forgetUnusableExecutables(def.id);
  // Detection must probe the exact path the runtime will spawn, not just the
  // PATH-visible shim. This is load-bearing for Codex under nvm/fnm/mise:
  // the discovered `codex` entry is often a `#!/usr/bin/env node` wrapper
  // that is not invocable from a GUI-launched app's stripped PATH, while the
  // launch resolver can still upgrade it to the packaged native Codex binary.
  // If detection probes the shim but chat/run spawns the native binary, the
  // UI incorrectly reports "not installed" until the user pins CODEX_BIN by
  // hand even though the real launch path is healthy.
  const initialLaunch = await resolveAgentLaunch(def, configuredEnv);
  if (!initialLaunch.selectedPath || !initialLaunch.launchPath) {
    return unavailableAgent(def, [await buildExecutableDiagnostic(def, configuredEnv)], undefined, configuredEnv);
  }
  // Carry the narrowed pair explicitly: the candidate walk below reassigns
  // this binding, which would otherwise discard the null-check above and
  // force every downstream reader to re-prove the paths are present.
  type ProbedLaunch = Awaited<ReturnType<typeof resolveAgentLaunch>> & {
    selectedPath: string;
    launchPath: string;
  };
  let launch: ProbedLaunch = {
    ...initialLaunch,
    selectedPath: initialLaunch.selectedPath,
    launchPath: initialLaunch.launchPath,
  };
  let probeEnv = await applyAgentLaunchEnv(
    await spawnEnvForAgent(
      def.id,
      {
        ...process.env,
        ...(def.env || {}),
      },
      configuredEnv,
      undefined,
      { resolvedBin: launch.selectedPath },
    ),
    launch,
  );
  let outcome = await probeVersionAtPath(def, launch.launchPath, probeEnv);
  // Resolving a name on PATH only proves a file exists there, never that it
  // runs. A directory that ranks earlier in the search order can hold a
  // wrapper orphaned by a half-finished `npm i -g` — the shim survives, the
  // package it points at does not — and stopping at that first hit hides a
  // perfectly good CLI of the same name further down the list. Walk past
  // every candidate that cannot be executed before declaring the agent
  // unusable. Only spawn-level failures advance the walk: a version that
  // parses badly, or a binary that runs and exits non-zero, is a real
  // answer from the right binary and must not fall through to another one.
  const attemptedPaths: string[] = [];
  while (
    outcome.kind === 'not-invocable' &&
    attemptedPaths.length < MAX_EXECUTABLE_ATTEMPTS
  ) {
    const failedPath = launch.selectedPath;
    if (!failedPath) break;
    attemptedPaths.push(failedPath);
    const next = await resolveAgentLaunch(def, configuredEnv, {
      skipPathCandidates: attemptedPaths,
    });
    // No candidate left, or the resolver handed back something already
    // proven broken (an explicit override or packaged built-in, which are
    // deliberately not skippable) — either way there is nothing new to try.
    if (!next.selectedPath || !next.launchPath) break;
    if (attemptedPaths.includes(next.selectedPath)) break;
    launch = {
      ...next,
      selectedPath: next.selectedPath,
      launchPath: next.launchPath,
    };
    probeEnv = await applyAgentLaunchEnv(
      await spawnEnvForAgent(
        def.id,
        {
          ...process.env,
          ...(def.env || {}),
        },
        configuredEnv,
        undefined,
        { resolvedBin: next.selectedPath },
      ),
      next,
    );
    outcome = await probeVersionAtPath(def, next.launchPath, probeEnv);
  }
  // Publish every candidate this pass proved cannot be launched, so chat, the
  // connection test, and every other spawn site skip them instead of redoing
  // the naive first-hit-on-PATH walk and landing back on the shim detection
  // rejected. This restores the invariant stated above — detection probes the
  // exact path the runtime will spawn — which the candidate walk would
  // otherwise have broken. Recording the dead paths rather than the winner
  // leaves PATH order in charge of every candidate still standing.
  if (isCurrent()) {
    for (const attempted of attemptedPaths) {
      rememberUnusableExecutable(def.id, attempted);
    }
  }
  if (outcome.kind === 'not-invocable') {
    if (isCurrent()) rememberUnusableExecutable(def.id, launch.selectedPath);
    // Report the path that was actually tried. The agent picker only renders
    // an unavailable agent when it carries a path (that is what makes the
    // row actionable), so dropping it here erases the agent from the UI and
    // leaves the user with no way to see or fix what went wrong.
    return unavailableAgent(
      def,
      [buildNotInvocableDiagnostic(def, launch, outcome.cause)],
      { path: launch.selectedPath },
      configuredEnv,
    );
  }
  // The version probe must finish first (it gates availability), but the
  // three post-version probes are independent reads — run them concurrently
  // so a single agent's detection wall is max(help, models, auth) ≈ 5s rather
  // than the sum ≈ 15s. `--help` capabilities are cached on `agentCapabilities`
  // for buildArgs to consult.
  const [helpCaps, hiddenCaps, modelResult, auth] =
    await Promise.all([
      probeCapabilities(def, launch.launchPath, probeEnv),
      probeHiddenCapabilityFlags(def, launch.launchPath, probeEnv),
      fetchModels(def, launch.launchPath, probeEnv),
      probeAgentAuthStatus(def, launch.launchPath, probeEnv),
    ]);
  // `probeCapabilities` returns null when the agent declares no help metadata;
  // hidden-flag results still deserve to land, so only collapse to null when
  // neither probe produced anything.
  const caps =
    helpCaps || Object.keys(hiddenCaps).length > 0
      ? { ...(helpCaps ?? {}), ...hiddenCaps }
      : null;
  const surfacedModelResult = modelResult;
  const authDiagnostic = auth ? buildAuthDiagnostic(def, auth) : null;
  const readinessContext = await runtimeVersionProbeContext(def, configuredEnv);
  // Config changes can replace this snapshot while any probe is pending.
  // Publish shared runtime facts together only for the current configuration.
  if (isCurrent()) {
    if (caps) agentCapabilities.set(def.id, caps);
    if (auth && readinessContext) detectedReadinessAuth.set(def.id, { scope: readinessAuthScope(readinessContext), status: auth.status });
    else detectedReadinessAuth.delete(def.id);
    const runtimeVersions: DetectedRuntimeVersions = {
      invocable: true,
      ...(outcome.version ? { agentCliVersion: outcome.version } : {}),
    };
    rememberRuntimeVersions(
      def.id,
      readinessContext?.scope ?? '',
      runtimeVersions,
    );
  }
  return {
    ...stripFns(def),
    models: surfacedModelResult.models,
    modelsSource: surfacedModelResult.source,
    available: true,
    path: launch.selectedPath,
    version: outcome.version,
    ...(auth
      ? {
          authStatus: auth.status,
          ...(auth.message ? { authMessage: auth.message } : {}),
        }
      : {}),
    ...(authDiagnostic
      ? {
          diagnostics: [authDiagnostic],
        }
      : {}),
    ...installMetaForAgent(def.id, configuredEnv),
  };
}

function stripFns(
  def: RuntimeAgentDef,
): Omit<DetectedAgent, 'models' | 'modelsSource' | 'available' | 'path' | 'version'> {
  // Drop the buildArgs / listModels closures but keep declarative metadata
  // (reasoningOptions, streamFormat, name, bin, etc.). `models` is
  // populated separately by `fetchModels`, so we strip the static
  // `fallbackModels` slot here too. `helpArgs` / `capabilityFlags` /
  // `fallbackBins` / `env` are
  // probe-or-spawn-only metadata and shouldn't bleed into the API response
  // either.
  const {
    buildArgs,
    listModels,
    fetchModels,
    fallbackModels,
    helpArgs,
    capabilityFlags,
    fallbackBins,
    env,
    authProbe,
    ...rest
  } = def;
  return rest;
}

export async function detectAgent(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
): Promise<DetectedAgent> {
  const scope = detectionEnvironmentScope(def, configuredEnv);
  const existing = agentDetectionSnapshots.get(def);
  if (existing?.scope === scope && existing.pending) return existing.pending;
  // Retain the previous result during a refresh, so ordinary readers never
  // join a slow re-probe once a snapshot exists for their configuration.
  const snapshot: AgentDetectionSnapshot = existing?.scope === scope
    ? existing : { scope, expiresAt: 0 };
  agentDetectionSnapshots.set(def, snapshot);
  const isCurrent = () => agentDetectionSnapshots.get(def) === snapshot;
  const pending = (async () => {
    let agent: DetectedAgent;
    try {
      agent = await probe(def, configuredEnv, isCurrent);
    } catch {
      // A broken adapter must not blank the picker or its healthy peers.
      agent = unavailableAgent(def, [], undefined, configuredEnv);
    }
    snapshot.agent = agent;
    snapshot.expiresAt = Date.now() + DETECTION_TTL_MS;
    // A probe for an old configuration may finish after a new one. Only the
    // current snapshot can update the model allowlist used by run admission.
    if (isCurrent()) {
      rememberLiveModels(agent.id, agent.models, null);
    }
    return agent;
  })();
  snapshot.pending = pending;
  try {
    return await pending;
  } finally {
    delete snapshot.pending;
  }
}

/** Read through the cache; stale results refresh in the background. */
export async function cachedAgent(def: RuntimeAgentDef, configuredEnv: Record<string, string> = {}): Promise<DetectedAgent> {
  const snapshot = agentDetectionSnapshots.get(def);
  if (snapshot?.scope === detectionEnvironmentScope(def, configuredEnv)) {
    if (snapshot.agent) {
      if (Date.now() >= snapshot.expiresAt && !snapshot.pending) {
        void detectAgent(def, configuredEnv).catch(() => {});
      }
      return snapshot.agent;
    }
    if (snapshot.pending) return snapshot.pending;
  }
  return detectAgent(def, configuredEnv);
}

async function collectDetectedAgents(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
  cached = false,
) {
  return Promise.all(
    AGENT_DEFS.map((def) => (cached ? cachedAgent : detectAgent)(def, configuredEnvForAgent(configuredEnvByAgent, def.id))),
  );
}

/** Refresh installed runtimes, models and sign-in state for an explicit rescan. */
export async function detectAgents(configuredEnvByAgent: Record<string, Record<string, string>> = {}) {
  return collectDetectedAgents(configuredEnvByAgent);
}

/** Picker, run admission and analytics share the startup-warmed snapshot. */
export async function getDetectedAgents(configuredEnvByAgent: Record<string, Record<string, string>> = {}) {
  return collectDetectedAgents(configuredEnvByAgent, true);
}

// Streaming variant: yields each agent the moment its probe settles, in
// completion order rather than registry order, so the UI can paint a card
// as soon as it resolves instead of waiting for the slowest CLI. The model
// validation cache is refreshed per-agent (same effect as the batch path,
// just incrementally). `detectAgents` keeps the array contract for callers
// that don't care about incremental delivery (cache warm, analytics, chat).
async function* collectDetectedAgentsStream(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
  cached = false,
): AsyncGenerator<DetectedAgent> {
  const tagged = AGENT_DEFS.map((def, index) =>
    (cached ? cachedAgent : detectAgent)(def, configuredEnvForAgent(configuredEnvByAgent, def.id))
      .then((agent) => ({ index, agent })),
  );
  const pending = new Set(tagged.keys());
  while (pending.size > 0) {
    const { index, agent } = await Promise.race(
      tagged.filter((_, i) => pending.has(i)),
    );
    pending.delete(index);
    yield agent;
  }
}

/** Explicit streaming rescan; entries arrive as fresh probes finish. */
export function detectAgentsStream(configuredEnvByAgent: Record<string, Record<string, string>> = {}) {
  return collectDetectedAgentsStream(configuredEnvByAgent);
}

/** Stream cached entries immediately, refreshing expired entries in the background. */
export function getDetectedAgentsStream(configuredEnvByAgent: Record<string, Record<string, string>> = {}) {
  return collectDetectedAgentsStream(configuredEnvByAgent, true);
}
