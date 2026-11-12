import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { DetectedAgent, RuntimeModelOption } from '../../src/runtimes/types.js';

const state = vi.hoisted(() => ({
  defs: [{ id: 'codex', name: 'Codex', bin: 'codex', versionArgs: ['--version'],
    buildArgs: () => [], streamFormat: 'codex-json',
    fallbackModels: [], helpArgs: ['--help'], capabilityFlags: { '--image': 'images' }, fetchModels: vi.fn() }],
  exec: vi.fn(),
  auth: vi.fn(),
}));

vi.mock('../../src/runtimes/registry.js', () => ({ AGENT_DEFS: state.defs }));
vi.mock('../../src/runtimes/invocation.js', () => ({ execAgentFile: state.exec }));
vi.mock('../../src/runtimes/auth.js', () => ({ probeAgentAuthStatus: state.auth }));
vi.mock('../../src/runtimes/launch.js', () => ({
  resolveAgentLaunchAsync: () => ({ selectedPath: 'codex.exe', launchPath: 'codex.exe' }),
  applyAgentLaunchEnvAsync: (env: unknown) => env,
}));
vi.mock('../../src/runtimes/env.js', () => ({
  spawnEnvForAgentAsync: (_agentId: string, _baseEnv: unknown, configuredEnv: unknown) => configuredEnv,
}));
vi.mock('../../src/runtimes/metadata.js', () => ({ installMetaForAgent: () => ({}) }));
vi.mock('../../src/runtimes/executables.js', () => ({
  forgetUnusableExecutables: vi.fn(), rememberUnusableExecutable: vi.fn(),
}));
vi.mock('../../src/runtimes/diagnostics.js', () => ({
  buildAuthDiagnostic: () => null, buildExecutableDiagnosticAsync: () => ({}),
  buildNotInvocableDiagnostic: () => ({}),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.defs.splice(1);
  state.exec.mockResolvedValue({ stdout: 'codex 1.2.3 --image', stderr: '' });
  state.auth.mockResolvedValue({ status: 'ok' });
  state.defs[0]!.fetchModels.mockReset().mockResolvedValue([{ id: 'initial', label: 'Initial model' }]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test('overlapping startup, picker and run detection share each CLI probe', async () => {
  const { detectAgents } = await import('../../src/runtimes/detection.js');
  const results = await Promise.all([detectAgents(), detectAgents(), detectAgents()]);
  expect(results.every(([agent]) => agent?.available)).toBe(true);
  expect(state.exec).toHaveBeenCalledTimes(2); // One version and one help probe.
  expect(state.auth).toHaveBeenCalledTimes(1);
});

test('repeated cache reads reuse every CLI, model and authentication probe for 30 seconds', async () => {
  vi.useFakeTimers();
  const { detectAgents, getDetectedAgents } = await import('../../src/runtimes/detection.js');
  await detectAgents();
  await getDetectedAgents();
  await vi.advanceTimersByTimeAsync(29_999);
  await getDetectedAgents();
  expect(state.exec).toHaveBeenCalledTimes(2);
  expect(state.defs[0]!.fetchModels).toHaveBeenCalledTimes(1);
  expect(state.auth).toHaveBeenCalledTimes(1);
});

test('an explicit rescan probes again even when the cached snapshot is fresh', async () => {
  const { detectAgents, getDetectedAgents } = await import('../../src/runtimes/detection.js');
  await getDetectedAgents();
  state.defs[0]!.fetchModels.mockResolvedValue([{ id: 'rescanned', label: 'Rescanned model' }]);
  await detectAgents();
  expect(state.exec).toHaveBeenCalledTimes(4);
  expect((await getDetectedAgents())[0]?.models[0]?.id).toBe('rescanned');
  expect(state.defs[0]!.fetchModels).toHaveBeenCalledTimes(2);
});
test('configured and inherited environment changes invalidate internal detection immediately', async () => {
  const { getDetectedAgents } = await import('../../src/runtimes/detection.js');
  await getDetectedAgents({ codex: { CODEX_HOME: 'first' } });
  await getDetectedAgents({ codex: { CODEX_HOME: 'second' } });
  vi.stubEnv('CODEX_BIN', 'different-codex.exe');
  await getDetectedAgents({ codex: { CODEX_HOME: 'second' } });
  expect(state.exec).toHaveBeenCalledTimes(6);
});
test('host runtime port publication preserves startup warming and the cached snapshot', async () => {
  const { getDetectedAgents } = await import('../../src/runtimes/detection.js');
  const models = deferred<RuntimeModelOption[]>();
  state.defs[0]!.fetchModels.mockReturnValue(models.promise);
  const startupWarm = getDetectedAgents();
  vi.stubEnv('PIXO_WEB_PORT', '17643');
  const firstPageRead = getDetectedAgents();
  models.resolve([{ id: 'warmed', label: 'Warmed model' }]);
  await Promise.all([startupWarm, firstPageRead]);
  vi.stubEnv('PIXO_WEB_PORT', '17644');
  expect((await getDetectedAgents())[0]?.models[0]?.id).toBe('warmed');
  vi.stubEnv('pixo_web_port', '17645');
  await getDetectedAgents();

  expect(state.exec).toHaveBeenCalledTimes(2);
  expect(state.defs[0]!.fetchModels).toHaveBeenCalledOnce();
  expect(state.auth).toHaveBeenCalledOnce();
});

test('inherited agent home and every explicitly configured environment value invalidate detection', async () => {
  const { getDetectedAgents } = await import('../../src/runtimes/detection.js');
  vi.stubEnv('PIXO_AGENT_HOME', 'first-agent-home');
  await getDetectedAgents();
  vi.stubEnv('PIXO_AGENT_HOME', 'second-agent-home');
  await getDetectedAgents();
  await getDetectedAgents({ codex: { PIXO_WEB_PORT: 'explicit-cli-override' } });
  expect(state.exec).toHaveBeenCalledTimes(6);
});

test('unavailable runtimes stay cached for the same 30 seconds and explicit rescans see installs immediately', async () => {
  vi.useFakeTimers();
  state.exec.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  const { detectAgents, getDetectedAgents } = await import('../../src/runtimes/detection.js');
  expect((await getDetectedAgents())[0]?.available).toBe(false);
  const initialCalls = state.exec.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5_000);
  await getDetectedAgents();
  expect(state.exec).toHaveBeenCalledTimes(initialCalls);
  await vi.advanceTimersByTimeAsync(24_999);
  await getDetectedAgents();
  expect(state.exec).toHaveBeenCalledTimes(initialCalls);
  state.exec.mockResolvedValue({ stdout: 'codex 1.2.3', stderr: '' });
  expect((await detectAgents())[0]?.available).toBe(true);
  expect((await getDetectedAgents())[0]?.available).toBe(true);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('expired snapshots return stale immediately while concurrent readers share one background refresh', async () => {
  vi.useFakeTimers();
  const { detectAgents, getDetectedAgents } = await import('../../src/runtimes/detection.js');
  const { getRememberedLiveModels } = await import('../../src/runtimes/models.js');
  const initial = await getDetectedAgents();
  const refresh = deferred<RuntimeModelOption[]>();
  state.defs[0]!.fetchModels.mockReturnValueOnce(refresh.promise);
  await vi.advanceTimersByTimeAsync(30_000);

  let served: DetectedAgent[][] | undefined;
  const reads = Promise.all([getDetectedAgents(), getDetectedAgents(), getDetectedAgents()])
    .then((results) => { served = results; return results; });
  await vi.advanceTimersByTimeAsync(0);
  try {
    expect(served).toEqual([initial, initial, initial]);
    expect(state.defs[0]!.fetchModels).toHaveBeenCalledTimes(2);
    expect(state.exec).toHaveBeenCalledTimes(4);
  } finally {
    refresh.resolve([{ id: 'updated', label: 'Updated model' }]);
    // The explicit path joins an already running refresh, providing its completion signal.
    await Promise.all([reads, detectAgents()]);
  }
  expect(getRememberedLiveModels('codex').map((model) => model.id)).toEqual(['updated']);
  expect((await getDetectedAgents())[0]?.models[0]?.id).toBe('updated');
  expect(state.defs[0]!.fetchModels).toHaveBeenCalledTimes(2);
});

test('changed configured CLI environment invalidates a fresh snapshot immediately', async () => {
  const { getDetectedAgents } = await import('../../src/runtimes/detection.js');
  const agentCliEnv = { codex: { CODEX_BIN: 'first-codex.exe', TOKEN: 'first' } };
  await getDetectedAgents(agentCliEnv);
  agentCliEnv.codex.TOKEN = 'second';
  state.defs[0]!.fetchModels.mockResolvedValue([{ id: 'new-config', label: 'New configuration' }]);
  expect((await getDetectedAgents(agentCliEnv))[0]?.models[0]?.id).toBe('new-config');
  expect(state.defs[0]!.fetchModels).toHaveBeenCalledTimes(2);
});

test('a pending refresh for old configuration cannot overwrite the new configuration snapshot', async () => {
  vi.useFakeTimers();
  const { getDetectedAgents, getDetectedRuntimeVersions, detectAgentReadiness } = await import('../../src/runtimes/detection.js');
  const { getRememberedLiveModels } = await import('../../src/runtimes/models.js');
  const { agentCapabilities } = await import('../../src/runtimes/capabilities.js');
  state.exec.mockImplementation(async (_bin, args, options) => ({
    stdout: args.includes('--version')
      ? options.env.TOKEN === 'second' ? 'codex 2.0.0' : 'codex 1.0.0'
      : options.env.TOKEN === 'second' ? '' : '--image',
    stderr: '',
  }));
  state.auth.mockImplementation(async (_def, _path, env) => ({
    status: env.TOKEN === 'second' ? 'missing' : 'ok',
  }));
  const firstConfig = { codex: { TOKEN: 'first' } };
  const newConfig = { codex: { TOKEN: 'second' } };
  await getDetectedAgents(firstConfig);
  const oldRefresh = deferred<RuntimeModelOption[]>();
  state.defs[0]!.fetchModels.mockReturnValueOnce(oldRefresh.promise);
  await vi.advanceTimersByTimeAsync(30_000);
  const staleRead = getDetectedAgents(firstConfig);
  await vi.advanceTimersByTimeAsync(0);
  state.defs[0]!.fetchModels.mockResolvedValue([{ id: 'new-config', label: 'New configuration' }]);
  const fresh = await getDetectedAgents(newConfig);
  oldRefresh.resolve([{ id: 'old-config', label: 'Old configuration' }]);
  await staleRead;
  await vi.advanceTimersByTimeAsync(0);
  expect(getRememberedLiveModels('codex').map((model) => model.id)).toEqual(['new-config']);
  expect((await getDetectedAgents(newConfig))).toEqual(fresh);
  expect(fresh[0]?.models[0]?.id).toBe('new-config');
  expect(state.defs[0]!.fetchModels).toHaveBeenCalledTimes(3);
  expect.soft(agentCapabilities.get('codex')).toEqual({ images: false });
  expect.soft(getDetectedRuntimeVersions('codex')?.agentCliVersion).toBe('codex 2.0.0');
  expect.soft((await detectAgentReadiness(state.defs[0]!, newConfig.codex)).authStatus).toBe('missing');
});

test('a superseded configuration cannot publish rejected executable candidates', async () => {
  const { getDetectedAgents } = await import('../../src/runtimes/detection.js');
  const { rememberUnusableExecutable } = await import('../../src/runtimes/executables.js');
  const started = deferred<void>();
  const oldVersion = deferred<{ stdout: string; stderr: string }>();
  state.exec.mockImplementation(async (_bin, args, options) => {
    if (args.includes('--version') && options.env.TOKEN === 'first') {
      started.resolve();
      await oldVersion.promise;
      throw Object.assign(new Error('old executable was missing'), { code: 'ENOENT' });
    }
    return { stdout: 'codex 2.0.0 --image', stderr: '' };
  });
  const oldDetection = getDetectedAgents({ codex: { TOKEN: 'first' } });
  await started.promise;
  const newConfig = { codex: { TOKEN: 'second' } };
  const fresh = await getDetectedAgents(newConfig);
  oldVersion.resolve({ stdout: '', stderr: '' });
  await oldDetection;

  expect(rememberUnusableExecutable).not.toHaveBeenCalled();
  expect((await getDetectedAgents(newConfig))).toEqual(fresh);
});

test('warm cached stream yields every entry without starting or awaiting another probe', async () => {
  state.defs.push({ ...state.defs[0]!, id: 'claude', name: 'Claude', bin: 'claude', fetchModels: vi.fn()
    .mockResolvedValue([{ id: 'claude-model', label: 'Claude model' }]) });
  const { getDetectedAgents, getDetectedAgentsStream } = await import('../../src/agents.js');
  const initial = await getDetectedAgents();
  const entries: DetectedAgent[] = [];
  for await (const agent of getDetectedAgentsStream()) entries.push(agent);
  expect(entries).toEqual(initial);
  expect(entries.map((agent) => agent.id).sort()).toEqual(['claude', 'codex']);
  expect(state.exec).toHaveBeenCalledTimes(4);
  expect(state.defs[0]!.fetchModels).toHaveBeenCalledTimes(1);
  expect(state.defs[1]!.fetchModels).toHaveBeenCalledTimes(1);
  expect(state.auth).toHaveBeenCalledTimes(2);
});

test('expired cached stream yields stale entries while its background model probe is still pending', async () => {
  vi.useFakeTimers();
  const { detectAgents, getDetectedAgents, getDetectedAgentsStream } = await import('../../src/agents.js');
  const initial = await getDetectedAgents();
  const refresh = deferred<RuntimeModelOption[]>();
  state.defs[0]!.fetchModels.mockReturnValueOnce(refresh.promise);
  await vi.advanceTimersByTimeAsync(30_000);
  const stream = getDetectedAgentsStream();
  let streamed: IteratorResult<DetectedAgent> | undefined;
  const next = stream.next().then((result) => { streamed = result; });
  await vi.advanceTimersByTimeAsync(0);
  try {
    expect(streamed).toEqual({ value: initial[0], done: false });
    expect(state.defs[0]!.fetchModels).toHaveBeenCalledTimes(2);
  } finally {
    refresh.resolve([{ id: 'updated', label: 'Updated model' }]);
    await Promise.all([next, detectAgents()]);
    await stream.return(undefined);
  }
});
