import { afterEach, describe, expect, it, vi } from 'vitest';

const { syncProxy, asyncProxy } = vi.hoisted(() => ({ syncProxy: vi.fn(), asyncProxy: vi.fn() }));

vi.mock('@openpixo/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openpixo/platform')>()),
  resolveSystemProxyEnv: syncProxy,
  resolveSystemProxyEnvAsync: asyncProxy,
}));

import { proxyDispatcherRequestInit } from '../src/connectionTest.js';

afterEach(() => vi.resetAllMocks());

describe('request proxy discovery', () => {
  it('leaves the event loop responsive while OS proxy discovery is pending', async () => {
    syncProxy.mockImplementation(() => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      return {};
    });
    asyncProxy.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 500)));

    // The real timer observes the request's ability to yield during an OS probe.
    const started = performance.now();
    const timer = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now() - started), 10));
    const pending = Promise.resolve(proxyDispatcherRequestInit({}));
    const delay = await timer;
    const dispatcher = await pending;
    try {
      expect(delay).toBeLessThan(150);
    } finally {
      await dispatcher.close();
    }
  });
});
