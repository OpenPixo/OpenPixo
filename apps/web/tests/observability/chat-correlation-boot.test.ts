// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The boot-time half of the chat correlation block that is still produced:
 * `release_channel`, which separates "the packaged stable build is janky" from
 * "a dev daemon is janky". (`replay_session_id` had a second test here; OpenPixo
 * records no session replay, so nothing produces it any more.)
 */

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/analytics/config')) {
      return new Response(
        JSON.stringify({
          enabled: true,
          env: 'local_development',
          installationId: 'install-123',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.endsWith('/api/version')) {
      return new Response(
        JSON.stringify({
          version: {
            version: '1.2.3',
            channel: 'prerelease',
            packaged: true,
            platform: 'darwin',
            arch: 'arm64',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('chat correlation — boot-time identity', () => {
  it('keeps the release channel the daemon already answers with', async () => {
    const { resolveAppVersionForCapture } = await import('../../src/analytics/provider');
    const { chatCorrelation } = await import('../../src/observability/chat-context');

    await resolveAppVersionForCapture('0.0.0');

    expect(chatCorrelation().release_channel).toBe('prerelease');
  });
});
