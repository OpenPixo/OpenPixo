import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectNextStepsResponse } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../../src/daemon-url.js';
import { formatProjectNextSteps, runProjectNextStepsCli } from '../../src/projects/next-steps-cli.js';

vi.mock('../../src/daemon-url.js', () => ({
  resolveDaemonUrl: vi.fn(async () => 'http://127.0.0.1:17456/'),
}));

function checklist(): ProjectNextStepsResponse {
  return {
    projectId: 'my-game',
    engine: 'godot',
    dismissed: false,
    steps: [
      { id: 'environment', status: 'done', action: { kind: 'open-settings', value: 'environment' } },
      { id: 'run-game', status: 'done', action: { kind: 'run-game', value: 'my-game' } },
      { id: 'agent-task', status: 'todo', action: { kind: 'prefill-chat', value: 'Add a player.\nUse the arrow keys.\tKeep it simple.' } },
      { id: 'media-assets', status: 'blocked', action: { kind: 'open-tab', value: 'assets' } },
      { id: 'verify', status: 'todo', action: { kind: 'verify', value: 'my-game' } },
    ],
  };
}

describe('pixo project next-steps', () => {
  let stdout: string[];
  let stderr: string[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let report: ProjectNextStepsResponse;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdout.push(String(chunk)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr.push(String(chunk)); return true; });
    vi.mocked(resolveDaemonUrl).mockClear();
    report = checklist();
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

  it('gets the shared checklist with credentials and preserves the JSON response', async () => {
    vi.stubEnv('PIXO_TOOL_TOKEN', 'test-tool-token');
    report.projectId = 'game /#1';

    await runProjectNextStepsCli(['game /#1', '--json', '--daemon-url', 'http://localhost:17456']);

    expect(resolveDaemonUrl).toHaveBeenCalledWith({ flagUrl: 'http://localhost:17456' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:17456/api/projects/game%20%2F%231/next-steps', expect.objectContaining({
      method: 'GET',
      headers: { Accept: 'application/json', Origin: 'http://127.0.0.1:17456', Authorization: 'Bearer test-tool-token' },
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.parse(stdout.join(''))).toEqual(report);
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('dismisses through the shared POST endpoint and returns its persisted response', async () => {
    report.dismissed = true;

    await runProjectNextStepsCli(['my-game', '--dismiss', '--json']);

    expect(resolveDaemonUrl).toHaveBeenCalledWith({ flagUrl: null });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:17456/api/projects/my-game/next-steps/dismiss', expect.objectContaining({
      method: 'POST',
      headers: { Accept: 'application/json', Origin: 'http://127.0.0.1:17456' },
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.parse(stdout.join(''))).toEqual(report);
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints progress, fact statuses, and single-line actions without treating pending work as failure', async () => {
    await runProjectNextStepsCli(['my-game']);

    expect(stdout.join('')).toBe([
      'Get started with this game: 2 / 5',
      'done\tEnvironment ready',
      'done\tRun the game',
      'todo\tComplete an agent task\tprefill-chat: Add a player. Use the arrow keys. Keep it simple.',
      'blocked\tAdd a media asset\topen-tab: assets',
      'todo\tVerify the game\tverify: my-game',
      '',
    ].join('\n'));
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('marks a dismissed checklist hidden and omits completed actions', () => {
    report.dismissed = true;
    report.steps = report.steps.map((step) => ({ ...step, status: 'done' }));

    expect(formatProjectNextSteps(report)).toBe([
      'Get started with this game: 5 / 5 (hidden)',
      'done\tEnvironment ready',
      'done\tRun the game',
      'done\tComplete an agent task',
      'done\tAdd a media asset',
      'done\tVerify the game',
    ].join('\n'));
  });

  it.each(['--help', '-h'])('prints %s without daemon discovery or a request', async (flag) => {
    await runProjectNextStepsCli([flag]);

    expect(stdout.join('')).toContain('pixo project next-steps <projectId> [--json] [--dismiss]');
    expect(resolveDaemonUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    { label: 'missing project', args: [], error: 'Usage:' },
    { label: 'blank project', args: ['   '], error: 'Usage:' },
    { label: 'extra project', args: ['one', 'two'], error: 'Usage:' },
    { label: 'unknown option', args: ['one', '--unknown'], error: '--unknown' },
  ])('rejects $label before daemon discovery', async ({ args, error }) => {
    await runProjectNextStepsCli(args);

    expect(stderr.join('')).toContain(error);
    expect(stdout).toEqual([]);
    expect(resolveDaemonUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([
    { body: { error: { message: 'Project unavailable' } }, message: 'Project unavailable' },
    { body: { error: 'Project not found' }, message: 'Project not found' },
    { body: {}, message: 'Starter checklist request failed (503)' },
  ])('reports HTTP errors as machine-readable output: $message', async ({ body, message }) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 503 }));

    await runProjectNextStepsCli(['my-game', '--json']);

    expect(JSON.parse(stdout.join(''))).toEqual({ error: { message } });
    expect(stderr).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it.each([false, true])('reports transport errors with json=%s', async (json) => {
    fetchMock.mockRejectedValue(new Error('Daemon unavailable'));

    await runProjectNextStepsCli(['my-game', ...(json ? ['--json'] : [])]);

    if (json) {
      expect(JSON.parse(stdout.join(''))).toEqual({ error: { message: 'Daemon unavailable' } });
      expect(stderr).toEqual([]);
    } else {
      expect(stderr.join('')).toContain('Daemon unavailable');
      expect(stdout).toEqual([]);
    }
    expect(process.exitCode).toBe(1);
  });
});
