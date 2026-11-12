import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPixoAgentCatalogResponse } from '@openpixo/contracts';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../src/account/cli-common.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/account/cli-common.js')>(),
  accountCliApi: async () => api.get,
}));

const { runCreditsCli } = await import('../../src/account/credits-cli.js');

const model = (id: string, label: string, creditsPerMillionTokens: OpenPixoAgentCatalogResponse['models'][number]['creditsPerMillionTokens']) => ({
  id, label, priceVersion: 1, creditsPerMillionTokens, contextTokens: 200_000, maxOutputTokens: 32_000,
  reasoningEfforts: [], defaultReasoningEffort: null,
});
const CATALOG: OpenPixoAgentCatalogResponse = {
  models: [
    model('openpixo-agent-flash', 'DeepSeek V4.1 Flash', { inputCacheMiss: 60, inputCacheHit: 1.2, output: 240 }),
    model('openpixo-agent-gpt-6-1-sol', 'GPT-6.1 Sol', { inputCacheMiss: 400, inputCacheHit: 20, inputCacheWrite: 500, output: 2000 }),
  ],
  limits: { maxConcurrent: 4, requestsPerMinute: 60, maxRequestBytes: 2_000_000 },
  agentPaused: false,
  signedIn: true,
};

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(CATALOG);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('pixo credits agent-models', () => {
  it('prints the same cost multiplier as the model picker', async () => {
    await runCreditsCli(['agent-models']);
    const text = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
    expect(api.get).toHaveBeenCalledWith('/agent/models');
    expect(text).toContain('openpixo-agent-flash  DeepSeek V4.1 Flash  1×');
    expect(text).toContain('openpixo-agent-gpt-6-1-sol  GPT-6.1 Sol  8.8×');
    expect(text).toContain('relative to DeepSeek V4.1 Flash');
  });

  it('adds the multiplier and its baseline to --json', async () => {
    await runCreditsCli(['agent-models', '--json']);
    const body = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])) as Record<string, any>;
    expect(body.costBaselineModel).toBe('openpixo-agent-flash');
    expect(body.models.map((item: { id: string; costMultiplier: number | null }) => [item.id, item.costMultiplier]))
      .toEqual([['openpixo-agent-flash', 1], ['openpixo-agent-gpt-6-1-sol', 8.78]]);
    expect(body.models[0].creditsPerMillionTokens).toEqual(CATALOG.models[0]!.creditsPerMillionTokens);
  });

  it('prints no multiplier when the default model is missing from the catalogue', async () => {
    api.get.mockResolvedValue({ ...CATALOG, models: [CATALOG.models[1]] });
    await runCreditsCli(['agent-models', '--json']);
    const body = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])) as Record<string, any>;
    expect(body.models[0].costMultiplier).toBeNull();
  });
});
