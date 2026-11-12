import { DEFAULT_MODEL_OPTION } from './shared.js';
import {
  OPENCODE_PERMISSION_CAPABILITY,
  appendOpenCodePermissionBypass,
  appendOpenCodeWorkspaceDir,
} from '../opencode-permissions.js';
import { getRememberedLiveModels } from '../models.js';
import type { RuntimeAgentDef, RuntimeModelOption } from '../types.js';

const OPENCODE_VARIANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const OPENCODE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._/:@-]*$/u;

function reasoningOptions(ids: readonly string[]): RuntimeModelOption[] {
  return [
    { id: 'default', label: 'Default' },
    ...ids.map((id) => ({ id, label: id })),
  ];
}

/**
 * Only what the CLI config itself decides. A catalogue outage must not suggest models
 * of providers this user never connected.
 */
const OPENCODE_FALLBACK_MODELS: RuntimeModelOption[] = [DEFAULT_MODEL_OPTION];

/** The provider OpenCode ships with: it lists its free models with no key at all. */
const OPENCODE_BUILT_IN_PROVIDER = 'opencode/';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

function isFreeModel(metadata: Record<string, unknown> | null): boolean {
  const cost = metadata?.['cost'];
  if (!cost || typeof cost !== 'object') return true;
  const { input, output } = cost as Record<string, unknown>;
  return !finiteNumber(input) && !finiteNumber(output);
}

/**
 * Where OpenCode 1.18 compacts, from the same limits it reads (`SessionCompaction.usable`):
 * the input limit less a buffer when the model states one, else the context limit less
 * the output it reserves, which it caps at 32k.
 */
export function openCodeAutoCompactAt(limit: unknown): { contextWindowTokens: number; autoCompactAtTokens: number } | null {
  if (!limit || typeof limit !== 'object') return null;
  const { context, input, output } = limit as Record<string, unknown>;
  const window = finiteNumber(context);
  if (!window) return null;
  const reservedOutput = Math.min(finiteNumber(output) ?? 32_000, 32_000);
  const inputLimit = finiteNumber(input);
  const at = inputLimit ? inputLimit - Math.min(20_000, reservedOutput) : window - reservedOutput;
  return at > 0 ? { contextWindowTokens: window, autoCompactAtTokens: at } : null;
}

function parseVerboseModelMetadata(
  lines: string[],
  start: number,
): { value: Record<string, unknown> | null; end: number } {
  let buffer = '';
  for (let index = start; index < lines.length; index += 1) {
    buffer += `${lines[index]}\n`;
    if (!lines[index]!.trimEnd().endsWith('}')) continue;
    try {
      const parsed = JSON.parse(buffer) as unknown;
      return {
        value: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null,
        end: index,
      };
    } catch {
      // Nested objects close before the outer metadata object. Keep reading
      // until the complete JSON value parses.
    }
  }
  return { value: null, end: start - 1 };
}

/**
 * Parse `opencode models --verbose`, retaining each model's exact variant
 * names. Plain one-id-per-line output remains accepted as a compatibility
 * fallback, but only verbose metadata can advertise reasoning choices.
 *
 * OpenCode lists a provider only once it can use it, with one exception: its own
 * built-in provider shows a long list of free models to everyone. That list is not
 * something the user connected, so it stays out unless a key for that provider unlocked
 * paid models too. With nothing connected only the CLI-config default remains.
 */
