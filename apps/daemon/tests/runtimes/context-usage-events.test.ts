import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCodexAppServerNormalizer } from '../../src/agent-protocol/codex-app-server/normalize.js';
import { openpixoAgentDef } from '../../src/runtimes/defs/openpixo-agent.js';
import { openCodeAutoCompactAt, opencodeAgentDef, parseOpenCodeModels } from '../../src/runtimes/defs/opencode.js';
import { contextLimitsForRun } from '../../src/runtimes/context-limits.js';
import { createClaudeStreamHandler } from '../../src/runtimes/claude-stream.js';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.js';
import { rememberLiveModels, resetLiveModelsForTests } from '../../src/runtimes/models.js';

type Ev = Record<string, any>;
const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');

function openCode() {
  const events: Ev[] = [];
  const handler = createJsonEventStreamHandler('opencode', (event: Ev) => events.push(event));
  return { events, handler, text: () => events.filter((event) => event.type === 'text_delta').map((event) => event.delta) };
}

const step = (reason: string, total = 100) => JSON.stringify({ type: 'step_finish', sessionID: 's', part: { type: 'step-finish', reason, tokens: { total, input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 } });
const said = (text: string) => JSON.stringify({ type: 'text', sessionID: 's', part: { type: 'text', text } });

describe('OpenCode context reporting', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('replays a real compaction: one mark, no summary and no host prompt in the chat', () => {
    const { events, handler, text } = openCode();
    handler.feed(fixture('opencode-cli-recordings/opencode-1.18.35-auto-compaction.jsonl'));
    handler.flush();
    const compacted = events.filter((event) => event.type === 'context_compacted');
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toEqual({ type: 'context_compacted', trigger: 'auto', tokensBefore: 190010 });
    // "reply 2" is the summary the model wrote; "Continue if…" is OpenCode prompting itself.
    expect(text()).toEqual(['reply 3']);
    expect(events.filter((event) => event.type === 'context_usage').map((event) => event.usedTokens)).toEqual([190010, 1010, 1010]);
  });

  it('keeps a turn-ending answer if no compaction mark follows', () => {
    const { handler, text } = openCode();
    handler.feed(`${said('answer')}\n${step('stop')}\n`);
    expect(text()).toEqual([]);
    handler.flush();
    expect(text()).toEqual(['answer']);
  });

  it('does not sit on an answer when the process stays alive after it', () => {
    vi.useFakeTimers();
    const { handler, text } = openCode();
    handler.feed(`${said('answer')}\n${step('stop')}\n`);
    vi.advanceTimersByTime(1_000);
    expect(text()).toEqual(['answer']);
  });

  it('releases text at once when the step went on to work', () => {
    const { handler, text, events } = openCode();
    handler.feed(`${said('let me look')}\n${step('tool-calls')}\n`);
    expect(text()).toEqual(['let me look']);
    expect(events.map((event) => event.type)).toEqual(['text_delta', 'usage', 'context_usage']);
  });

  it('never shows the host prompting itself, even without a compaction', () => {
    const { handler, text, events } = openCode();
    handler.feed(`${JSON.stringify({ type: 'text', part: { type: 'text', text: 'internal', synthetic: true } })}\n`);
    handler.flush();
    expect(text()).toEqual([]);
    expect(events.some((event) => event.type === 'context_compacted')).toBe(false);
  });
});

describe('Claude Code context reporting', () => {
  it('reads usage and the window from a real recording', () => {
    const events: Ev[] = [];
    const handler = createClaudeStreamHandler((event: Ev) => events.push(event));
    handler.feed(fixture('claude-cli-recordings/claude-2.1.259-no-partial-messages.jsonl'));
    handler.flush();
    const usage = events.filter((event) => event.type === 'context_usage');
    expect(usage.length).toBeGreaterThan(1);
    expect(usage.at(-1)!.limitTokens).toBeGreaterThan(100_000);
    expect(usage.at(-1)!.usedTokens).toBeGreaterThan(0);
    expect(usage[0]!.limitTokens).toBeUndefined();
  });

  it('reports a compaction boundary with its size', () => {
    const events: Ev[] = [];
    const handler = createClaudeStreamHandler((event: Ev) => events.push(event));
    handler.feed(`${JSON.stringify({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 167_000 } })}\n`);
    handler.flush();
    expect(events).toContainEqual({ type: 'context_compacted', trigger: 'auto', tokensBefore: 167_000 });
  });
});

