import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCodexAppServerNormalizer } from '../src/agent-protocol/codex-app-server/normalize.js';

type Event = Record<string, unknown>;
const METHOD = 'mcpServer/startupStatus/updated';
const captured = readFileSync(new URL('./fixtures/codex-app-server/mcp-startup-0.160.0.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map(line => JSON.parse(line) as { method: string; params: Record<string, unknown> });

function harness(threadId?: string) {
  const events: Event[] = [];
  const normalizer = createCodexAppServerNormalizer(event => events.push(event), Date.now, undefined, () => threadId ?? null);
  const startup = (params: Record<string, unknown>) => normalizer.handleNotification(METHOD, { threadId: null, error: null, failureReason: null, ...params });
  return { events, normalizer, startup };
}

describe('native Codex MCP connection feedback', () => {
  it('replays actual Codex 0.160.0 startup failure as nonfatal feedback', () => {
    const { normalizer, events } = harness();
    for (const frame of captured) normalizer.handleNotification(frame.method, frame.params);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'status', label: 'mcp_connection', detail: 'openpixo_feedback_probe: starting' });
    expect(events[1]).toEqual({ type: 'status', label: 'mcp_connection', detail: `openpixo_feedback_probe: failed — ${captured[1]?.params.error}` });
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(normalizer.stats()).toEqual({ unknownNotifications: 0, unknownItems: 0 });
  });

  it.each(['starting', 'ready', 'cancelled'])('preserves the native %s state without inventing a tool call', status => {
    const { events, startup } = harness();
    startup({ name: 'assets', status });
    expect(events).toEqual([{ type: 'status', label: 'mcp_connection', detail: `assets: ${status}` }]);
  });

  it('replays the actual native ready feedback from the reviewed local MCP fixture', () => {
    const { normalizer, events } = harness();
    const lines = readFileSync(new URL('./fixtures/codex-app-server/mcp-ready-0.160.0.jsonl', import.meta.url), 'utf8').trim().split('\n');
    for (const line of lines) {
      const frame = JSON.parse(line);
      normalizer.handleNotification(frame.method, frame.params);
    }
    expect(events.at(-1)).toEqual({ type: 'status', label: 'mcp_connection', detail: 'openpixo_feedback_probe: ready' });
  });

  it('keeps authentication failure reasons even when Codex has no error text', () => {
    const { events, startup } = harness();
    startup({ name: 'assets', status: 'failed', failureReason: 'reauthenticationRequired' });
    expect(events).toEqual([{ type: 'status', label: 'mcp_connection', detail: 'assets: failed (reauthenticationRequired)' }]);
  });

  it('retains another server failure when the status renderer coalesces consecutive labels', () => {
    const { events, startup } = harness();
    startup({ name: 'broken', status: 'failed', error: 'startup timed out' });
    startup({ name: 'working', status: 'ready' });
    expect(events.at(-1)).toEqual({ type: 'status', label: 'mcp_connection', detail: 'broken: failed — startup timed out\nworking: ready' });
    startup({ name: 'broken', status: 'ready' });
    expect(events.at(-1)?.detail).toBe('broken: ready\nworking: ready');
  });

  it('attributes nullable-thread startup to its own session and drops foreign thread updates', () => {
    const first = harness('thread-a');
    const second = harness('thread-b');
    first.startup({ name: 'a-assets', status: 'ready' });
    first.startup({ threadId: 'thread-b', name: 'b-assets', status: 'failed', error: 'foreign failure' });
    second.startup({ threadId: 'thread-b', name: 'b-assets', status: 'failed', error: 'own failure' });
    expect(first.events).toEqual([{ type: 'status', label: 'mcp_connection', detail: 'a-assets: ready' }]);
    expect(second.events).toEqual([{ type: 'status', label: 'mcp_connection', detail: 'b-assets: failed — own failure' }]);
  });

  it('ignores malformed or future states rather than claiming a connection', () => {
    const { events, startup } = harness();
    startup({ name: '', status: 'ready' });
    startup({ name: 'assets', status: 'unknown' });
    startup({ name: 'assets', status: null });
    expect(events).toEqual([]);
  });

  it('scrubs recognized credentials from native error text before publishing or retaining it', () => {
    const { events, startup } = harness();
    startup({ name: 'assets', status: 'failed', error: 'Authorization: Bearer abcdef0123456789abcdef0123456789; x-api-key: private-key-value' });
    startup({ name: 'other', status: 'ready' });
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.detail).toContain('[REDACTED:bearer_token]');
      expect(event.detail).toContain('[REDACTED:api_key_header]');
      expect(event.detail).not.toContain('abcdef0123456789');
      expect(event.detail).not.toContain('private-key-value');
    }
  });
});
