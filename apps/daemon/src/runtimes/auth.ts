import { execAgentFile } from './invocation.js';
import { readCodexProviderEnvKey } from '../codex-config-normalize.js';
import type { RuntimeAgentDef, RuntimeEnv } from './types.js';

export type AgentAuthProbeResult = {
  status: 'ok' | 'missing' | 'unknown';
  message?: string;
  // Output captured from the probe child process (e.g.
  // `claude auth status`). Exposed so callers like the connection
  // test layer can fold the probe's own stderr/exit context into their
  // structured diagnostics — the probe runs before the smoke spawn,
  // so without this the diagnostics block would otherwise drop the
  // probe output entirely.
  stdoutTail?: string;
  stderrTail?: string;
  exitCode?: number | null;
  signal?: string | null;
};

const CLAUDE_AUTH_GUIDANCE =
  'Claude Code is installed but is not authenticated. Run `claude auth login` or open `claude` and complete login in a terminal, then rescan. If OpenPixo was launched outside an interactive shell, your shell rc files (e.g. ~/.zshrc) may not be loaded into its environment.';

export function claudeAuthGuidance(): string {
  return CLAUDE_AUTH_GUIDANCE;
}

export function isClaudeAuthFailureText(text: string): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  try {
    const parsed = JSON.parse(value) as { authenticated?: unknown; loggedIn?: unknown };
    if (parsed.authenticated === true || parsed.loggedIn === true) return false;
    if (parsed.authenticated === false || parsed.loggedIn === false) return true;
  } catch {
    // Fall through to text matching below.
  }
  if (/"authenticated"\s*:\s*true/i.test(value) || /"loggedIn"\s*:\s*true/i.test(value)) {
    return false;
  }
  return (
    /"authenticated"\s*:\s*false/i.test(value) ||
    /"loggedIn"\s*:\s*false/i.test(value) ||
    /not authenticated/i.test(value) ||
    /not logged[ _-]?in/i.test(value) ||
    /authentication required/i.test(value) ||
    /please (?:sign|log)[ _-]?in/i.test(value)
  );
}

export function classifyAgentAuthFailure(
  agentId: string,
  text: string,
): AgentAuthProbeResult | null {
  if (agentId !== 'claude' || !isClaudeAuthFailureText(text)) return null;
  return { status: 'missing', message: claudeAuthGuidance() };
}

// Map raw model-service errors from the kept CLIs to the shared API codes.
export type AgentServiceFailureCode =
  | 'AGENT_AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE';

// A bare HTTP status number (`500`, `429`, …) is too noisy to trust on its own
// — agent stderr is full of unrelated numbers (`line 500`, `read 502 bytes`,
// `took 503ms`, `exit code 401`, `process exited with code 429`). Only treat a
// status number as a signal when it carries explicit HTTP-status context
// (`HTTP 500`, `status 429`, `status code 401`, `error code 502`,
// `server error 503`, or a punctuation-bound `code: 401`). Crucially `code`
// alone is NOT enough — that would still match process-exit lines like `exit
// code 401`; it only counts when qualified (status/error/response code) or
// immediately followed by `:`/`=`/`#`. Phrasing per review on #3083.
const STATUS_CTX =
  '(?:' +
  '\\bhttp(?:[ /]?\\d(?:\\.\\d)?)?\\b' + // HTTP, HTTP/1.1
  '|\\b(?:status|error|response)(?:[ _-]?code)?\\b' + // status / status code / error code / response code
  '|\\bcode(?=\\s*[:=#])' + // code: 401 / code=429  (NOT "exit code 401")
  '|\\b(?:server|http)[ _-]?error\\b' + // server error / http error
  ')[\\s:=#-]*';

// Authentication / authorization: a missing, invalid, or expired credential.
const AGENT_AUTH_FAILURE_RE = new RegExp(
  `(\\b(unauthor(?:ized|ised)|authenticat(?:e|ed|ion)|invalid[ _-]?(?:api[ _-]?)?key|incorrect api key|no api key|x-api-key|missing[ _-]?credentials?|not (?:authenticated|logged[ _-]?in)|please (?:sign|log)[ _-]?in|oauth token (?:has )?expired|session expired|credentials? (?:are )?(?:missing|invalid|required))\\b|\\/login\\b|${STATUS_CTX}401\\b)`,
  'i',
);

// Quota / rate limit / billing balance — the wall the hosted gateway avoids.
const AGENT_RATE_FAILURE_RE = new RegExp(
  `(\\b(rate[ _-]?limit|too many requests|quota|insufficient[ _-]?(?:quota|balance|credit|funds)|credit balance is too low|exceeded your current quota|usage limit|session limit|limit reached|billing (?:hard )?limit)\\b|${STATUS_CTX}429\\b)`,
  'i',
);

