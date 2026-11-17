/**
 * Agent probes run in worker threads so Windows CreateProcess cannot block the
 * HTTP event loop, but they must not start a fresh Worker for every probe.
 *
 * Each codex-image generation re-detects Codex (version, models, help and
 * sign-in probes), so a long image batch created and tore down thousands of
 * isolates beside the main thread's agent resolution. The prod-dev daemon on
 * Node 24.22.1 died twice in such batches: once silently, once with
 * `CHECK_GE(argc, 2)` in `node::fs::Access` — an assertion that is impossible
 * from Node's own JS caller, i.e. corrupted process state. A stand-alone
 * script that does only those two things (PATH `access()` probes and
 * per-probe Workers) segfaulted on the same Node in one batch of runs, though
 * not reliably. Probes now share a small, long-lived pool.
 */
import { afterEach, expect, test, vi } from 'vitest';

const created = vi.hoisted(() => ({ count: 0 }));

vi.mock('node:worker_threads', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:worker_threads')>();
  class CountingWorker extends original.Worker {
    constructor(...args: ConstructorParameters<typeof original.Worker>) {
      super(...args);
      created.count += 1;
    }
  }
  return { ...original, Worker: CountingWorker };
});

afterEach(() => vi.resetModules());

test('repeated probes reuse a bounded set of probe workers', async () => {
  const { execAgentFile } = await import('../../src/runtimes/invocation.js');
  const probe = () => execAgentFile(process.execPath, ['-e', 'process.stdout.write("ok")']);
  for (let i = 0; i < 6; i += 1) expect((await probe()).stdout).toBe('ok');
  const parallel = await Promise.all(Array.from({ length: 12 }, probe));
  expect(parallel.every(result => result.stdout === 'ok')).toBe(true);
  expect(created.count).toBeGreaterThan(0);
  expect(created.count).toBeLessThanOrEqual(4);
});

test('an idle probe worker does not keep the process alive', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const invocation = new URL('../../src/runtimes/invocation.ts', import.meta.url).href;
  const script = `const { execAgentFile } = await import(${JSON.stringify(invocation)});
    const { stdout } = await execAgentFile(process.execPath, ['-e', 'process.stdout.write("probed")']);
    process.stdout.write(stdout);`;
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'probe-worker-exit-'));
  try {
    writeFileSync(join(dir, 'probe.mjs'), script);
    const startedAt = Date.now();
    const { stdout } = await promisify(execFile)(process.execPath, [join(dir, 'probe.mjs')], { timeout: 30_000 });
    expect(stdout).toBe('probed');
    expect(Date.now() - startedAt).toBeLessThan(20_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
