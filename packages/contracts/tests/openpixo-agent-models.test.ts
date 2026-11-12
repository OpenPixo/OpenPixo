import { describe, expect, it } from 'vitest';
import {
  formatCostMultiplier,
  hostedModelCostMultiplier,
  hostedModelCostMultipliers,
  isRetiredOpenPixoAgentModel,
  OPENPIXO_AGENT_DEFAULT_MODEL,
  typicalAgentTurnCreditsPerMillion,
} from '../src/index.js';

// The cloud's credits per million tokens on 2026-11-09 (US$ list price × 100 × markup 2).
const CATALOGUE = [
  { id: 'openpixo-agent-flash', creditsPerMillionTokens: { inputCacheMiss: 60, inputCacheHit: 1.2, output: 240 } },
  { id: 'openpixo-agent-glm-5-3-flash', creditsPerMillionTokens: { inputCacheMiss: 30, inputCacheHit: 6, output: 100 } },
  { id: 'openpixo-agent-hy4', creditsPerMillionTokens: { inputCacheMiss: 166.8, inputCacheHit: 8.4, output: 500.2 } },
  { id: 'openpixo-agent-gpt-6-luna', creditsPerMillionTokens: { inputCacheMiss: 20, inputCacheHit: 2, inputCacheWrite: 25, output: 100 } },
  { id: 'openpixo-agent-gpt-6-1-sol', creditsPerMillionTokens: { inputCacheMiss: 400, inputCacheHit: 20, inputCacheWrite: 500, output: 2000 } },
];

describe('hosted model cost multiplier', () => {
  it('weighs a typical turn as 85% cached input, 10% new input and 5% output', () => {
    expect(typicalAgentTurnCreditsPerMillion({ inputCacheMiss: 100, inputCacheHit: 10, output: 1000 })).toBeCloseTo(8.5 + 10 + 50);
    // New input costs the cache-write rate where a model bills one.
    expect(typicalAgentTurnCreditsPerMillion({ inputCacheMiss: 100, inputCacheHit: 10, inputCacheWrite: 200, output: 1000 })).toBeCloseTo(8.5 + 20 + 50);
  });

  it('compares every model in the catalogue with DeepSeek V4.1 Flash', () => {
    expect(OPENPIXO_AGENT_DEFAULT_MODEL).toBe('openpixo-agent-flash');
    const labels = Object.fromEntries([...hostedModelCostMultipliers(CATALOGUE)].map(([id, value]) => [id, formatCostMultiplier(value)]));
    expect(labels).toEqual({
      'openpixo-agent-flash': '1×',
      'openpixo-agent-glm-5-3-flash': '0.7×',
      'openpixo-agent-hy4': '2.6×',
      'openpixo-agent-gpt-6-luna': '0.5×',
      'openpixo-agent-gpt-6-1-sol': '8.8×',
    });
  });

  it('gives nothing for a model without prices, or for any model when the baseline has none', () => {
    expect(hostedModelCostMultiplier(undefined, CATALOGUE[0]!.creditsPerMillionTokens)).toBeNull();
    expect(hostedModelCostMultiplier({ inputCacheHit: 1, output: 1 }, CATALOGUE[0]!.creditsPerMillionTokens)).toBeNull();
    expect(hostedModelCostMultiplier(CATALOGUE[1]!.creditsPerMillionTokens, { inputCacheMiss: 0, inputCacheHit: 0, output: 0 })).toBeNull();
    const withoutPrices = hostedModelCostMultipliers([{ id: 'openpixo-agent-flash' }, CATALOGUE[2]!]);
    expect(withoutPrices.size).toBe(0);
    const partly = hostedModelCostMultipliers([CATALOGUE[0]!, { id: 'openpixo-agent-new' }]);
    expect([...partly.keys()]).toEqual(['openpixo-agent-flash']);
  });

  it('prints one decimal below ten, whole numbers from ten, and never zero', () => {
    expect(formatCostMultiplier(1)).toBe('1×');
    expect(formatCostMultiplier(0.48)).toBe('0.5×');
    expect(formatCostMultiplier(2.567)).toBe('2.6×');
    expect(formatCostMultiplier(3.04)).toBe('3×');
    expect(formatCostMultiplier(9.94)).toBe('9.9×');
    expect(formatCostMultiplier(9.96)).toBe('10×');
    expect(formatCostMultiplier(12.4)).toBe('12×');
    expect(formatCostMultiplier(0.01)).toBe('0.1×');
  });
});

describe('retired hosted models', () => {
  it('names DeepSeek V4 Pro as retired, with or without the provider prefix', () => {
    expect(isRetiredOpenPixoAgentModel('openpixo-agent-pro')).toBe(true);
    expect(isRetiredOpenPixoAgentModel('openpixo/openpixo-agent-pro')).toBe(true);
    expect(isRetiredOpenPixoAgentModel('openpixo-agent-flash')).toBe(false);
    expect(isRetiredOpenPixoAgentModel(undefined)).toBe(false);
  });
});