// Upstream model/provider problems: overloaded, 5xx, temporarily unavailable.
const AGENT_UPSTREAM_FAILURE_RE = new RegExp(
  `(\\b(overloaded(?:_error)?|service (?:is )?(?:temporarily )?unavailable|bad gateway|gateway timeout|internal server error|upstream (?:error|unavailable)|provider (?:error|unavailable)|temporarily unavailable|model is currently overloaded|5xx)\\b|${STATUS_CTX}5\\d\\d\\b|\\b5\\d\\d\\s+(?:bad gateway|service unavailable|internal server error|gateway timeout))`,
  'i',
);


const TOOL_INVOCATION_MARKER =
  /\btool[_ -](?:error|use|call|result)\b|\btool\s+[\w./-]+\s+(?:failed|error)\b|\bmcp_auth_required\b|\b(?:mcp|connector|plugin)\b/i;


const PROGRAM_DIAGNOSTIC_PREFIX = /^[ \t]*([A-Za-z][\w.+-]{0,31})(?::[ \t]|[ \t]ERR!)/;

const SEVERITY_LABELS = new Set([
  'err', 'error', 'errors',
  'warn', 'warning',
  'fatal', 'panic', 'critical', 'crit',
  'note', 'notice', 'info', 'debug', 'trace', 'verbose',
]);

// Agent ids and executable names owned by the retained adapters. A different
// command prefix denotes a tool's credentials rather than the agent's login.
export const OWN_AGENT_COMMAND_NAMES: ReadonlySet<string> = new Set([
  'byok-opencode', 'openpixo-agent', 'claude', 'openclaude', 'codex', 'opencode', 'opencode-cli',
]);


export function reportsToolPrincipalAuthFailure(text: string): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  for (const line of value.split(/\r?\n/)) {
    if (!AGENT_AUTH_FAILURE_RE.test(line)) continue;
    if (TOOL_INVOCATION_MARKER.test(line)) return true;
    const prefix = PROGRAM_DIAGNOSTIC_PREFIX.exec(line);
    if (!prefix) continue;
    const speaker = (prefix[1] ?? '').toLowerCase();
    // A severity (`Error:`) or a status reason phrase (`Unauthorized:`) is a
    // LABEL, not a name: it says how bad the line is, or what the server
    // answered, never who wrote it. Reading either as a speaker would drop a

    // request failed with status 401: invalid_api_key`.
    if (SEVERITY_LABELS.has(speaker)) continue;
    if (AGENT_AUTH_FAILURE_RE.test(speaker)) continue;
    // One of our own agent CLIs speaking as itself, not a tool inside it.
    if (OWN_AGENT_COMMAND_NAMES.has(speaker)) continue;
    if (AGENT_AUTH_FAILURE_RE.test(line.slice(prefix[0].length))) return true;
  }
  return false;
}

// Returns the model-service failure class implied by an agent's combined
// stdout/stderr/error text, or null when the text looks like an ordinary
// process failure. Auth is checked before rate/upstream so a `401` is never
// misread as a `5xx`. Pure text match — no agent-specific assumptions — so it
// applies uniformly to any CLI agent.
export function classifyAgentServiceFailure(
  text: string,
): AgentServiceFailureCode | null {
  const value = String(text || '');
  if (!value.trim()) return null;
  // The auth class is a claim about THIS agent's credential — the web turns it
  // into a sign-in offer. A report that names a different holder (a tool the
  // agent ran) is answering a different question, so it does not reach the auth
  // branch. It is scoped to the auth branch on purpose: rate limit and upstream
  // outage are true of a tool's request whoever made it, so a tool that hit a
  // 503 or a 429 still classifies below.
  const toolPrincipal = reportsToolPrincipalAuthFailure(value);
  if (!toolPrincipal && AGENT_AUTH_FAILURE_RE.test(value)) return 'AGENT_AUTH_REQUIRED';
  if (AGENT_RATE_FAILURE_RE.test(value)) return 'RATE_LIMITED';
  if (AGENT_UPSTREAM_FAILURE_RE.test(value)) return 'UPSTREAM_UNAVAILABLE';
  return null;
}

// Tail length matches the smoke-test sink so the diagnostics block
// stays compact when it folds probe output back into its overrides.
const PROBE_TAIL_BYTES = 400;

function tailString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > PROBE_TAIL_BYTES ? trimmed.slice(-PROBE_TAIL_BYTES) : trimmed;
}

function withProbeTails(
  base: AgentAuthProbeResult,
  stdoutText: string,
  stderrText: string,
): AgentAuthProbeResult {
  const result: AgentAuthProbeResult = { ...base };
  const stdoutTail = tailString(stdoutText);
  const stderrTail = tailString(stderrText);
  if (stdoutTail) result.stdoutTail = stdoutTail;
  if (stderrTail) result.stderrTail = stderrTail;
  return result;
}

// Default sign-in hint for a runtime without tailored authentication copy.
function genericAuthGuidance(agentName: string): string {
  return `${agentName} appears to be installed but is not authenticated. Sign in with the CLI in a terminal, then rescan. If OpenPixo was launched outside an interactive shell, your shell rc files (e.g. ~/.zshrc) may not be loaded into its environment.`;
}

// Claude's JSON-aware status classifier must not be second-guessed by the
// generic text matcher, which also matches healthy "authenticated" output.
const TAILORED_AUTH_AGENTS = new Set(['claude']);

