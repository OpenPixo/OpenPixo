export type NativeCodexProvider = {
  id: 'deepseek' | 'openrouter';
  baseUrl: string;
};

/** Only the documented first-release Responses endpoints use native Codex. */
export function nativeCodexProviderForConfig(config: {
  protocol?: string | undefined;
  baseUrl?: string | undefined;
}): NativeCodexProvider | null {
  if (config.protocol !== 'openai' || typeof config.baseUrl !== 'string') return null;
  const match = /^https:\/\/([^/]+)(\/[^?#]*)?$/iu.exec(config.baseUrl.trim());
  if (!match) return null;
  const host = match[1]?.toLowerCase();
  const path = match[2] ?? '';
  if (host === 'api.deepseek.com' && (path === '' || path === '/')) {
    return { id: 'deepseek', baseUrl: 'https://api.deepseek.com' };
  }
  if (host === 'openrouter.ai' && (path === '/api/v1' || path === '/api/v1/')) {
    return { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' };
  }
  return null;
}