export function parseOpenCodeModels(stdout: string): RuntimeModelOption[] | null {
  const lines = String(stdout || '').split('\n');
  const models: RuntimeModelOption[] = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>();
  const builtIn: RuntimeModelOption[] = [];
  let builtInConnected = false;
  for (let index = 0; index < lines.length; index += 1) {
    const id = lines[index]!.trim();
    if (!OPENCODE_MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const next = lines[index + 1]?.trimStart();
    const metadata = next?.startsWith('{')
      ? parseVerboseModelMetadata(lines, index + 1)
      : { value: null, end: index };
    const variants = metadata.value?.['variants'];
    const variantIds = variants && typeof variants === 'object' && !Array.isArray(variants)
      ? Object.keys(variants).filter((variant) => OPENCODE_VARIANT_ID.test(variant))
      : [];
    const limits = openCodeAutoCompactAt(metadata.value?.['limit']);
    const option: RuntimeModelOption = {
      id,
      label: id,
      ...(variantIds.length > 0
        ? { reasoningOptions: reasoningOptions(variantIds) }
        : {}),
      ...(limits ? { metadata: limits } : {}),
    };
    if (id.startsWith(OPENCODE_BUILT_IN_PROVIDER)) {
      builtIn.push(option);
      if (!isFreeModel(metadata.value)) builtInConnected = true;
    } else {
      models.push(option);
    }
    index = Math.max(index, metadata.end);
  }
  if (builtInConnected) models.push(...builtIn);
  return models.length > 1 || builtIn.length > 0 ? models : null;
}

function supportsOpenCodeVariant(
  modelId: string | null | undefined,
  variant: string | null | undefined,
): variant is string {
  if (!modelId || modelId === 'default' || !variant || variant === 'default') return false;
  const live = getRememberedLiveModels('opencode').find((model) => model.id === modelId);
  return Boolean(live?.reasoningOptions?.some((option) => option.id === variant));
}

export const opencodeAgentDef = {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode-cli',
    fallbackBins: ['opencode'],
    versionArgs: ['--version'],
    ...OPENCODE_PERMISSION_CAPABILITY,
    // `opencode models` prints `provider/model` per line. Real-world
    // `opencode models` calls can take >8s (network round-trip to the
    // provider registry), so the previous 8s budget timed out and fell back
    // to the hardcoded `fallbackModels`, hiding the user's actual catalog.
    // Allow cold-start CLI initialization to finish before falling back.
    listModels: {
      args: ['models', '--verbose'],
      parse: parseOpenCodeModels,
      timeoutMs: 15_000,
    },
    fallbackModels: OPENCODE_FALLBACK_MODELS,
    // OpenCode 1.18.x exposes provider/model-specific variants. Detection
    // reads the exact live variant keys from `models --verbose`. The fallback
    // keeps Sol/Terra/Luna model ids usable during a catalog outage but does
    // not guess their variants. Unknown model/variant pairs omit `--variant`
    // rather than inventing a provider capability or preventing the base
    // model from running.
    //
    // Prompt delivered via stdin (`opencode run` with no message argv) to
    // avoid Windows `spawn ENAMETOOLONG` while preserving OpenCode's
    // structured stream. A literal `-` is parsed as a positional message by
    // OpenCode 1.14.x and can surface as "Session not found".
    buildArgs: (_prompt, _imagePaths, _extra, options = {}, runtimeContext = {}) => {
      const args = [
        'run',
        '--format',
        'json',
      ];
      appendOpenCodePermissionBypass(args, 'opencode');
      appendOpenCodeWorkspaceDir(args, runtimeContext.cwd);
      // Capture-style resume: OpenCode mints its own session id (reported on
      // the stream as `sessionID`, e.g. `ses_...`). On a follow-up turn the
      // daemon continues that session with `-s <id>` instead of re-sending the
      // flattened transcript, so the first upstream call reuses the warm prefix
      // cache. `-s` continues an EXISTING session (the create turn passes no id
      // and we capture the one OpenCode generated), mirroring codex.
      const resumeSessionId =
        typeof runtimeContext.resumeSessionId === 'string' &&
        runtimeContext.resumeSessionId.length > 0
          ? runtimeContext.resumeSessionId
          : null;
      if (resumeSessionId) {
        args.push('-s', resumeSessionId);
      }
      if (options.model && options.model !== 'default') {
        args.push('-m', options.model);
      }
      if (supportsOpenCodeVariant(options.model, options.reasoning)) {
        args.push('--variant', options.reasoning);
      }
      return args;
    },
    promptViaStdin: true,
    // OpenCode's CLI carries its own session across spawns: on a follow-up turn
    // the daemon resumes the captured session id (`-s <id>`) instead of
    // re-flattening the transcript. Capture-style — the resume handle is the
    // `sessionID` captured from the stream, not a daemon-minted id.
    resumesSessionViaCli: true,
    capturesSessionIdFromStream: true,
    streamFormat: 'json-event-stream',
    eventParser: 'opencode',
    // OpenCode reads MCP servers from its layered config (global ~/.config
    // /opencode/opencode.json + project opencode.json + OPENCODE_CONFIG
    // + OPENCODE_CONFIG_CONTENT). The env-var form lets the daemon hand
    // user-configured external MCP servers to a single `opencode run`
    // invocation without polluting the user's saved config files. See
    // <https://opencode.ai/docs/config> and issue #2142.
    externalMcpInjection: 'opencode-env-content',
    extensionInjector: 'opencode-config-content',
} satisfies RuntimeAgentDef;
