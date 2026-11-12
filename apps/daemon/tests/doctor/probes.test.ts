import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoctorProbeMissing, DoctorProbeTimeout } from '../../src/doctor/checks.js';

const state = vi.hoisted(() => ({ spawn: vi.fn(), ffmpegPath: vi.fn(), readSync: vi.fn(), readAsync: vi.fn(),
  detect: vi.fn(), resolver: vi.fn(), readMedia: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: state.spawn }));
vi.mock('../../src/app-config.js', () => ({ readAppConfigSync: state.readSync, readAppConfig: state.readAsync }));
vi.mock('../../src/assets/ops/audio.js', () => ({ ffmpegPath: state.ffmpegPath }));
vi.mock('../../src/game/verify.js', () => ({ gameToolResolver: state.resolver }));
vi.mock('../../src/media/config.js', () => ({ readMaskedConfig: state.readMedia }));
vi.mock('../../src/runtimes/detection.js', () => ({ detectAgentsReadiness: state.detect }));

import { createDoctorProbes, probeDoctorFfmpeg } from '../../src/doctor/probes.js';

const children: Array<EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('HYPERFRAMES_FFMPEG_PATH', '');
  state.ffmpegPath.mockReturnValue('asset-processor-ffmpeg.exe');
  state.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    children.push(child);
    return child;
  });
  state.readSync.mockReturnValue({ gameEnginePaths: { godot: 'configured-godot.exe' }, agentCliEnv: { codex: { CODEX_HOME: 'configured-agent-home' } } });
  state.detect.mockResolvedValue([]);
  state.resolver.mockReturnValue(() => 'configured-godot.exe');
  state.readMedia.mockResolvedValue({ providers: {
    bfl: { configured: true }, 'custom-image': { configured: false, baseUrl: 'http://localhost:8188', model: 'local-image' },
    elevenlabs: { configured: true },
  } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const child of children.splice(0)) { child.stdout.destroy(); child.stderr.destroy(); }
});

describe('doctor local probes', () => {
  it('reads settings without the async installation migration and reduces media state to booleans', async () => {
    const probes = createDoctorProbes('resolved-data-root', 'project-root');
    const [agents, engine, providers] = await Promise.all([probes.agents(), probes.engineTool('godot'), probes.providers()]);
    expect(agents).toEqual([]);
    expect(engine).toEqual({ available: true, configured: true });
    expect(providers).toEqual({ image: true, audio: true });
    expect(state.readSync).toHaveBeenCalledWith('resolved-data-root');
    expect(state.readAsync).not.toHaveBeenCalled();
    expect(state.resolver).toHaveBeenCalledWith({ godot: 'configured-godot.exe' });
    expect(state.detect).toHaveBeenCalledWith({ codex: { CODEX_HOME: 'configured-agent-home' } }, 1_500);
    expect(state.readMedia).toHaveBeenCalledWith('project-root', { dataDir: 'resolved-data-root', refreshCredentials: false });
    expect(state.spawn).not.toHaveBeenCalled();
    state.readMedia.mockResolvedValue({ providers: { bfl: { configured: true }, suno: { configured: true } } });
    expect(await createDoctorProbes('resolved-data-root', 'project-root').providers()).toEqual({ image: false, audio: false });
  });

  it('probes the asset processor executable and recognizes a configured override', async () => {
    vi.stubEnv('HYPERFRAMES_FFMPEG_PATH', 'configured-ffmpeg.exe');
    const report = probeDoctorFfmpeg();
    expect(state.ffmpegPath).toHaveBeenCalledOnce();
    expect(state.spawn).toHaveBeenCalledWith('asset-processor-ffmpeg.exe', ['-version'], expect.objectContaining({ windowsHide: true }));
    children[0]!.stdout.write('ffmpeg version 7.8.9\nconfiguration: private-build-options');
    children[0]!.emit('close', 0);
    expect(await report).toEqual({ version: 'ffmpeg version 7.8.9', source: 'configured' });
  });

  it('kills an unresponsive version probe at its short process deadline', async () => {
    vi.useFakeTimers();
    const report = probeDoctorFfmpeg();
    const rejected = expect(report).rejects.toBeInstanceOf(DoctorProbeTimeout);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(children[0]!.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(children[0]!.kill).toHaveBeenCalledWith('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a missing FFmpeg executable without returning its raw error', async () => {
    const report = probeDoctorFfmpeg();
    const rejected = expect(report).rejects.toBeInstanceOf(DoctorProbeMissing);
    children[0]!.emit('error', Object.assign(new Error('private executable path'), { code: 'ENOENT' }));
    await rejected;
  });
});
