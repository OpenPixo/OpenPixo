import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUsageEventsClient, toUsageEvent } from '../src/usage-events-client.js';

const NOW = new Date('2026-11-14T08:00:00.000Z');

describe('usage events from the analytics service', () => {
  it('lifts the envelope fields and keeps only counts in properties', () => {
    const event = toUsageEvent({
      distinctId: 'install-1',
      event: 'run_finished',
      properties: {
        $insert_id: 'evt-1', $os: 'Windows', app_session_id: 'session-1', app_version: '1.0.5', channel: 'stable',
        client_type: 'desktop', occurred_at: '2026-11-14T07:59:00.000Z',
        model_id: 'gpt-6-luna', input_tokens: 1200, deliverable_valid: true, tool_names: ['Read', 'Edit'],
        error_message: 'Cannot read C:\\Users\\me\\game\\hero.png', prompt: '做一个猫的游戏', url: 'https://x.example/a?b=c',
        nested: { a: 1 }, $set: { name: 'x' },
      },
    }, NOW);
    expect(event).toEqual({
      event: 'run_finished', event_id: 'evt-1', device_id: 'install-1', session_id: 'session-1',
      occurred_at: '2026-11-14T07:59:00.000Z', app_version: '1.0.5', channel: 'stable', client_type: 'desktop', os: 'Windows',
      properties: { model_id: 'gpt-6-luna', input_tokens: 1200, deliverable_valid: true, tool_names: ['Read', 'Edit'] },
    });
  });

  it('drops an event it cannot make valid instead of sending it half-formed', () => {
    expect(toUsageEvent({ distinctId: 'install-1', event: '$identify', properties: {} }, NOW)).toBeNull();
    expect(toUsageEvent({ distinctId: 'not an id', event: 'run_finished', properties: {} }, NOW)).toBeNull();
  });
});

describe('the usage events client', () => {
  afterEach(() => { vi.useRealTimers(); });

  function fakeFetch(statuses: number[]) {
    const bodies: Array<{ schema: number; events: Array<{ event: string }> }> = [];
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: statuses.shift() ?? 200 });
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, bodies, urls };
  }

  it('posts batches of at most 50 to /v1/events and flushes on shutdown', async () => {
    const { fetchImpl, bodies, urls } = fakeFetch([]);
    const client = createUsageEventsClient({ url: 'https://events.test.invalid/', fetchImpl, flushIntervalMs: 60_000, now: () => NOW });
    for (let i = 0; i < 60; i++) client.capture({ distinctId: 'install-1', event: 'recipe_run_settled', properties: { $insert_id: `e${i}` } });
    await client.shutdown();
    expect(urls.every(url => url === 'https://events.test.invalid/v1/events')).toBe(true);
    expect(bodies.map(body => body.events.length)).toEqual([50, 10]);
    expect(bodies[0]!.schema).toBe(1);
    client.capture({ distinctId: 'install-1', event: 'recipe_run_settled' });
    await client.flush();
    expect(bodies).toHaveLength(2);
  });

  it('puts a batch the Worker could not store back once, then drops it', async () => {
    const { fetchImpl, bodies } = fakeFetch([503, 503, 200]);
    const client = createUsageEventsClient({ url: 'https://events.test.invalid', fetchImpl, flushIntervalMs: 60_000, now: () => NOW });
    client.capture({ distinctId: 'install-1', event: 'game_created', properties: { $insert_id: 'a' } });
    await client.flush();
    await client.flush();
    await client.flush();
    expect(bodies.map(body => body.events.length)).toEqual([1, 1]);
    await client.shutdown();
  });

  it('does not retry a batch the Worker refused as malformed', async () => {
    const { fetchImpl, bodies } = fakeFetch([400]);
    const client = createUsageEventsClient({ url: 'https://events.test.invalid', fetchImpl, flushIntervalMs: 60_000, now: () => NOW });
    client.capture({ distinctId: 'install-1', event: 'game_created' });
    await client.flush();
    await client.flush();
    expect(bodies).toHaveLength(1);
    await client.shutdown();
  });

  it('never throws when the network is down', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const client = createUsageEventsClient({ url: 'https://events.test.invalid', fetchImpl, flushIntervalMs: 60_000 });
    client.capture({ distinctId: 'install-1', event: 'game_created' });
    await expect(client.flush()).resolves.toBeUndefined();
    await expect(client.shutdown(100)).resolves.toBeUndefined();
  });
});
