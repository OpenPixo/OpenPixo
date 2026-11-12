import { describe, expect, it } from 'vitest';
import { nativeCodexProviderForConfig } from '../src/api/nativeCodexProvider.js';

describe('nativeCodexProviderForConfig', () => {
  it.each([
    ['https://api.deepseek.com', 'deepseek', 'https://api.deepseek.com'],
    [' HTTPS://API.DEEPSEEK.COM/ ', 'deepseek', 'https://api.deepseek.com'],
    ['https://openrouter.ai/api/v1', 'openrouter', 'https://openrouter.ai/api/v1'],
    ['https://openrouter.ai/api/v1/', 'openrouter', 'https://openrouter.ai/api/v1'],
  ])('canonicalizes %s', (baseUrl, id, canonical) => {
    expect(nativeCodexProviderForConfig({ protocol: 'openai', baseUrl }))
      .toEqual({ id, baseUrl: canonical });
  });

  it.each([
    undefined, '', 'http://api.deepseek.com', 'https://api.deepseek.com/v1',
    'https://api.deepseek.com:443', 'https://api.deepseek.com?token=x',
    'https://api.deepseek.com/#x', 'https://key@api.deepseek.com',
    'https://api.deepseek.com.evil.test', 'https://openrouter.ai',
    'https://openrouter.ai/API/v1', 'https://openrouter.ai/api/v1/responses',
    'https://openrouter.ai/api/v1?x=y', 'https://openrouter.ai/api/v1#x',
    'https://openrouter.ai:443/api/v1', 'https://localhost/api/v1',
  ])('does not claim an unsupported endpoint %s', (baseUrl) => {
    expect(nativeCodexProviderForConfig({ protocol: 'openai', baseUrl })).toBeNull();
  });

  it.each(['anthropic', 'azure', 'google', undefined])('preserves protocol %s', (protocol) => {
    expect(nativeCodexProviderForConfig({ protocol, baseUrl: 'https://api.deepseek.com' })).toBeNull();
  });
});
