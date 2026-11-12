import { afterEach, describe, expect, it, vi } from 'vitest';

const { asyncProbe, syncProbe } = vi.hoisted(() => ({
  asyncProbe: vi.fn(),
  syncProbe: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawnSync: syncProbe,
}));

vi.mock('../../src/runtimes/invocation.js', () => ({ execAgentFile: asyncProbe }));

import { probeCodexVersion, resetCodexVersionProbeCache } from '../../src/runtimes/defs/codex.js';

afterEach(() => {
  resetCodexVersionProbeCache();
  vi.resetAllMocks();
});

describe('Codex auto-transport version probe', () => {
  it('leaves the event loop responsive while a slow CLI probe is pending', async () => {
    const output = { stdout: 'codex-cli 0.149.1\n', stderr: '' };
    syncProbe.mockImplementation(() => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      return output;
    });
    asyncProbe.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(output), 500)));

    // A real timer is necessary: a fake clock cannot detect a blocked JS thread.
    const started = performance.now();
    const timer = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now() - started), 10));
    const pending = Promise.resolve(probeCodexVersion('slow-codex'));
    const delay = await timer;
    await expect(pending).resolves.toBe('codex-cli 0.149.1');
    expect(delay).toBeLessThan(150);
  });

  it('coalesces concurrent probes and memoizes their result by executable path', async () => {
    asyncProbe.mockResolvedValue({ stdout: 'codex-cli 0.149.1\n', stderr: '' });
    const first = probeCodexVersion('cached-codex');
    expect(probeCodexVersion('cached-codex')).toBe(first);
    await expect(first).resolves.toBe('codex-cli 0.149.1');
    await expect(probeCodexVersion('cached-codex')).resolves.toBe('codex-cli 0.149.1');
    expect(asyncProbe).toHaveBeenCalledTimes(1);
  });

  it('returns an unknown version when the CLI cannot be invoked', async () => {
    asyncProbe.mockRejectedValue(new Error('CLI unavailable'));
    await expect(probeCodexVersion('missing-codex')).resolves.toBeNull();
  });
});
