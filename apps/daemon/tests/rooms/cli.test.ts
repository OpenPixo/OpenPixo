import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runRoomsCli } from '../../src/rooms/cli.js';

vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:7456' }));

const originalExitCode = process.exitCode;
let request: ReturnType<typeof vi.fn>;
let output: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;

function reply(body: unknown, status = 200) {
  request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(body, { status }));
  vi.stubGlobal('fetch', request);
}

const STATUS = { sdkInstalled: true, sdkPath: 'src/openpixo-rooms.ts', paused: false, maxPlayers: 8, creditsPerPlayerHour: 5,
  usage: { month: '2026-11', freeMinutesTotal: 600, freeMinutesUsed: 30, playerMinutes: 30, creditsCharged: 0, monthlyCreditLimit: 500, openRooms: 1 } };

beforeEach(() => {
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('PIXO_TOOL_TOKEN', '');
  vi.stubEnv('PIXO_PROJECT_ID', 'game');
});

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
});

it.each([
  [['add', '--json'], '/rooms/install', 'POST', {}, { sdkPath: 'src/openpixo-rooms.ts', changed: true }],
  [['test', '--json'], '/rooms/test', 'POST', {}, { urls: ['a', 'a'], relayUrl: 'r' }],
  [['test', '--url', 'http://localhost:5173/', '--json'], '/rooms/test', 'POST', { gameUrl: 'http://localhost:5173/' }, { urls: ['a', 'a'], relayUrl: 'r' }],
  [['status', '--json'], '/rooms', 'GET', undefined, STATUS],
  [['limit', '900', '--json'], '/rooms', 'PATCH', { monthlyCreditLimit: 900 }, STATUS],
] as const)('%j calls %s %s and prints JSON', async (args, route, method, body, result) => {
  reply(result);
  await runRoomsCli([...args]);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe(`http://127.0.0.1:7456/api/projects/game${route}`);
  expect(init).toMatchObject({ method, headers: { Origin: 'http://127.0.0.1:7456' } });
  expect(init.body === undefined ? undefined : JSON.parse(init.body as string)).toEqual(body);
  expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual(result);
  expect(process.exitCode).toBe(originalExitCode);
});

it('forwards the project flag and the agent token', async () => {
  vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_test');
  reply(STATUS);
  await runRoomsCli(['status', '--project', 'other', '--json']);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe('http://127.0.0.1:7456/api/projects/other/rooms');
  expect(init).toMatchObject({ headers: { authorization: 'Bearer pixott_test' } });
});

it('does not call rooms closed when it could not ask the cloud', async () => {
  reply({ ...STATUS, usage: null, paused: true, cloudUnknown: true });
  await runRoomsCli(['status']);
  const text = output.mock.calls.flat().join('\n');
  expect(text).not.toContain('not open yet');
  expect(text).toContain('Sign in and check your connection');
});

it('prints readable text', async () => {
  reply({ sdkPath: 'src/openpixo-rooms.ts', changed: false });
  await runRoomsCli(['add']);
  expect(output).toHaveBeenCalledWith('The rooms SDK at src/openpixo-rooms.ts is already up to date.');
  reply({ urls: ['http://a/1', 'http://a/2'], relayUrl: 'r' });
  await runRoomsCli(['test']);
  expect(output.mock.lastCall![0]).toContain('http://a/1\n  http://a/2');
  reply(STATUS);
  await runRoomsCli(['status']);
  expect(output.mock.calls.flat().join('\n')).toContain('Free time used on your account: 30 of 600 minutes. Then 5 credits per player-hour.');
});

it.each([false, true])('reports a refusal and exits 1 (json=%s)', async json => {
  const error = { error: { code: 'CONFLICT', message: 'src/openpixo-rooms.ts was changed by hand.' } };
  reply(error, 409);
  await runRoomsCli(['add', ...(json ? ['--json'] : [])]);
  expect(process.exitCode).toBe(1);
  if (json) expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual(error);
  else expect(errors).toHaveBeenCalledWith(error.error.message);
});

it.each([['limit', 'lots'], ['limit', '-1'], ['limit', '1.5']])('rejects %s %s without a request', async (...args) => {
  reply({});
  await runRoomsCli(args);
  expect(process.exitCode).toBe(1);
  expect(request).not.toHaveBeenCalled();
});

it.each([[['launch']], [['limit']], [['add', 'extra']]])('rejects %j with usage', async args => {
  reply({});
  await runRoomsCli(args);
  expect(errors.mock.calls.flat().join()).toContain('rooms add');
  expect(process.exitCode).toBe(1);
});

it('prints usage for help', async () => {
  await runRoomsCli(['--help']);
  expect(output.mock.calls[0]![0]).toContain('pixo rooms test');
});

it('needs a project', async () => {
  vi.stubEnv('PIXO_PROJECT_ID', '');
  reply({});
  await runRoomsCli(['status', '--json']);
  expect(JSON.parse(output.mock.calls[0]![0] as string).error.message).toContain('Project id required');
  expect(process.exitCode).toBe(1);
});
