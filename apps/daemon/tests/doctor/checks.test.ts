import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkEnvironment, doctorVersion, type DoctorProbes } from '../../src/doctor/checks.js';

function probes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    agents: async () => [
      { id: 'codex', name: 'Codex CLI', available: true, version: 'codex-cli 1.2.3', authStatus: 'ok' },
      { id: 'claude', name: 'Claude Code', available: true, authStatus: 'missing' },
      { id: 'opencode', name: 'OpenCode', available: false, installUrl: 'https://opencode.ai/docs/' },
    ],
    engineTool: async tool => ({ available: tool !== 'godot', configured: tool === 'godot' }),
    ffmpeg: async () => ({ version: 'ffmpeg version 7.1.2', source: 'bundled' }),
    providers: async () => ({ image: true, audio: false }),
    ...overrides,
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('environment checks', () => {
  it('reports grouped readiness and actionable fixes using only codes and safe params', async () => {
    const result = await checkEnvironment(probes());
    expect(result.checks).toHaveLength(9);
    expect(result.checks.find(check => check.id === 'agent:codex')).toMatchObject({ status: 'ok', detail: { code: 'signed-in', params: { version: '1.2.3' } } });
    expect(result.checks.find(check => check.id === 'agent:claude')).toMatchObject({ status: 'warn', detail: { code: 'sign-in-required' }, fix: { kind: 'command', value: 'claude' } });
    expect(result.checks.find(check => check.id === 'agent:opencode')).toMatchObject({ status: 'missing', fix: { kind: 'install-url', value: 'https://opencode.ai/docs/' } });
    expect(result.checks.find(check => check.id === 'engine:godot')).toMatchObject({ status: 'missing', detail: { code: 'invalid-path', params: { source: 'configured' } }, fix: { kind: 'settings', value: 'gameEngines' } });
    expect(result.checks.find(check => check.id === 'engine:node')).toMatchObject({ status: 'ok', detail: { params: { source: 'path' } } });
    expect(result.checks.find(check => check.id === 'media:ffmpeg')).toMatchObject({ status: 'ok', detail: { params: { version: '7.1.2', source: 'bundled' } } });
    expect(result.checks.find(check => check.id === 'provider:image')).toMatchObject({ status: 'ok', detail: { params: { configured: true } } });
    expect(result.checks.find(check => check.id === 'provider:audio')).toMatchObject({ status: 'missing', fix: { kind: 'settings', value: 'media' } });
    expect(doctorVersion('private-token\nversion 4.5.6')).toBe('4.5.6');
    expect(doctorVersion('private-token')).toBeUndefined();
  });

  it('keeps unexpected local failures isolated and does not return raw error secrets', async () => {
    const result = await checkEnvironment(probes({
      agents: async () => { throw new Error('private credential'); },
      ffmpeg: async () => { throw new Error('private filesystem path'); },
    }));
    expect(result.checks.filter(check => check.group === 'agents').every(check => check.status === 'error')).toBe(true);
    expect(result.checks.find(check => check.id === 'engine:node')?.status).toBe('ok');
    expect(result.checks.find(check => check.id === 'media:ffmpeg')?.detail.code).toBe('probe-failed');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('starts independent probes together and bounds an unresponsive probe with a virtual clock', async () => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => {});
    const agents = vi.fn(async () => pending);
    const engineTool = vi.fn(probes().engineTool);
    const ffmpeg = vi.fn(probes().ffmpeg);
    const providers = vi.fn(probes().providers);
    const report = checkEnvironment(probes({ agents, engineTool, ffmpeg, providers }), 100);
    await Promise.resolve();
    await Promise.resolve();
    expect(agents).toHaveBeenCalledOnce();
    expect(engineTool).toHaveBeenCalledTimes(3);
    expect(ffmpeg).toHaveBeenCalledOnce();
    expect(providers).toHaveBeenCalledOnce();
    const completed = vi.fn();
    void report.then(completed);
    await vi.advanceTimersByTimeAsync(99);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const result = await report;
    expect(result.checks.filter(check => check.group === 'agents').every(check => check.detail.code === 'probe-timeout')).toBe(true);
    expect(result.checks.find(check => check.id === 'provider:image')?.status).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });
});
