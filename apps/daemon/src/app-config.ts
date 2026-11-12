// Daemon-backed app preferences (onboarding state, agent/skill/DS selection).
//
// The web frontend pushes preferences here via PUT /api/app-config; the
// daemon persists them to <dataDir>/app-config.json (where dataDir defaults
// to <projectRoot>/.pixo but follows PIXO_DATA_DIR when set, keeping test and
// multi-namespace runs isolated). This survives browser storage resets and
// origin changes so onboarding and agent selection don't reappear unexpectedly.
//
// `agentCliEnv` is intentionally limited by allowlist below. It is the
// explicit low-level launch environment for Local CLI runs, separate from
// provider BYOK. API-key entries here configure the underlying CLI itself;
// BASE_URL is optional and, when omitted, the CLI uses its default endpoint.
// `agentCliEnvIntent` records when API-key entries were saved under that new
// CLI-override contract. Older builds labeled the same fields as proxy-only,
// so legacy standalone keys without a base URL are dropped unless this marker
// or a matching base URL proves that the user intended to activate them.
// These values are local-only and should not be logged or returned outside
// this machine.

import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { AGENT_IMAGE_MODEL_AUTOMATIC, isGameExperience, type AgentApprovalModes, type GameEnginePaths, type GameExperience } from '@openpixo/contracts';

import { expandHomePrefix } from './home-expansion.js';
import { findTextToImageModel } from './media/models.js';

import {
  readInstallationFile,
  readInstallationFileSync,
  resolveInstallationDir,
  writeInstallationFile,
  type InstallationFilePatch,
} from './installation.js';
import { usesBundledOpenCode } from './runtimes/byok-opencode.js';

// Plugin-system env knobs. See docs/plans/plugins-implementation.md F6 / F9.
// Phase 1 only reads them; the GC worker that enforces snapshot expiry lands
// in Phase 5. Centralized here to keep daemon modules from sprinkling magic
// numbers across the codebase.
export interface PluginEnvKnobs {
  // Hard ceiling on devloop iterations per stage (spec §10.2).
  maxDevloopIterations: number;
  // Days before an unreferenced applied_plugin_snapshots row expires. A
  // value of 0 means "keep forever" (operators can opt out of GC entirely).
  snapshotUnreferencedTtlDays: number;
  // Optional cap on how long even a referenced snapshot stays around once
  // its run/conversation/project is terminal. Default unset -> unlimited.
  snapshotRetentionDays: number | null;
  // GC worker tick interval. Phase 5 reads this; Phase 1 just exposes the
  // knob through `pixo config get` so operators can plan ahead.
  snapshotGcIntervalMs: number;
}

function intFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function nullableIntFromEnv(key: string): number | null {
  const raw = process.env[key];
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export function readPluginEnvKnobs(): PluginEnvKnobs {
  return {
    maxDevloopIterations:        intFromEnv('PIXO_MAX_DEVLOOP_ITERATIONS', 10),
    snapshotUnreferencedTtlDays: intFromEnv('PIXO_SNAPSHOT_UNREFERENCED_TTL_DAYS', 30),
    snapshotRetentionDays:       nullableIntFromEnv('PIXO_SNAPSHOT_RETENTION_DAYS'),
    snapshotGcIntervalMs:        intFromEnv('PIXO_SNAPSHOT_GC_INTERVAL_MS', 6 * 60 * 60 * 1000),
  };
}

export interface AgentModelPrefs {
  model?: string;
  reasoning?: string;
  serviceTier?: string;
}

export type AgentCliEnvPrefs = Record<string, Record<string, string>>;
export type AgentCliEnvIntentPrefs = Record<string, { apiKeyOverride?: boolean }>;

export interface TelemetryPrefs {
  metrics?: boolean;
}


export interface ProjectLocationPrefs {
  id: string;
  name: string;
  path: string;
}

export interface AppConfigPrefs {
  gameEnginePaths?: GameEnginePaths;
  onboardingCompleted?: boolean;
  gameExperience?: GameExperience | null;
  agentId?: string | null;
  agentModels?: Record<string, AgentModelPrefs>;
  agentImageModel?: string;
  agentApprovalModes?: AgentApprovalModes;
  agentCliEnv?: AgentCliEnvPrefs;
  agentCliEnvIntent?: AgentCliEnvIntentPrefs;
  skillId?: string | null;
  disabledSkills?: string[];
  installationId?: string | null;
  telemetry?: TelemetryPrefs;
  privacyDecisionAt?: number | null;
  allowSilentUpdates?: boolean;

  customInstructions?: string | null;
  projectLocations?: ProjectLocationPrefs[];
  defaultProjectLocationId?: string | null;
  // Most-recently-used local working directories the user granted the agent
  // read access to from the Home composer. Become a project's
  // `metadata.linkedDirs` (read-only `--add-dir` awareness, no Design Files
  // import). Stored most-recent-first; capped at RECENT_LINKED_DIRS_MAX.
  recentLinkedDirs?: string[];
}

// Cap on how many recent working directories we remember. Keeps the picker's
// "Recent" submenu short and the config file bounded.
export const RECENT_LINKED_DIRS_MAX = 5;

const ALLOWED_KEYS: ReadonlySet<keyof AppConfigPrefs> = new Set([
  'gameEnginePaths',
  'onboardingCompleted',
  'gameExperience',
  'agentId',
  'agentModels',
  'agentImageModel',
  'agentApprovalModes',
  'agentCliEnv',
  'agentCliEnvIntent',
  'skillId',
  'disabledSkills',
  'installationId',
  'telemetry',
  'privacyDecisionAt',
  'allowSilentUpdates',

  'customInstructions',
  'projectLocations',
  'defaultProjectLocationId',
  'recentLinkedDirs',
] as const);

function configFile(dataDir: string): string {
  return path.join(dataDir, 'app-config.json');
}

export function appConfigDir(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PIXO_DATA_DIR;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return path.join(projectRoot, '.pixo');
  }
  const expanded = expandHomePrefix(raw.trim());
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot, expanded);
}

const AGENT_MODEL_KEYS: ReadonlySet<string> = new Set([
  'model',
  'reasoningByModel',
  'reasoning',
  'serviceTier',
]);

const TELEMETRY_KEYS: ReadonlySet<string> = new Set([
  'metrics',
]);

function validateTelemetry(raw: unknown): TelemetryPrefs | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: Record<string, boolean> = Object.create(null);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor') continue;
    if (!TELEMETRY_KEYS.has(k)) continue;
    if (typeof v === 'boolean') result[k] = v;
  }
  return Object.keys(result).length > 0 ? (result as TelemetryPrefs) : undefined;
}

const AGENT_CLI_ENV_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['claude', new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_BIN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'MMD_MODEL_ROUTES_FILE'])],
  ['codex', new Set(['CODEX_HOME', 'CODEX_BIN', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'OPENAI_API_KEY'])],
  ['opencode', new Set(['OPENCODE_BIN'])],
]);

const AGENT_CLI_AUTH_ENV_KEYS: ReadonlyMap<string, {
  auth: ReadonlySet<string>;
  baseUrl: ReadonlySet<string>;
}> = new Map([
  ['claude', {
    auth: new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']),
    baseUrl: new Set(['ANTHROPIC_BASE_URL']),
  }],
  ['codex', {
    auth: new Set(['CODEX_API_KEY', 'OPENAI_API_KEY']),
    baseUrl: new Set(['OPENAI_BASE_URL']),
  }],
]);

function isValidAgentModelEntry(v: unknown): v is AgentModelPrefs {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!AGENT_MODEL_KEYS.has(k)) return false;
    if (k === 'reasoningByModel') {
      const byModel = obj[k];
      if (byModel === undefined) continue;
      if (!byModel || typeof byModel !== 'object' || Array.isArray(byModel)) return false;
      if (!Object.values(byModel).every((effort) => typeof effort === 'string')) return false;
      continue;
    }
    if (obj[k] !== undefined && typeof obj[k] !== 'string') return false;
  }
  return true;
}

