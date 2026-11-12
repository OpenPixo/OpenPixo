import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codexImageProviderStatus, resolveCodexImageRuntime } from '../../src/media/codex-image-runtime.js';
import { detectAgent } from '../../src/runtimes/detection.js';
import { codexAgentDef } from '../../src/runtimes/defs/codex.js';

const mocks = vi.hoisted(() => ({
  detect: vi.fn(), readConfig: vi.fn(), launch: vi.fn(),
  spawnEnv: vi.fn(), applyEnv: vi.fn(),
}));
vi.mock('../../src/runtimes/detection.js', () => ({ detectAgent: mocks.detect }));
vi.mock('../../src/app-config.js', () => ({ readAppConfig: mocks.readConfig,
  agentCliEnvForAgent: (prefs: Record<string, Record<string, string>>, id: string) => prefs[id] ?? {},
}));
vi.mock('../../src/runtimes/launch.js', () => ({ resolveAgentLaunchAsync: mocks.launch, applyAgentLaunchEnvAsync: mocks.applyEnv }));
vi.mock('../../src/runtimes/env.js', () => ({ spawnEnvForAgentAsync: mocks.spawnEnv }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readConfig.mockResolvedValue({ agentCliEnv: { codex: { CODEX_HOME: 'external-tool-home' } } });
  mocks.detect.mockResolvedValue({ id: 'codex', available: true, path: 'selected-codex.cmd', authStatus: 'ok' });
  mocks.launch.mockResolvedValue({ launchPath: 'detected-native-codex.exe', childPathPrepend: [] });
  mocks.spawnEnv.mockResolvedValue({ CODEX_HOME: 'external-tool-home' });
  mocks.applyEnv.mockImplementation(async env => env);
});
describe('Codex image availability reuses runtime readiness', () => {
  it('uses the existing auth detector, configured environment and native launch resolver', async () => {
    const runtime = await resolveCodexImageRuntime('resolved-daemon-root');
    expect(detectAgent).toHaveBeenCalledWith(codexAgentDef, { CODEX_HOME: 'external-tool-home' });
    expect(mocks.readConfig).toHaveBeenCalledWith('resolved-daemon-root');
    expect(runtime).toMatchObject({ status: { available: true, keyless: true }, executable: 'detected-native-codex.exe' });
    expect(await codexImageProviderStatus('resolved-daemon-root')).toEqual({ available: true, keyless: true });
  });
  it.each([
    [{ available: false }, 'CODEX_CLI_NOT_FOUND'],
    [{ available: true, path: 'codex', authStatus: 'missing' }, 'CODEX_CLI_AUTH_REQUIRED'],
    [{ available: true, path: 'codex', authStatus: 'unknown' }, 'CODEX_CLI_AUTH_UNKNOWN'],
  ])('reports an unavailable runtime with a localizable reason', async (agent, reasonCode) => {
    mocks.detect.mockResolvedValue(agent);
    expect(await codexImageProviderStatus()).toMatchObject({ available: false, keyless: true, reasonCode });
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  // 2026-11-11 Sol roguelike run: the 10th image of a batch failed in 4 s with
  // CODEX_CLI_AUTH_UNKNOWN while the same login had made the previous nine.
  it('lets a generation through when the sign-in probe could not answer, but not when it says signed out', async () => {
    mocks.detect.mockResolvedValue({ id: 'codex', available: true, path: 'codex', authStatus: 'unknown' });
    expect(await resolveCodexImageRuntime('root', { generating: true })).toMatchObject({
      status: { available: true }, executable: 'detected-native-codex.exe' });
    expect((await resolveCodexImageRuntime('root')).status).toMatchObject({ available: false, reasonCode: 'CODEX_CLI_AUTH_UNKNOWN' });
    mocks.detect.mockResolvedValue({ id: 'codex', available: true, path: 'codex', authStatus: 'missing' });
    expect((await resolveCodexImageRuntime('root', { generating: true })).status).toMatchObject({ available: false, reasonCode: 'CODEX_CLI_AUTH_REQUIRED' });
  });
  it('does not fail the providers API if readiness checking fails', async () => {
    mocks.detect.mockRejectedValue(new Error('private CLI diagnostic'));
    expect(await codexImageProviderStatus()).toMatchObject({ available: false, reasonCode: 'CODEX_CLI_AUTH_UNKNOWN' });
  });
});