function hasNonEmptyEnv(env: RuntimeEnv, keys: string[]): boolean {
  return keys.some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

const CLAUDE_ENTERPRISE_PROVIDER_FLAGS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

// `claude auth status` reports Claude.ai credentials only. An explicitly
// enabled enterprise provider is therefore the authoritative authentication
// path and must not be mistaken for a missing Claude.ai login.
function hasClaudeEnterpriseProviderAuth(env: RuntimeEnv): boolean {
  return CLAUDE_ENTERPRISE_PROVIDER_FLAGS.some((key) => env[key] === '1');
}

function hasProbeSatisfyingAuth(agentId: string, env: RuntimeEnv): boolean {
  if (agentId === 'codex') {
    return hasNonEmptyEnv(env, ['CODEX_API_KEY', 'OPENAI_API_KEY']);
  }
  if (agentId === 'claude') {
    return (
      hasNonEmptyEnv(env, ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) ||
      hasClaudeEnterpriseProviderAuth(env)
    );
  }
  return false;
}

// Classify an auth-probe's combined output into a missing-auth result, or
// null when the output does not look like an auth failure. Agents with a
// tailored classifier use only that (null === authenticated); every other
// adapter that opts into probing falls back to the generic, agent-agnostic
// HTTP/text classifier so it still gets a usable signal without bespoke
// regexes.
function classifyProbedAuthFailure(
  classifierId: string,
  agentName: string,
  text: string,
): AgentAuthProbeResult | null {
  if (TAILORED_AUTH_AGENTS.has(classifierId)) {
    return classifyAgentAuthFailure(classifierId, text);
  }
  if (classifyAgentServiceFailure(text) === 'AGENT_AUTH_REQUIRED') {
    return { status: 'missing', message: genericAuthGuidance(agentName) };
  }
  return null;
}

// Run an adapter's declared authentication probe (a cheap, side-effect-free
// status/whoami command) and classify the result. Returns null when the
// adapter declares no `authProbe` — those agents are never actively probed;
// their auth status is inferred only from a real chat failure's error text.
export async function probeAgentAuthStatus(
  def: Pick<RuntimeAgentDef, 'id' | 'name' | 'authProbe'>,
  resolvedBin: string,
  env: RuntimeEnv,
): Promise<AgentAuthProbeResult | null> {
  const probe = def.authProbe;
  if (!probe) return null;
  const classifierId = def.id;
  const agentName = def.name || def.id;
  if (hasProbeSatisfyingAuth(classifierId, env)) return { status: 'ok' };
  // Codex custom providers authenticate via a provider-specific `env_key` (e.g.
  // AZURE_OPENAI_API_KEY) declared in config.toml, even when `codex login
  // status` (a ChatGPT/OpenAI-login check) exits non-zero. Honor that key so a
  // working custom-provider install isn't misreported as missing auth (#4456).
  if (classifierId === 'codex') {
    const providerEnvKey = await readCodexProviderEnvKey(env);
    if (providerEnvKey && hasNonEmptyEnv(env, [providerEnvKey])) {
      return { status: 'ok' };
    }
  }
  try {
    const { stdout, stderr } = await execAgentFile(resolvedBin, probe.args, {
      env,
      timeout: probe.timeoutMs ?? 5000,
      maxBuffer: 1024 * 1024,
    });
    const stdoutText = typeof stdout === 'string' ? stdout : '';
    const stderrText = typeof stderr === 'string' ? stderr : '';
    const output = `${stdoutText}\n${stderrText}`;
    const failure = classifyProbedAuthFailure(classifierId, agentName, output);
    if (failure) {
      return withProbeTails(
        { ...failure, exitCode: 0, signal: null },
        stdoutText,
        stderrText,
      );
    }
    return { status: 'ok' };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: unknown;
      stderr?: unknown;
      code?: string | number;
      signal?: string;
    };
    const stdoutText = typeof err.stdout === 'string' ? err.stdout : '';
    const stderrText = typeof err.stderr === 'string' ? err.stderr : '';
    const output = [err.message, stdoutText, stderrText].join('\n');
    // util.promisify(execFile) attaches `code` and `signal` to the
    // rejection error. `code` may be a number (real non-zero exit) or
    // a Node ErrnoException string ("ENOENT"); only the numeric form
    // is meaningful as an exit code.
    const numericExit = typeof err.code === 'number' ? err.code : null;
    const childSignal = typeof err.signal === 'string' ? err.signal : null;
    const failure = classifyProbedAuthFailure(classifierId, agentName, output);
    if (failure) {
      return withProbeTails(
        { ...failure, exitCode: numericExit, signal: childSignal },
        stdoutText,
        stderrText,
      );
    }
    return withProbeTails(
      {
        status: 'unknown',
        message: `${def.name || def.id} authentication status could not be verified with \`${def.id} ${probe.args.join(' ')}\`.`,
        exitCode: numericExit,
        signal: childSignal,
      },
      stdoutText,
      stderrText,
    );
  }
}
