import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runPublishCli } from '../../src/publish/cli.js';
import { runProjectBuild } from '../../src/publish/build.js';

vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:7456' }));
vi.mock('../../src/publish/build.js', () => ({ runProjectBuild: vi.fn(async () => {}) }));

const ROUTE = 'http://127.0.0.1:7456/api/projects/game/publish';
const running = { id: 'job-1', phase: 'building', filesDone: 0, filesTotal: 0, startedAt: 'now' };
const finished = { ...running, phase: 'done', filesDone: 2, filesTotal: 2 };
const game = { shareId: 's', url: 'https://play.example/s', title: 'Game', version: 1, state: 'live', publishedAt: 'x', updatedAt: 'x', playsThisMonth: 3 };
const status = (job: unknown, extra: object = {}) => ({ available: true, game: null, job, termsAccepted: true, termsUrl: '', ...extra });

const originalExitCode = process.exitCode;
let request: ReturnType<typeof vi.fn>;
let output: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;

function replies(...bodies: [number, unknown][]) {
  const queue = [...bodies];
  request = vi.fn(async (_url: string, _init?: RequestInit) => {
    const [code, body] = queue.shift() ?? [500, { error: { message: 'unexpected request' } }];
    return Response.json(body, { status: code });
  });
  vi.stubGlobal('fetch', request);
}

beforeEach(() => {
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('PIXO_TOOL_TOKEN', '');
  vi.stubEnv('PIXO_PROJECT_ID', 'game');
  vi.mocked(runProjectBuild).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
});

it('publishes, waits for the job and prints the final status as JSON', async () => {
  const final = status(finished, { game });
  replies([202, { job: running }], [200, status({ ...running, phase: 'uploading', filesDone: 1, filesTotal: 2 })], [200, status(finished)], [200, final]);
  await runPublishCli(['--json', '--title', 'Game', '--accept-terms', '--no-build'], { pollMs: 0 });
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe(ROUTE);
  expect(init).toMatchObject({ method: 'POST', headers: { Origin: 'http://127.0.0.1:7456' } });
  expect(JSON.parse(init.body as string)).toEqual({ title: 'Game', acceptTerms: true, skipBuild: true });
  expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual(final);
  expect(output).toHaveBeenCalledTimes(1);
  expect(errors).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(originalExitCode);
});

it('shows progress and prints the link in text mode', async () => {
  replies([202, { job: running }], [200, status({ ...running, phase: 'uploading', filesDone: 1, filesTotal: 2 })], [200, status(finished)], [200, status(finished, { game })]);
  await runPublishCli([], { pollMs: 0 });
  const progress = errors.mock.calls.flat().join('\n');
  expect(progress).toContain('Building the game...');
  expect(progress).toContain('Uploading...');
  expect(progress).toContain('1 of 2 files');
  expect(output).toHaveBeenCalledWith('Published: https://play.example/s');
});

it.each([false, true])('lists refused files and exits 1 (json=%s)', async json => {
  const failed = { ...running, phase: 'failed', error: { code: 'PUBLISH_REFUSED', message: '1 file cannot go on a public link.' }, refusedFiles: ['tools/run.exe'] };
  replies([202, { job: running }], [200, status(failed)]);
  await runPublishCli(json ? ['--json'] : [], { pollMs: 0 });
  expect(process.exitCode).toBe(1);
  if (json) expect(JSON.parse(output.mock.calls[0]![0] as string)).toMatchObject({ error: { code: 'PUBLISH_REFUSED' }, refusedFiles: ['tools/run.exe'] });
  else expect(errors.mock.calls.flat().join('\n')).toContain('Refused files:\n  tools/run.exe');
});

it('tells the creator how to accept the rules', async () => {
  const failed = { ...running, phase: 'failed', error: { code: 'SHARE_TERMS_REQUIRED', message: 'Accept the sharing rules before your first publish.' } };
  replies([202, { job: failed }]);
  await runPublishCli([], { pollMs: 0 });
  expect(errors.mock.calls.flat().join('\n')).toContain('pixo publish --accept-terms');
  expect(process.exitCode).toBe(1);
});

const extraRequired = { ...running, phase: 'failed', error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits: 100,
  message: "Your plan's public games are all in use. Publishing this one costs 100 credits, charged once; updates stay free." } };

it('names the price and the flag when the plan is full', async () => {
  replies([202, { job: extraRequired }]);
  await runPublishCli([], { pollMs: 0 });
  const text = errors.mock.calls.flat().join('\n');
  expect(text).toContain('100 credits, charged once');
  expect(text).toContain('pixo publish --pay-extra-game');
  expect(process.exitCode).toBe(1);
});

it('keeps the price in the JSON refusal', async () => {
  replies([202, { job: extraRequired }]);
  await runPublishCli(['--json'], { pollMs: 0 });
  expect(JSON.parse(output.mock.calls[0]![0] as string)).toMatchObject({ error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits: 100 } });
});