describe('Codex context reporting', () => {
  const drive = (method: string, params: Ev) => {
    const events: Ev[] = [];
    createCodexAppServerNormalizer((event: Ev) => events.push(event)).handleNotification(method, params);
    return events;
  };

  it('uses the last call against the stated window, not the running total', () => {
    const events = drive('thread/tokenUsage/updated', { threadId: 't', turnId: 'u', tokenUsage: {
      total: { totalTokens: 900_000, inputTokens: 890_000, outputTokens: 10_000 },
      last: { totalTokens: 41_000, inputTokens: 40_000, cachedInputTokens: 30_000, outputTokens: 1_000, reasoningOutputTokens: 200 }, modelContextWindow: 258_400 } });
    // Codex's input includes what came from the cache; the fresh part is the difference.
    expect(events).toContainEqual({ type: 'context_usage', usedTokens: 41_000, limitTokens: 258_400,
      freshInputTokens: 10_000, cachedInputTokens: 30_000, outputTokens: 1_000, reasoningTokens: 200 });
  });

  it('leaves the limit absent when the CLI does not state one', () => {
    const events = drive('thread/tokenUsage/updated', { threadId: 't', turnId: 'u', tokenUsage: {
      total: { totalTokens: 7 }, last: { totalTokens: 7 }, modelContextWindow: null } });
    expect(events).toContainEqual({ type: 'context_usage', usedTokens: 7 });
  });
});

describe('what the picker shows for OpenCode', () => {
  const entry = (id: string, cost = 0, limit: Ev = { context: 1_000_000, output: 64_000 }) =>
    `${id}\n${JSON.stringify({ id, cost: { input: cost, output: cost }, limit }, null, 2)}\n`;

  it('shows nothing of the built-in free list when no provider is connected', () => {
    expect(parseOpenCodeModels(entry('opencode/big-pickle') + entry('opencode/beam-free'))!.map((model) => model.id)).toEqual(['default']);
  });

  it('shows only the connected provider once there is one', () => {
    const ids = parseOpenCodeModels(entry('opencode/big-pickle') + entry('openai/gpt-5', 3))!.map((model) => model.id);
    expect(ids).toEqual(['default', 'openai/gpt-5']);
  });

  it('counts the built-in provider as connected once a key unlocks paid models', () => {
    const ids = parseOpenCodeModels(entry('opencode/big-pickle') + entry('opencode/paid-one', 2))!.map((model) => model.id);
    expect(ids).toEqual(['default', 'opencode/big-pickle', 'opencode/paid-one']);
  });

  it('suggests no provider the user did not connect when the catalogue fails', () => {
    expect(opencodeAgentDef.fallbackModels.map((model) => model.id)).toEqual(['default']);
  });

  it('computes the threshold OpenCode 1.18 was measured to compact at', () => {
    // Measured against the real binary: 183,500 tokens did not compact, 183,700 did.
    expect(openCodeAutoCompactAt({ context: 200_000, output: 16_384 })?.autoCompactAtTokens).toBe(183_616);
    expect(openCodeAutoCompactAt({ context: 400_000, input: 272_000, output: 128_000 })?.autoCompactAtTokens).toBe(252_000);
    expect(openCodeAutoCompactAt({ context: 0, output: 10 })).toBeNull();
  });
});

describe('limits a run reports', () => {
  afterEach(resetLiveModelsForTests);

  it('are the ones the hosted run hands OpenCode', () => {
    expect(contextLimitsForRun(openpixoAgentDef, 'openpixo/openpixo-agent-flash')).toEqual({ limitTokens: 200_000, autoCompactAtTokens: 168_000 });
  });

  it('come from the model the user picked, and are unknown otherwise', () => {
    rememberLiveModels('opencode', parseOpenCodeModels(`openai/gpt-5\n${JSON.stringify({ id: 'x', cost: { input: 1, output: 1 }, limit: { context: 128_000, output: 16_000 } }, null, 2)}\n`)!);
    expect(contextLimitsForRun(opencodeAgentDef, 'openai/gpt-5')).toEqual({ limitTokens: 128_000, autoCompactAtTokens: 112_000 });
    expect(contextLimitsForRun(opencodeAgentDef, 'default')).toBeNull();
    expect(contextLimitsForRun({ ...opencodeAgentDef, id: 'claude' }, 'x')).toBeNull();
  });
});
