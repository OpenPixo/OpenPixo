import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const fetchModels = vi.fn();
  const defs = ['codex', 'claude', 'opencode', 'byok-opencode'].map(id => ({ id, name: id, versionArgs: ['--version'],
    fallbackModels: [], fetchModels, installUrl: `https://example.test/${id}`,
    ...(id === 'opencode' ? {} : { authProbe: { args: ['auth', 'status'] } }) }));
  return { defs, fetchModels, exec: vi.fn(), auth: vi.fn(), resolve: vi.fn(), env: {} as Record<string, string> };
});
vi.mock('../../src/runtimes/registry.js', () => ({ AGENT_DEFS: state.defs }));
vi.mock('../../src/runtimes/invocation.js', () => ({ execAgentFile: state.exec }));
vi.mock('../../src/runtimes/auth.js', () => ({ probeAgentAuthStatus: state.auth }));
vi.mock('../../src/runtimes/launch.js', () => ({ resolveAgentLaunchAsync: state.resolve, applyAgentLaunchEnvAsync: (env: unknown) => env }));
vi.mock('../../src/runtimes/env.js', () => ({ spawnEnvForAgentAsync: () => ({ ...state.env }) }));
vi.mock('../../src/runtimes/models.js', () => ({ DEFAULT_MODEL_OPTION: {}, getRememberedLiveModels: vi.fn(),
  mergeFallbackModelMetadata: (_def: unknown, models: unknown) => models, rememberLiveModels: vi.fn() }));
vi.mock('../../src/runtimes/metadata.js', () => ({ installMetaForAgent: () => ({}) }));
vi.mock('../../src/runtimes/executables.js', () => ({ forgetUnusableExecutables: vi.fn(), rememberUnusableExecutable: vi.fn() }));
vi.mock('../../src/runtimes/capabilities.js', () => ({ agentCapabilities: new Map() }));
vi.mock('../../src/runtimes/diagnostics.js', () => ({ buildAuthDiagnostic: () => null, buildExecutableDiagnosticAsync: () => ({}), buildNotInvocableDiagnostic: () => ({}) }));

import { detectAgent, detectAgentReadiness, detectAgentsReadiness } from '../../src/runtimes/detection.js';
import type { RuntimeAgentDef } from '../../src/runtimes/types.js';

beforeEach(() => {
  vi.clearAllMocks();
  state.env = {};
  state.resolve.mockImplementation((def: { id: string }) => ({ selectedPath: `${def.id}.exe`, launchPath: `${def.id}.exe` }));
  state.exec.mockResolvedValue({ stdout: '1.2.3', stderr: '' });
  state.fetchModels.mockResolvedValue([]);
  state.auth.mockResolvedValue({ status: 'ok' });
});

describe('local-only agent readiness detection', () => {
  it('uses the normal resolver and version invocation without model, help or auth requests', async () => {
    const results = await detectAgentsReadiness({}, 1_000);
    expect(results.map(agent => agent.id)).toEqual(['codex', 'claude', 'opencode']);
    expect(results.every(agent => agent.available && agent.version === '1.2.3')).toBe(true);
    expect(results.find(agent => agent.id === 'opencode')?.authStatus).toBeUndefined();
    expect(state.exec).toHaveBeenCalledTimes(3);
    for (const call of state.exec.mock.calls) {
      expect(call[1]).toEqual(['--version']);
      expect(call[2].timeout).toBeGreaterThan(0);
      expect(call[2].timeout).toBeLessThanOrEqual(1_000);
    }
    expect(state.fetchModels).not.toHaveBeenCalled();
    expect(state.auth).not.toHaveBeenCalled();
  });

  it('isolates a timed-out executable from healthy and missing agents', async () => {
    state.exec.mockImplementation(async (command: string) => {
      if (command.startsWith('codex')) throw Object.assign(new Error('killed'), { killed: true });
      return { stdout: '2.3.4', stderr: '' };
    });
    state.resolve.mockImplementation((def: { id: string }) => def.id === 'opencode'
      ? { selectedPath: null, launchPath: null }
      : { selectedPath: `${def.id}.exe`, launchPath: `${def.id}.exe` });
    const results = await detectAgentsReadiness();
    expect(results.find(agent => agent.id === 'codex')).toMatchObject({ available: false, probeError: 'timeout' });
    expect(results.find(agent => agent.id === 'claude')).toMatchObject({ available: true, version: '2.3.4' });
    expect(results.find(agent => agent.id === 'opencode')).toMatchObject({ available: false });
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.fetchModels).not.toHaveBeenCalled();
  });

  it('reuses known sign-in state only for the same executable and effective environment', async () => {
    const def = state.defs[0] as unknown as RuntimeAgentDef;
    await detectAgent(def);
    state.auth.mockClear();
    state.fetchModels.mockClear();
    expect((await detectAgentReadiness(def)).authStatus).toBe('ok');
    state.env = { CODEX_HOME: 'different-external-tool-home' };
    expect((await detectAgentReadiness(def)).authStatus).toBe('unknown');
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.fetchModels).not.toHaveBeenCalled();
  });
});