it('says how to buy credits when the charge was refused for too few', async () => {
  replies([202, { job: { ...running, phase: 'failed', error: { code: 'INSUFFICIENT_CREDITS', message: 'Not enough credits for this item.' } } }]);
  await runPublishCli(['--pay-extra-game'], { pollMs: 0 });
  expect(errors.mock.calls.flat().join('\n')).toContain('pixo credits buy <sku>');
  expect(process.exitCode).toBe(1);
});

it('tells an agent to ask the creator instead', async () => {
  vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_test');
  replies([202, { job: extraRequired }]);
  await runPublishCli(['--no-build'], { pollMs: 0 });
  expect(errors.mock.calls.flat().join('\n')).toContain('Ask the creator to confirm it in the Share dialog');
});

it('sends the agreement with --pay-extra-game and prints the result as JSON', async () => {
  const final = status(finished, { game: { ...game, extraPaid: true } });
  replies([202, { job: running }], [200, status(finished)], [200, final]);
  await runPublishCli(['--pay-extra-game', '--no-build', '--json'], { pollMs: 0 });
  expect(JSON.parse(request.mock.calls[0]![1].body as string)).toEqual({ payExtraGame: true, skipBuild: true });
  expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual(final);
});

it('offers the extra game in status when the plan is full', async () => {
  replies([200, status(null, { publishPlan: { planRequired: false, sku: 'plan_starter_monthly_v3', maxLiveGames: 10, maxGameBytes: 104_857_600, liveGames: 10, extraGameCredits: 100, extraGames: 1 } })]);
  await runPublishCli(['status'], { pollMs: 0 });
  const text = output.mock.calls.flat().join('\n');
  expect(text).toContain('Extra games (paid once, not counted): 1');
  expect(text).toContain('Publish this one for 100 credits, charged once: pixo publish --pay-extra-game');
});

it.each([false, true])('reports a refused request and exits 1 (json=%s)', async json => {
  const error = { error: { code: 'VALIDATION_FAILED', message: "Godot games can't be published yet." } };
  replies([422, error]);
  await runPublishCli(json ? ['--json'] : [], { pollMs: 0 });
  expect(process.exitCode).toBe(1);
  if (json) expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual(error);
  else expect(errors).toHaveBeenCalledWith(error.error.message);
});

it('reports a job that vanished because the app restarted', async () => {
  replies([202, { job: running }], [200, status(null)]);
  await runPublishCli(['--json'], { pollMs: 0 });
  expect(process.exitCode).toBe(1);
  expect(JSON.parse(output.mock.calls[0]![0] as string).error.message).toContain('restarted');
});

it('builds inside its own process for an agent, then asks the daemon only to upload', async () => {
  vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_test');
  const context = { profile: { engine: 'phaser', commands: {}, evidence: [] }, projectDir: 'C:/game', toolPaths: {} };
  replies([200, context], [202, { job: { ...finished } }], [200, status(finished, { game })]);
  await runPublishCli(['--json'], { pollMs: 0 });
  expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:7456/api/projects/game/game/verify/context');
  expect(vi.mocked(runProjectBuild)).toHaveBeenCalledTimes(1);
  const post = request.mock.calls[1]!;
  expect(post[1]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer pixott_test' } });
  expect(JSON.parse(post[1].body as string)).toEqual({ skipBuild: true });
});

it('does not build for an agent that passes --no-build, or for a project the daemon will refuse', async () => {
  vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_test');
  replies([202, { job: finished }], [200, status(finished)]);
  await runPublishCli(['--no-build', '--json'], { pollMs: 0 });
  expect(vi.mocked(runProjectBuild)).not.toHaveBeenCalled();
  replies([200, { profile: { engine: 'godot', commands: {}, evidence: [] }, projectDir: 'C:/game', toolPaths: {} }], [422, { error: { message: 'no' } }]);
  await runPublishCli(['--json'], { pollMs: 0 });
  expect(vi.mocked(runProjectBuild)).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it('reads status and removes through the same route', async () => {
  replies([200, status(null, { game })]);
  await runPublishCli(['status', '--project', 'other', '--json']);
  expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:7456/api/projects/other/publish');
  expect(JSON.parse(output.mock.calls[0]![0] as string).game.url).toBe(game.url);
  replies([200, status(null, { game })]);
  await runPublishCli(['status']);
  expect(output).toHaveBeenCalledWith(`Link: ${game.url}`);
  replies([200, { ok: true }]);
  await runPublishCli(['remove', '--json']);
  expect(request.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' });
});

it('needs a project', async () => {
  vi.stubEnv('PIXO_PROJECT_ID', '');
  replies();
  await runPublishCli(['--json']);
  expect(process.exitCode).toBe(1);
  expect(JSON.parse(output.mock.calls[0]![0] as string).error.message).toContain('Project id required');
  expect(request).not.toHaveBeenCalled();
});

it('prints usage for help and rejects an unknown command', async () => {
  replies();
  await runPublishCli(['--help']);
  expect(output.mock.calls[0]![0]).toContain('pixo publish status');
  expect(process.exitCode).toBe(originalExitCode);
  await runPublishCli(['launch']);
  expect(process.exitCode).toBe(1);
  expect(request).not.toHaveBeenCalled();
});