function validateAgentModels(
  raw: unknown,
): Record<string, AgentModelPrefs> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: Record<string, AgentModelPrefs> = Object.create(null);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor') continue;
    if (isValidAgentModelEntry(v)) {
      result[k] = v;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateAgentCliEnv(raw: unknown): AgentCliEnvPrefs | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: AgentCliEnvPrefs = Object.create(null);
  for (const [agentId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (agentId === '__proto__' || agentId === 'constructor') continue;
    const allowed = AGENT_CLI_ENV_KEYS.get(agentId);
    if (!allowed || typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue;
    }
    const env: Record<string, string> = Object.create(null);
    for (const [envKey, envValue] of Object.entries(value as Record<string, unknown>)) {
      if (!allowed.has(envKey)) continue;
      if (typeof envValue !== 'string') continue;
      const trimmed = envValue.trim();
      if (!trimmed) continue;
      env[envKey] = trimmed;
    }
    if (Object.keys(env).length > 0) result[agentId] = env;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateAgentCliEnvIntent(raw: unknown): AgentCliEnvIntentPrefs | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: AgentCliEnvIntentPrefs = Object.create(null);
  for (const [agentId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (agentId === '__proto__' || agentId === 'constructor') continue;
    if (!AGENT_CLI_ENV_KEYS.has(agentId)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const obj = value as Record<string, unknown>;
    if (obj.apiKeyOverride === true) {
      result[agentId] = { apiKeyOverride: true };
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isValidOrbitTime(time: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}


function normalizeLocationId(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9._-]{1,128}$/.test(trimmed) && trimmed !== 'default') {
    return trimmed;
  }
  return fallback;
}

function autoProjectLocationId(pathKey: string): string {
  return `loc_${createHash('sha256').update(pathKey).digest('base64url').slice(0, 16)}`;
}

function validateProjectLocations(raw: unknown): ProjectLocationPrefs[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const result: ProjectLocationPrefs[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.path !== 'string') continue;
    const expanded = expandHomePrefix(obj.path.trim());
    if (!expanded || !path.isAbsolute(expanded)) continue;
    const normalizedPath = path.normalize(expanded);
    const pathKey = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
    if (seenPaths.has(pathKey)) continue;
    const id = normalizeLocationId(
      typeof obj.id === 'string' ? obj.id : '',
      autoProjectLocationId(pathKey),
    );
    if (seenIds.has(id)) continue;
    const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';
    result.push({ id, name: rawName || path.basename(normalizedPath) || normalizedPath, path: normalizedPath });
    seenIds.add(id);
    seenPaths.add(pathKey);
  }
  return result;
}

export function agentCliEnvForAgent(
  prefs: AgentCliEnvPrefs | undefined,
  agentId: string,
): Record<string, string> {
  if (!prefs || typeof agentId !== 'string') return {};
  const env = prefs[usesBundledOpenCode(agentId) ? 'opencode' : agentId];
  if (!env || typeof env !== 'object' || Array.isArray(env)) return {};
  return { ...env };
}

function normalizeAgentCliEnvPrefs(prefs: AppConfigPrefs): AppConfigPrefs {
  const agentCliEnv = prefs.agentCliEnv;
  if (!agentCliEnv) {
    if (!prefs.agentCliEnvIntent) return prefs;
    const next = { ...prefs };
    delete next.agentCliEnvIntent;
    return next;
  }

  let nextAgentCliEnv = agentCliEnv;
  let changed = false;

  for (const [agentId, keys] of AGENT_CLI_AUTH_ENV_KEYS) {
    const env = nextAgentCliEnv[agentId];
    if (!env) continue;
    const hasBaseUrl = Object.keys(env).some((key) => keys.baseUrl.has(key));
    const hasExplicitApiKeyIntent = prefs.agentCliEnvIntent?.[agentId]?.apiKeyOverride === true;
    if (hasBaseUrl || hasExplicitApiKeyIntent) continue;

    let nextEnv = env;
    for (const authKey of keys.auth) {
      if (!Object.prototype.hasOwnProperty.call(nextEnv, authKey)) continue;
      if (nextEnv === env) nextEnv = { ...env };
      delete nextEnv[authKey];
      changed = true;
    }
    if (nextEnv === env) continue;
    nextAgentCliEnv = { ...nextAgentCliEnv };
    if (Object.keys(nextEnv).length > 0) {
      nextAgentCliEnv[agentId] = nextEnv;
    } else {
      delete nextAgentCliEnv[agentId];
    }
  }

  let nextAgentCliEnvIntent = prefs.agentCliEnvIntent;
  if (nextAgentCliEnvIntent) {
    for (const agentId of Object.keys(nextAgentCliEnvIntent)) {
      if (nextAgentCliEnv[agentId]) continue;
      nextAgentCliEnvIntent = { ...nextAgentCliEnvIntent };
      delete nextAgentCliEnvIntent[agentId];
      changed = true;
    }
  }

  const normalizedAgentCliEnv = Object.keys(nextAgentCliEnv).length > 0 ? nextAgentCliEnv : undefined;
  const normalizedIntent = nextAgentCliEnvIntent && Object.keys(nextAgentCliEnvIntent).length > 0
    ? nextAgentCliEnvIntent
    : undefined;

  if (
    !changed &&
    normalizedAgentCliEnv === prefs.agentCliEnv &&
    normalizedIntent === prefs.agentCliEnvIntent
  ) {
    return prefs;
  }

  const next = { ...prefs };
  if (normalizedAgentCliEnv) {
    next.agentCliEnv = normalizedAgentCliEnv;
  } else {
    delete next.agentCliEnv;
  }
  if (normalizedIntent) {
    next.agentCliEnvIntent = normalizedIntent;
  } else {
    delete next.agentCliEnvIntent;
  }
  return next;
}

function inferAgentCliEnvIntentForExplicitEnvWrite(prefs: AppConfigPrefs): AppConfigPrefs {
  if (!prefs.agentCliEnv) return prefs;
  let nextAgentCliEnvIntent = prefs.agentCliEnvIntent;
  let changed = false;

  for (const [agentId, keys] of AGENT_CLI_AUTH_ENV_KEYS) {
    const env = prefs.agentCliEnv[agentId];
    if (!env) continue;
    const hasBaseUrl = Object.keys(env).some((key) => keys.baseUrl.has(key));
    if (hasBaseUrl) continue;
    const hasAuthKey = Object.keys(env).some((key) => keys.auth.has(key));
    if (!hasAuthKey) continue;
    if (nextAgentCliEnvIntent?.[agentId]?.apiKeyOverride === true) continue;
    nextAgentCliEnvIntent = {
      ...(nextAgentCliEnvIntent ?? {}),
      [agentId]: { apiKeyOverride: true },
    };
    changed = true;
  }

  if (!changed || !nextAgentCliEnvIntent) return prefs;
  return { ...prefs, agentCliEnvIntent: nextAgentCliEnvIntent };
}

/** The saved form of an `agentImageModel` write: a trimmed id, or null for automatic. */
function normalizedAgentImageModel(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id !== AGENT_IMAGE_MODEL_AUTOMATIC && id.length <= 200 && !id.includes('\0') ? id : null;
}

/**
 * A new `agentImageModel` must name a text-to-image model this version has; it is
 * saved under its current id. Re-sending the saved value (a whole-config write from
 * `pixo config set`) is accepted as is, so a model a later version drops never
 * blocks unrelated writes.
 */
function checkedAgentImageModel(value: unknown, saved: string | undefined): unknown {
  const id = normalizedAgentImageModel(value);
  if (!id || id === saved) return value;
  const model = findTextToImageModel(id);
  if (!model) {
    throw new InvalidAppConfigValueError('agentImageModel',
      `agentImageModel must be a text-to-image model id from \`pixo media image-models\`, or "${AGENT_IMAGE_MODEL_AUTOMATIC}" for automatic. Unknown: ${id}`);
  }
  return model.id;
}

function applyConfigValue(
  target: Record<string, unknown>,
  key: keyof AppConfigPrefs,
  value: unknown,
): void {
  if (key === 'onboardingCompleted') {
    if (typeof value === 'boolean') target[key] = value;
    return;
  }
  if (key === 'agentId' || key === 'skillId') {
    if (typeof value === 'string' || value === null) target[key] = value;
    return;
  }
  if (key === 'gameExperience') {
    // null clears it, so the next new game asks again.
    if (isGameExperience(value)) target[key] = value;
    else if (value === null) delete target[key];
    return;
  }
  if (key === 'agentImageModel') {
    // Empty, null or "auto" is automatic, stored as absent. Reads stay lenient: a run
    // judges a saved id it cannot use and tells the agent why; writes are checked in doWrite.
    const id = normalizedAgentImageModel(value);
    if (id) target[key] = id;
    else delete target[key];
    return;
  }
  if (key === 'agentModels') {
    const validated = validateAgentModels(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
  }
  if (key === 'agentCliEnv') {
    const validated = validateAgentCliEnv(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
  }
  if (key === 'agentCliEnvIntent') {
    const validated = validateAgentCliEnvIntent(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
  }
  if (key === 'disabledSkills') {
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      target[key] = value;
    } else {
      delete target[key];
    }
  }
  if (key === 'installationId') {
    if (typeof value === 'string' || value === null) target[key] = value;
    return;
  }
  if (key === 'telemetry') {
    const validated = validateTelemetry(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
  }
  if (key === 'privacyDecisionAt') {
    if (
      value === null ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    ) {
      target[key] = value;
    } else {
      delete target[key];
    }
    return;
  }
  if (key === 'allowSilentUpdates') {
    if (typeof value === 'boolean') {
      target[key] = value;
    } else {
      delete target[key];
    }
    return;
  }

  if (key === 'customInstructions') {
    if (typeof value === 'string') {
      target[key] = value.slice(0, 5000);
    } else if (value === null) {
      target[key] = value;
    }
    return;
  }
  if (key === 'agentApprovalModes') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = Object.fromEntries(Object.entries(value).filter(([, mode]) => mode === 'in-app' || mode === 'skip'));
    } else {
      delete target[key];
    }
    return;
  }
  if (key === 'gameEnginePaths') {
    const paths: GameEnginePaths = {};
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const id of ['godot', 'unity', 'cocosCreator'] as const) {
        const entry = (value as Record<string, unknown>)[id];
        if (typeof entry === 'string' && entry.trim() && !entry.includes('\0')) paths[id] = entry.trim();
      }
    }
    target[key] = paths;
    return;
  }
  if (key === 'projectLocations') {
    const validated = validateProjectLocations(value);
    if (validated !== undefined) {
      target[key] = validated;
    } else {
      delete target[key];
    }
    return;
  }
  if (key === 'defaultProjectLocationId') {
    if (typeof value === 'string') {
      target[key] = normalizeLocationId(value, 'default');
    } else if (value === null) {
      target[key] = null;
    } else {
      delete target[key];
    }
    return;
  }
  if (key === 'recentLinkedDirs') {
    if (Array.isArray(value)) {
      // Keep non-empty strings, trim, de-dupe preserving most-recent-first
      // order, and cap the list. Path existence/safety is enforced later by
      // validateLinkedDirs when the dir is actually attached to a project, so
      // a folder that was since deleted simply drops out at use time rather
      // than corrupting the whole config write here.
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const trimmed = entry.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        cleaned.push(trimmed);
        if (cleaned.length >= RECENT_LINKED_DIRS_MAX) break;
      }
      target[key] = cleaned;
    } else {
      delete target[key];
    }
    return;
  }
}

function filterAllowedKeys(obj: Record<string, unknown>): AppConfigPrefs {
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (ALLOWED_KEYS.has(key as keyof AppConfigPrefs)) {
      applyConfigValue(result, key as keyof AppConfigPrefs, obj[key]);
    }
  }
  return normalizeAgentCliEnvPrefs(result as AppConfigPrefs);
}

// OpenPixo requires explicit consent; saved per-channel choices stay intact.
function applyTelemetryDefaults(prefs: AppConfigPrefs): AppConfigPrefs {
  if (prefs.telemetry === undefined) {
    return {
      ...prefs,
      telemetry: { metrics: false },
    };
  }
  return prefs;
}

export type MetricsConsentRead = {
  status: 'missing' | 'available' | 'unavailable';
  metrics: boolean;
};

/** Unlike general config hydration, consent must distinguish a fresh install
 * from damaged/unreadable saved preferences. Never recover a lost opt-out by
 * silently defaulting a corrupt file to an empty config. */
export async function readMetricsConsent(dataDir: string): Promise<MetricsConsentRead> {
  try {
    const raw: unknown = JSON.parse(await readFile(configFile(dataDir), 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { status: 'unavailable', metrics: false };
    }
    const telemetry = (raw as Record<string, unknown>).telemetry;
    if (telemetry !== undefined) {
      if (!telemetry || typeof telemetry !== 'object' || Array.isArray(telemetry)) {
        return { status: 'unavailable', metrics: false };
      }
      const metrics = (telemetry as Record<string, unknown>).metrics;
      if (typeof metrics !== 'boolean') return { status: 'unavailable', metrics: false };
      return { status: 'available', metrics };
    }
    return { status: 'available', metrics: applyTelemetryDefaults({}).telemetry?.metrics === true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing', metrics: applyTelemetryDefaults({}).telemetry?.metrics === true };
    }
    return { status: 'unavailable', metrics: false };
  }
}

export async function readAppConfig(dataDir: string): Promise<AppConfigPrefs> {
  const base = await readAppConfigFileOnly(dataDir);
  // Channel-root installation file is the new authoritative source for the
  // identity bits that must survive a namespace-scoped data-dir wipe. It
  // lives outside `<namespace>/data/` so a reinstall of the same channel
  // (which might churn the namespace token, or eventually clear per-
  // namespace data) keeps the same id.
  //
  // Migration: when this daemon is the first to boot with installation.json
  // support and finds an existing installationId in the legacy app-config
  // path, mirror it forward exactly once so PostHog continues to see the
  // same person across the 0.7.x → 0.8.0 upgrade. Without this mirror, the
  // user count would double when 0.8.0 ships.
  const installationDir = resolveInstallationDir(dataDir);
  const installation = await readInstallationFile(installationDir);
  if (typeof installation.installationId === 'string' && installation.installationId.length > 0) {
    return applyTelemetryDefaults({ ...base, installationId: installation.installationId });
  }
  if (typeof base.installationId === 'string' && base.installationId.length > 0) {
    // Best-effort migration. A write failure here doesn't break the read —
    // we still serve the legacy id. The next write through writeAppConfig
    // will retry the mirror.
    try {
      await writeInstallationFile(installationDir, { installationId: base.installationId });
    } catch {
      // swallow — observability beats correctness on this path
    }
  }
  return applyTelemetryDefaults(base);
}

// Synchronous mirror of readAppConfig for callers that cannot await — e.g.

// spawnEnvForAgent. It reuses the exact same parsing, validation and telemetry
// defaulting as the async path, so the consent decision and installationId can
// never drift from what the rest of the daemon (and the web analytics config)
// sees. The only intentional difference is that it skips the best-effort
// legacy→channel-root migration *write*, which is a side effect rather than
// part of the read result.
export function readAppConfigSync(dataDir: string): AppConfigPrefs {
  const base = readAppConfigFileOnlySync(dataDir);
  const installation = readInstallationFileSync(resolveInstallationDir(dataDir));
  if (
    typeof installation.installationId === 'string' &&
    installation.installationId.length > 0
  ) {
    return applyTelemetryDefaults({
      ...base,
      installationId: installation.installationId,
    });
  }
  return applyTelemetryDefaults(base);
}

function readAppConfigFileOnlySync(dataDir: string): AppConfigPrefs {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(configFile(dataDir), 'utf8'),
    );
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return filterAllowedKeys(parsed as Record<string, unknown>);
    }
    return {};
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string };
    if (e.code === 'ENOENT') return {};
    if (e.name === 'SyntaxError') return {};
    throw err;
  }
}

