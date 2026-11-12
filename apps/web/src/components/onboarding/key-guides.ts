import type { Dict } from '../../i18n/types';
import type { KnownProvider } from '../../state/config';
import type { ApiProtocol } from '../../types';

/**
 * Plain-words help for the "use my own keys" guide: where each key comes from
 * and, when the daemon can prove a key for free, how to ask it.
 */

export interface ImageKeyProvider {
  /** Media provider id in `AppConfig.mediaProviders`. */
  id: 'openai' | 'nanobanana' | 'media-gateway' | 'openrouter';
  label: string;
  /** The page where the key is created. */
  consoleUrl: string;
  consoleHost: string;
  /** What the key usually starts with, as a placeholder. */
  placeholder: string;
  /** Default endpoint the daemon calls; stored with the key like Settings does. */
  baseUrl: string;
  /** One sentence on what to click once the console is open. */
  howTo: keyof Dict;
  /**
   * Proving a key through `/api/provider/models` lists models and spends
   * nothing. Providers without such a check (a public model list proves
   * nothing) are saved and checked on the first image instead.
   */
  verify: { protocol: ApiProtocol; baseUrl: string } | null;
}

export const IMAGE_KEY_PROVIDERS: readonly ImageKeyProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI (GPT Image)',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleHost: 'platform.openai.com',
    placeholder: 'sk-…',
    baseUrl: 'https://api.openai.com/v1',
    howTo: 'onboarding.imageKeyHowOpenai',
    verify: { protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  },
  {
    id: 'nanobanana',
    label: 'Google (Nano Banana)',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleHost: 'aistudio.google.com',
    placeholder: 'AIza…',
    baseUrl: 'https://generativelanguage.googleapis.com',
    howTo: 'onboarding.imageKeyHowGoogle',
    verify: { protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com' },
  },
  {
    id: 'media-gateway',
    label: 'fal.ai',
    consoleUrl: 'https://fal.ai/dashboard/keys',
    consoleHost: 'fal.ai',
    placeholder: 'key-id:secret',
    baseUrl: 'https://fal.run',
    howTo: 'onboarding.imageKeyHowFal',
    verify: null,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    consoleUrl: 'https://openrouter.ai/settings/keys',
    consoleHost: 'openrouter.ai',
    placeholder: 'sk-or-…',
    baseUrl: 'https://openrouter.ai/api/v1',
    howTo: 'onboarding.imageKeyHowOpenrouter',
    verify: null,
  },
];

export function imageKeyProvider(id: string | null | undefined): ImageKeyProvider | null {
  return IMAGE_KEY_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** Key consoles for the agent's API-key providers, matched by the preset's base URL. */
const AGENT_KEY_CONSOLES: Record<string, { host: string; url: string }> = {
  'https://api.anthropic.com': { host: 'console.anthropic.com', url: 'https://console.anthropic.com/settings/keys' },
  'https://api.openai.com/v1': { host: 'platform.openai.com', url: 'https://platform.openai.com/api-keys' },
  'https://api.deepseek.com': { host: 'platform.deepseek.com', url: 'https://platform.deepseek.com/api_keys' },
  'https://api.deepseek.com/anthropic': { host: 'platform.deepseek.com', url: 'https://platform.deepseek.com/api_keys' },
  'https://openrouter.ai/api/v1': { host: 'openrouter.ai', url: 'https://openrouter.ai/settings/keys' },
  'https://generativelanguage.googleapis.com': { host: 'aistudio.google.com', url: 'https://aistudio.google.com/apikey' },
  'https://api.x.ai/v1': { host: 'console.x.ai', url: 'https://console.x.ai' },
  'https://api.moonshot.cn/v1': { host: 'platform.moonshot.cn', url: 'https://platform.moonshot.cn/console/api-keys' },
  'https://open.bigmodel.cn/api/paas/v4': { host: 'open.bigmodel.cn', url: 'https://open.bigmodel.cn/usercenter/apikeys' },
  'https://dashscope.aliyuncs.com/compatible-mode/v1': { host: 'bailian.console.aliyun.com', url: 'https://bailian.console.aliyun.com/?apiKey=1' },
};

/** Where the selected agent provider's key is made; `null` for custom endpoints. */
export function agentKeyConsole(provider: KnownProvider | null): { host: string; url: string } | null {
  if (!provider) return null;
  return AGENT_KEY_CONSOLES[provider.baseUrl] ?? provider.apiKeyConsoleLink ?? null;
}
