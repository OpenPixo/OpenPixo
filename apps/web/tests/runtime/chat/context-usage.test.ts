import { describe, expect, it } from 'vitest';
import { formatContextTokens, latestContextUsage } from '../../../src/runtime/chat/context-usage';

const assistant = (events: unknown[], agentId = 'openpixo-agent') => ({ role: 'assistant', agentId, events: events as never });
const usage = (usedTokens: number, limitTokens?: number, autoCompactAtTokens?: number) =>
  ({ kind: 'context_usage', usedTokens, ...(limitTokens ? { limitTokens } : {}), ...(autoCompactAtTokens ? { autoCompactAtTokens } : {}) });

describe('latestContextUsage', () => {
  it('reports the newest reading against its limit', () => {
    const view = latestContextUsage([assistant([usage(10, 200_000), usage(50_000, 200_000, 183_616)])], 'openpixo-agent');
    expect(view).toEqual({ usedTokens: 50_000, limitTokens: 200_000, percent: 25, autoCompactAtTokens: 183_616, autoCompactPercent: 92,
      untilCompactTokens: 133_616, parts: {}, compactions: 0 });
  });

  it('says what the latest call was made of, and how often this conversation compacted', () => {
    const compacted = { kind: 'context_compacted', trigger: 'auto' };
    const detailed = { ...usage(40_000), freshInputTokens: 2_000, cachedInputTokens: 36_000, outputTokens: 2_000, reasoningTokens: 500, junk: 9 };
    const view = latestContextUsage([assistant([usage(190_000, 200_000), compacted]), assistant([detailed, usage(40_000, 200_000, 168_000)])], 'openpixo-agent');
    expect(view).toMatchObject({ untilCompactTokens: 128_000, compactions: 1 });
    expect(view?.parts).toEqual({ freshInputTokens: 2_000, cachedInputTokens: 36_000, outputTokens: 2_000, reasoningTokens: 500 });
  });

  it('never shows a negative distance to compaction', () => {
    expect(latestContextUsage([assistant([usage(180_000, 200_000, 168_000)])], 'openpixo-agent')?.untilCompactTokens).toBe(0);
  });

  it('shows nothing without real data', () => {
    expect(latestContextUsage([], 'codex')).toBeNull();
    expect(latestContextUsage([{ role: 'user', events: [usage(1, 2)] as never }], 'codex')).toBeNull();
    // A reading with no stated limit anywhere is not a number we can put a percentage on.
    expect(latestContextUsage([assistant([usage(10)])], 'openpixo-agent')).toBeNull();
  });

  it('takes the limit from an earlier report when the runtime states it rarely', () => {
    const view = latestContextUsage([assistant([usage(100, 1_000)], 'claude'), { role: 'user' }, assistant([usage(500)], 'claude')], 'claude');
    expect(view).toMatchObject({ usedTokens: 500, limitTokens: 1_000, percent: 50 });
  });

  it('hides another agent’s numbers once the user has switched', () => {
    expect(latestContextUsage([assistant([usage(10, 100)], 'codex')], 'claude')).toBeNull();
  });

  it('hides right after a compaction until the next reading', () => {
    const compacted = { kind: 'context_compacted', trigger: 'auto' };
    expect(latestContextUsage([assistant([usage(190_000, 200_000), compacted])], 'openpixo-agent')).toBeNull();
    expect(latestContextUsage([assistant([usage(190_000, 200_000), compacted, usage(9_000, 200_000)])], 'openpixo-agent'))
      .toMatchObject({ usedTokens: 9_000, percent: 5 });
  });

  it('caps the percentage at full', () => {
    expect(latestContextUsage([assistant([usage(250, 200)])], 'openpixo-agent')?.percent).toBe(100);
  });
});

describe('formatContextTokens', () => {
  it('stays short', () => {
    expect(formatContextTokens(850)).toBe('850');
    expect(formatContextTokens(43_250)).toBe('43.3k');
    expect(formatContextTokens(183_616)).toBe('184k');
    expect(formatContextTokens(1_050_000)).toBe('1.05M');
  });
});