async function readAppConfigFileOnly(dataDir: string): Promise<AppConfigPrefs> {
  try {
    const raw = await readFile(configFile(dataDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return filterAllowedKeys(parsed as Record<string, unknown>);
    }
    console.warn('[app-config] Invalid shape in config file, returning empty');
    return {};
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string; message?: string };
    if (e.code === 'ENOENT') return {};
    if (e.name === 'SyntaxError') {
      console.error('[app-config] Corrupted JSON, returning empty:', e.message);
      return {};
    }
    throw err;
  }
}

// Serialize concurrent writes to the same dataDir so the read-modify-write
// cycle doesn't lose updates when two PUT requests overlap.
const writeLocks = new Map<string, Promise<unknown>>();

export async function writeAppConfig(
  dataDir: string,
  partial: Record<string, unknown>,
): Promise<AppConfigPrefs> {
  const prev = writeLocks.get(dataDir) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(() => doWrite(dataDir, partial));
  writeLocks.set(dataDir, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(dataDir) === task) writeLocks.delete(dataDir);
  }
}

/** Thrown by `writeAppConfig` when a control key is handed a value it cannot mean. */
export class InvalidAppConfigValueError extends Error {
  readonly code = 'INVALID_APP_CONFIG_VALUE';

  constructor(public readonly key: string, message: string) {
    super(message);
    this.name = 'InvalidAppConfigValueError';
  }
}

