import { performance } from 'node:perf_hooks';
import { afterEach, expect, test, vi } from 'vitest';

// Windows CreateProcess can block even through execFile's asynchronous API.
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const exec = promisify(original.execFile);
  return { ...original, execFile: Object.assign(original.execFile.bind(null), {
    [promisify.custom]: (...args: Parameters<typeof exec>) => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      return exec(...args);
    },
  }) };
});
vi.mock('../../src/runtimes/registry.js', () => ({ AGENT_DEFS: [{
  id: 'codex', name: 'Codex', bin: process.execPath,
  versionArgs: ['-e', 'setTimeout(() => console.log("codex 1.2.3"), 500)'], fallbackModels: [],
}] }));
vi.mock('../../src/runtimes/launch.js', () => {
  const launch = () => ({ selectedPath: process.execPath, launchPath: process.execPath });
  return { resolveAgentLaunch: launch, resolveAgentLaunchAsync: launch,
    applyAgentLaunchEnv: (env: unknown) => env, applyAgentLaunchEnvAsync: (env: unknown) => env };
});
vi.mock('../../src/runtimes/env.js', () => ({
  spawnEnvForAgent: () => process.env, spawnEnvForAgentAsync: () => process.env,
}));
vi.mock('../../src/runtimes/metadata.js', () => ({ installMetaForAgent: () => ({}) }));
vi.mock('../../src/runtimes/auth.js', () => ({ probeAgentAuthStatus: async () => null }));

afterEach(() => vi.resetModules());

test('cold detection keeps the event loop responsive during slow process creation and probes', async () => {
  const { detectAgents } = await import('../../src/runtimes/detection.js');
  const start = performance.now();
  const timer = new Promise<number>(resolve => setTimeout(() => resolve(performance.now() - start), 10));
  const detection = detectAgents();
  try {
    expect(await timer).toBeLessThan(150);
  } finally {
    const [agent] = await detection;
    expect(agent?.available).toBe(true);
    expect(agent?.version).toContain('1.2.3');
  }
});
