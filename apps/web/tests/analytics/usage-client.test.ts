// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_HEADER_CLIENT_TYPE,
  ANALYTICS_HEADER_DEVICE_ID,
  ANALYTICS_HEADER_LOCALE,
  ANALYTICS_HEADER_SESSION_ID,
} from '@openpixo/contracts/analytics';
import { WEB_USAGE_EVENTS_ENDPOINT, createWebUsageClient } from '../../src/analytics/usage-client';

function recorder() {
  const calls: Array<{ url: string; init: RequestInit; body: { events: Array<Record<string, unknown>> } }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) });
    return new Response('{"accepted":1}');
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('the web usage client', () => {
  it('sends only to the local daemon, with the analytics identity headers', async () => {
    const { calls, fetchImpl } = recorder();
    const client = createWebUsageClient({ distinctId: 'install-1', sessionId: 'sess-1', clientType: 'desktop', fetchImpl });
    client.register({ locale: 'zh-CN', event_schema_version: 2 });
    client.capture('ui_click', { area: 'new_game', $insert_id: 'evt-1' });
    await client.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(WEB_USAGE_EVENTS_ENDPOINT);
    expect(calls[0]!.url.startsWith('/api/')).toBe(true);
    expect(calls[0]!.init.headers).toMatchObject({
      [ANALYTICS_HEADER_DEVICE_ID]: 'install-1',
      [ANALYTICS_HEADER_SESSION_ID]: 'sess-1',
      [ANALYTICS_HEADER_CLIENT_TYPE]: 'desktop',
      [ANALYTICS_HEADER_LOCALE]: 'zh-CN',
    });
    expect(calls[0]!.body.events[0]).toMatchObject({ event: 'ui_click', eventId: 'evt-1',
      properties: { area: 'new_game', locale: 'zh-CN', event_schema_version: 2 } });
  });

  it('sends nothing after opt-out, and forgets what was queued', async () => {
    const { calls, fetchImpl } = recorder();
    const client = createWebUsageClient({ distinctId: 'install-1', sessionId: 'sess-1', clientType: 'web', fetchImpl });
    client.capture('queued_before_opt_out');
    client.opt_out_capturing();
    client.capture('after_opt_out');
    await client.flush();
    expect(calls).toHaveLength(0);
    client.opt_in_capturing();
    client.capture('after_opt_in');
    await client.flush();
    expect(calls.flatMap(call => call.body.events.map(event => event.event))).toEqual(['after_opt_in']);
  });

  it('reset forgets registered properties; identify switches the identity', async () => {
    const { calls, fetchImpl } = recorder();
    const client = createWebUsageClient({ distinctId: 'old-install', sessionId: 'sess-1', clientType: 'web', fetchImpl });
    client.register({ device_id: 'old-install' });
    client.reset();
    client.identify('new-install');
    client.capture('after_rotation');
    await client.flush();
    expect(calls[0]!.init.headers).toMatchObject({ [ANALYTICS_HEADER_DEVICE_ID]: 'new-install' });
    expect(calls[0]!.body.events[0]!.properties).not.toHaveProperty('device_id');
  });

  it('batches at most 50 events per request', async () => {
    const { calls, fetchImpl } = recorder();
    const client = createWebUsageClient({ distinctId: 'install-1', sessionId: 'sess-1', clientType: 'web', fetchImpl });
    for (let i = 0; i < 70; i++) client.capture('tick');
    await client.flush();
    expect(calls.map(call => call.body.events.length).reduce((a, b) => a + b, 0)).toBe(70);
    expect(Math.max(...calls.map(call => call.body.events.length))).toBeLessThanOrEqual(50);
  });
});