async function doWrite(
  dataDir: string,
  partial: Record<string, unknown>,
): Promise<AppConfigPrefs> {
  const existing = await readAppConfig(dataDir);
  const next: Record<string, unknown> = { ...existing };
  for (const key of Object.keys(partial)) {
    if (!ALLOWED_KEYS.has(key as keyof AppConfigPrefs)) continue;
    const value = key === 'agentImageModel' ? checkedAgentImageModel(partial[key], existing.agentImageModel) : partial[key];
    applyConfigValue(next, key as keyof AppConfigPrefs, value);
  }
  const nextWithInferredIntent = Object.prototype.hasOwnProperty.call(partial, 'agentCliEnv')
    ? inferAgentCliEnvIntentForExplicitEnvWrite(next as AppConfigPrefs)
    : next as AppConfigPrefs;
  const normalizedNext = normalizeAgentCliEnvPrefs(nextWithInferredIntent);
  const file = configFile(dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomBytes(4).toString('hex') + '.tmp';
  await writeFile(tmp, JSON.stringify(normalizedNext, null, 2), 'utf8');
  await rename(tmp, file);
  const installationIdWasExplicitlyReset = Object.prototype.hasOwnProperty.call(partial, 'installationId')
    && (partial.installationId == null || (
      typeof existing.installationId === 'string'
      && typeof normalizedNext.installationId === 'string'
      && existing.installationId !== normalizedNext.installationId
    ));
  const metricsWereExplicitlyDisabled = isMetricsExplicitlyDisabled(partial.telemetry);
  const shouldClearAttribution = installationIdWasExplicitlyReset || metricsWereExplicitlyDisabled;
  // Mirror the identity bits to the channel-root installation file so they
  // survive a namespace-scoped data-dir wipe. Only fires when the caller
  // explicitly touches installation identity or consent lifecycle state
  // (avoiding noisy writes on every unrelated app-config update). A write
  // failure here doesn't roll back the app-config write — the next read
  // merges them transparently.
  if (Object.prototype.hasOwnProperty.call(partial, 'installationId') || shouldClearAttribution) {
    const id = normalizedNext.installationId;
    // Caller explicitly touched installationId — mirror the outcome
    // (including the clear case) to installation.json so a future read
    // doesn't keep serving the old value out of the channel-root file.
    // "Delete my data" relies on this clear path.
    const installPatch: InstallationFilePatch = {
      ...(Object.prototype.hasOwnProperty.call(partial, 'installationId')
        ? { installationId: typeof id === 'string' && id.length > 0 ? id : null }
        : {}),
      ...(shouldClearAttribution
        ? {
            pendingAttribution: null,
            attributionClaimedAt: null,
            attributionClaimResultAt: null,
          }
        : {}),
    };
    try {
      await writeInstallationFile(resolveInstallationDir(dataDir), installPatch);
    } catch {
      // swallow — install file mirroring is best-effort; the canonical
      // app-config write already succeeded.
    }
  }
  return normalizedNext;
}

function isMetricsExplicitlyDisabled(value: unknown): boolean {
  return value != null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).metrics === false;
}
