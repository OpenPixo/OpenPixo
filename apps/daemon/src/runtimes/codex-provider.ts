import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  nativeCodexProviderForConfig,
  type ByokChatProviderConfig,
  type NativeCodexProvider,
} from '@openpixo/contracts';

export const CODEX_PROVIDER_KEY_ENV = 'OPENPIXO_CODEX_PROVIDER_KEY';
export const CODEX_PROVIDER_AUTH_PROGRAM = `process.stdout.write(process.env.${CODEX_PROVIDER_KEY_ENV} || "")`;

export class NativeCodexProviderError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function nativeCodexProviderSupportsVersion(version: string | null | undefined): boolean {
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(version ?? '');
  return Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 160));
}

export interface PreparedNativeCodexProvider {
  provider: NativeCodexProvider;
  providerId: string;
  model: string;
  sessionIdentity: string;
  configArgs: string[];
  env: NodeJS.ProcessEnv;
  suppressReasoningSummary: boolean;
}

// The catalog loader requires a base template. Task/skill instructions still
// come from the daemon's composed per-turn prompt, as on the default path.
const DEEPSEEK_BASE_INSTRUCTIONS = 'You are OpenPixo, a coding assistant. Follow the user, project and skill instructions provided for this task.';

export function deepSeekCodexCatalog() {
  return {
    models: [
      { slug: 'deepseek-flash', display_name: 'DeepSeek Flash', input_modalities: ['text', 'image'], supports_image_detail_original: true },
      { slug: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', input_modalities: ['text'], supports_image_detail_original: false },
    ].map((model) => ({
      ...model,
      model_messages: { instructions_template: DEEPSEEK_BASE_INSTRUCTIONS },
      supported_reasoning_levels: ['low', 'high', 'max'].map((effort) => ({ effort, description: `${effort} reasoning effort` })),
      default_reasoning_level: 'high',
      shell_type: 'shell_command', visibility: 'list', supported_in_api: true, priority: 0,
      support_verbosity: true, default_verbosity: 'low', apply_patch_tool_type: 'freeform',
      truncation_policy: { mode: 'tokens', limit: 10000 }, experimental_supported_tools: [],
      context_window: 1048576, max_context_window: 1048576, multi_agent_version: 'v2',
      supports_reasoning_summary_parameter: false,
    })),
  };
}

/** Explicit snapshots never fall back to the user's default Codex account. */
export async function prepareNativeCodexProvider(input: {
  config: ByokChatProviderConfig;
  model?: unknown;
  reasoning?: unknown;
  imagePaths?: readonly unknown[];
  dataDir: string;
  nodeExecutable: string;
}): Promise<PreparedNativeCodexProvider> {
  const provider = nativeCodexProviderForConfig(input.config);
  if (!provider) throw new NativeCodexProviderError('BYOK_PROVIDER_UNSUPPORTED', 'Native Codex supports the canonical DeepSeek and OpenRouter OpenAI Responses endpoints. Select a supported preset.');
  const apiKey = typeof input.config.apiKey === 'string' ? input.config.apiKey.trim() : '';
  if (!apiKey) throw new NativeCodexProviderError('AGENT_AUTH_REQUIRED', `${provider.id === 'deepseek' ? 'DeepSeek' : 'OpenRouter'} API key is required. Configure this provider in Settings.`);
  const rawModel = typeof input.model === 'string' && input.model.trim() ? input.model : input.config.model;
  const model = typeof rawModel === 'string' ? rawModel.trim() : '';
  if (!model || model === 'default') throw new NativeCodexProviderError('MODEL_UNAVAILABLE', 'Select an explicit model for the native provider.');
  if (provider.id === 'deepseek') {
    if (model !== 'deepseek-flash' && model !== 'deepseek-v4-pro') throw new NativeCodexProviderError('MODEL_UNAVAILABLE', 'DeepSeek native Codex supports deepseek-flash and deepseek-v4-pro. Select a current model.');
    if (model === 'deepseek-v4-pro' && input.imagePaths?.length) throw new NativeCodexProviderError('AGENT_CAPABILITY_UNSUPPORTED', 'DeepSeek V4 Pro accepts text input. Select DeepSeek Flash to attach images.');
    if (typeof input.reasoning === 'string' && input.reasoning !== 'default' && !['low', 'high', 'max'].includes(input.reasoning)) throw new NativeCodexProviderError('AGENT_CAPABILITY_UNSUPPORTED', 'DeepSeek supports reasoning effort low, high or max.');
  } else if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]*\/[A-Za-z0-9][A-Za-z0-9._/:@-]*$/u.test(model)) {
    throw new NativeCodexProviderError('MODEL_UNAVAILABLE', 'OpenRouter requires the complete organization/model identifier.');
  }
  const credentialFingerprint = createHash('sha256').update(apiKey).digest('hex');
  const identity = createHash('sha256').update(JSON.stringify([provider.id, provider.baseUrl, model, credentialFingerprint])).digest('hex');
  const home = path.resolve(input.dataDir, 'agent-runtime-homes', 'codex', 'providers', identity);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const providerId = `openpixo_${provider.id}`;
  const auth = provider.id === 'openrouter'
    ? `auth={command=${JSON.stringify(input.nodeExecutable)},args=["-e",${JSON.stringify(CODEX_PROVIDER_AUTH_PROGRAM)}],timeout_ms=5000,refresh_interval_ms=300000}`
    : `env_key=${JSON.stringify(CODEX_PROVIDER_KEY_ENV)}`;
  const configArgs = [
    '-c', `model_provider=${JSON.stringify(providerId)}`,
    '-c', `model=${JSON.stringify(model)}`,
    '-c', `model_providers.${providerId}={name=${JSON.stringify(provider.id === 'deepseek' ? 'DeepSeek' : 'OpenRouter')},base_url=${JSON.stringify(provider.baseUrl)},wire_api="responses",requires_openai_auth=false,supports_websockets=false,${auth}}`,
  ];
  if (provider.id === 'deepseek') {
    const catalogPath = path.join(home, 'models.json');
    const temporaryPath = path.join(home, `${randomUUID()}.tmp`);
    await writeFile(temporaryPath, JSON.stringify(deepSeekCodexCatalog()), { mode: 0o600 });
    await rename(temporaryPath, catalogPath);
    configArgs.push('-c', `model_catalog_json=${JSON.stringify(catalogPath)}`, '-c', 'model_reasoning_summary="none"', '-c', 'web_search="disabled"');
  }
  return {
    provider, providerId, model, configArgs,
    sessionIdentity: `codex-provider:${providerId}:${identity}`,
    suppressReasoningSummary: provider.id === 'deepseek',
    // Native Codex inherits this flag into its fixed Node auth subprocess;
    // packaged installations use Electron as that Node-compatible executable.
    env: { CODEX_HOME: home, [CODEX_PROVIDER_KEY_ENV]: apiKey, OPENAI_API_KEY: undefined, CODEX_API_KEY: undefined, ELECTRON_RUN_AS_NODE: '1' },
  };
}
