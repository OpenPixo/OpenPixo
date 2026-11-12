import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDaemonUrl } from '../../src/daemon-url.js';
import { runGameCli } from '../../src/game/verify-cli.js';

vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const previousExitCode = process.exitCode;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveDaemonUrl).mockResolvedValue('http://127.0.0.1:4555/');
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('PIXO_TOOL_TOKEN', 'game-cli-token');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = previousExitCode;
});

describe('game lifecycle CLI', () => {
  it.each([['run', 'POST'], ['run-status', 'GET'], ['stop', 'DELETE']])(
    '%s calls the daemon lifecycle route and preserves its JSON status', async (action, method) => {
      const status = { status: action === 'stop' ? 'exited' : 'running', engine: 'phaser',
        url: 'http://127.0.0.1:5199/', logRef: 'game-run/test.log', logTail: 'ready' };
      fetchMock.mockResolvedValue(new Response(JSON.stringify(status)));

      await runGameCli([action, 'project/id', '--json', '--daemon-url', 'http://127.0.0.1:4555']);

      expect(resolveDaemonUrl).toHaveBeenCalledWith({ flagUrl: 'http://127.0.0.1:4555' });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4555/api/projects/project%2Fid/game/run', {
        method, headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4555', authorization: 'Bearer game-cli-token' },
      });
      expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toEqual(status);
      expect(process.exitCode).toBeUndefined();
      expect(console.log).not.toHaveBeenCalled();
    },
  );

  it('prints missing dependencies and returns failure while preserving machine-readable guidance', async () => {
    const status = { status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', message: 'Dependencies are missing.', installCommand: 'pnpm install' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(status)));

    await runGameCli(['run', 'project', '--json']);

    expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toEqual(status);
    expect(process.exitCode).toBe(1);
  });

  it('shows the URL, log reference, and tool guidance in human output', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'running', url: 'http://127.0.0.1:5199/',
      message: 'Game server is ready.', installCommand: 'npm install', logRef: 'game-run/test.log',
      missingToolGuidance: [{ name: 'Godot', hint: 'Install Godot 4.', installUrl: 'https://godotengine.org/download/' }],
    })));

    await runGameCli(['run-status', 'project']);

    expect(vi.mocked(console.log).mock.calls.map(call => call[0])).toEqual([
      'Game: running', 'Preview: http://127.0.0.1:5199/', 'Game server is ready.',
      'Install dependencies: npm install', 'Install Godot 4.',
      'Download Godot: https://godotengine.org/download/', 'Log: game-run/test.log',
    ]);
  });

  it('reports daemon request errors as JSON and sets a failure exit code', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Project not found' } }), { status: 404 }));

    await runGameCli(['run', 'missing', '--json']);

    expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toEqual({ error: { message: 'Project not found' } });
    expect(process.exitCode).toBe(1);
  });

  it.each([['run', '--json'], ['stop', 'project', 'extra', '--json'], ['run', 'project', '--command', 'anything', '--json']])(
    'rejects invalid arguments before daemon discovery: %s', async (...args) => {
      await runGameCli(args);

      expect(resolveDaemonUrl).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toHaveProperty('error.message');
      expect(process.exitCode).toBe(1);
    },
  );

  it('lists all lifecycle actions in game group help without discovering a daemon', async () => {
    await runGameCli(['--help']);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('game verify'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('game run <projectId> [--json]'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('game run-status <projectId> [--json]'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('game stop <projectId> [--json]'));
    expect(resolveDaemonUrl).not.toHaveBeenCalled();
  });
});
