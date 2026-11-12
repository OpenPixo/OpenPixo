import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoctorCheck, DoctorResponse } from '@openpixo/contracts';
import { SETTINGS_GAME_ENGINES_PATH, SETTINGS_MEDIA_PROVIDERS_PATH } from '@openpixo/contracts';
import { runDoctorCli } from '../src/cli-doctor.js';
import { resolveDaemonUrl } from '../src/daemon-url.js';

vi.mock('../src/daemon-url.js', () => ({
  resolveDaemonUrl: vi.fn(async () => 'http://127.0.0.1:17456/'),
}));

function check(overrides: Partial<DoctorCheck> = {}): DoctorCheck {
  return {
    id: 'engine:godot', group: 'engines', status: 'ok',
    title: { code: 'godot' }, detail: { code: 'available', params: { version: '4.5', source: 'path' } },
    fix: { kind: 'install-url', value: 'https://godotengine.org/download/' },
    ...overrides,
  };
}

describe('pixo doctor', () => {
  let stdout: string[];
  let stderr: string[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let report: DoctorResponse;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdout.push(String(chunk)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr.push(String(chunk)); return true; });
    vi.mocked(resolveDaemonUrl).mockClear();
    report = { checks: [check()] };
    fetchMock = vi.fn(async () => new Response(JSON.stringify(report), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PIXO_TOOL_TOKEN', '');
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('gets the shared report with daemon credentials and emits unchanged JSON', async () => {
    vi.stubEnv('PIXO_TOOL_TOKEN', 'test-tool-token');

    await runDoctorCli(['--json', '--daemon-url', 'http://localhost:17456']);

    expect(resolveDaemonUrl).toHaveBeenCalledWith({ flagUrl: 'http://localhost:17456' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:17456/api/doctor', expect.objectContaining({
      method: 'GET',
      headers: { Accept: 'application/json', Origin: 'http://127.0.0.1:17456', Authorization: 'Bearer test-tool-token' },
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.parse(stdout.join(''))).toEqual(report);
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints compact status marks, versions, and actionable fix hints', async () => {
    report.checks = [
      check(),
      check({ id: 'agent:codex', group: 'agents', status: 'warn', title: { code: 'agent', params: { name: 'Codex' } },
        detail: { code: 'auth-unknown' }, fix: { kind: 'command', value: 'codex login' } }),
      check({ id: 'engine:node', status: 'missing', title: { code: 'node' }, detail: { code: 'not-found' },
        fix: { kind: 'install-url', value: 'https://nodejs.org/' } }),
      check({ id: 'engine:npm', status: 'error', title: { code: 'npm' }, detail: { code: 'invalid-path' },
        fix: { kind: 'settings', value: 'gameEngines' } }),
      check({ id: 'provider:image', group: 'providers', status: 'warn', title: { code: 'image-provider' },
        detail: { code: 'not-configured' }, fix: { kind: 'settings', value: 'media' } }),
      check({ id: 'media:ffmpeg', group: 'media-tools', status: 'missing', title: { code: 'ffmpeg' },
        detail: { code: 'not-found' }, fix: { kind: 'install-url', value: 'https://ffmpeg.org/download.html' } }),
    ];

    await runDoctorCli([]);

    const output = stdout.join('');
    expect(output).toContain('Environment check');
    expect(output).toMatch(/✓\s+Game engines\s+Godot\s+Available · 4\.5 · PATH/);
    expect(output).toMatch(/!\s+Agents\s+Codex\s+Sign-in status unknown\s+Run: codex login/);
    expect(output).toMatch(/✗\s+Game engines\s+Node\.js\s+Not found\s+Install: https:\/\/nodejs\.org\//);
    expect(output).toContain(`Open ${SETTINGS_GAME_ENGINES_PATH}`);
    expect(output).toContain(`Open ${SETTINGS_MEDIA_PROVIDERS_PATH}`);
    expect(output).toContain('restore bundled FFmpeg or set HYPERFRAMES_FFMPEG_PATH');
    expect(process.exitCode).toBe(1);
  });

  it.each(['missing', 'error'] as const)('exits with code 1 for a %s check in JSON mode', async (status) => {
    report.checks = [check({ status })];

    await runDoctorCli(['--json']);

    expect(JSON.parse(stdout.join(''))).toEqual(report);
    expect(process.exitCode).toBe(1);
  });

  it('keeps warnings non-fatal', async () => {
    report.checks = [check({ status: 'warn', detail: { code: 'auth-unknown' } })];

    await runDoctorCli([]);

    expect(stdout.join('')).toContain('!');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints help without making a request', async () => {
    await runDoctorCli(['--help']);

    expect(stdout.join('')).toContain('pixo doctor [--json]');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolveDaemonUrl).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('reports HTTP failures in machine-readable form', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Doctor unavailable' } }), { status: 503 }));

    await runDoctorCli(['--json']);

    expect(JSON.parse(stdout.join(''))).toEqual({ error: { message: 'Doctor unavailable' } });
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it('reports connection failures and rejects unknown options without probing', async () => {
    fetchMock.mockRejectedValue(new Error('Daemon unavailable'));
    await runDoctorCli([]);
    expect(stderr.join('')).toContain('Daemon unavailable');
    expect(process.exitCode).toBe(1);

    fetchMock.mockClear();
    await runDoctorCli(['--unknown']);
    expect(stderr.join('')).toContain('--unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
