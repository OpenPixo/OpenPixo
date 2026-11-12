import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runOnlineCli } from '../../src/online/cli.js';

vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:7456' }));

const originalExitCode = process.exitCode;
let request: ReturnType<typeof vi.fn>;
let output: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;

function reply(body: unknown, status = 200) {
  request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(body, { status }));
  vi.stubGlobal('fetch', request);
}

const STATUS = { sdkInstalled: true, sdkPath: 'src/openpixo-online.ts', local: { players: 20, collections: { scores: 20 } },
  usage: { month: '2026-11', state: 'read-only', stateReason: 'requests-cap', gameRequests: 1200, gameBytes: 4096, players: 14,
    accountRequests: 1_000_000, accountBytes: 9000, maxRequests: 1_000_000, maxBytes: 104_857_600, collections: { scores: 14 } } };
const DATA = { players: 0, collections: {} };

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
  [['add', '--json'], '/online/install', 'POST', {}, { sdkPath: 'src/openpixo-online.ts', changed: true }],
  [['status', '--json'], '/online', 'GET', undefined, STATUS],
  [['test', '--json'], '/online/test', 'POST', {}, { url: 'u', emulatorUrl: 'e' }],
  [['test', '--url', 'http://localhost:5173/', '--json'], '/online/test', 'POST', { gameUrl: 'http://localhost:5173/' }, { url: 'u', emulatorUrl: 'e' }],
  [['seed', '--json'], '/online/seed', 'POST', {}, { players: 20, docs: 20 }],
  [['seed', '--players', '5', '--collection', 'teams', '--key', 'arena', '--json'], '/online/seed', 'POST', { players: 5, collection: 'teams', key: 'arena' }, { players: 5, docs: 5 }],
  [['data', '--json'], '/online/data', 'GET', undefined, DATA],
  [['data', '--collection', 'scores', '--json'], '/online/data?collection=scores', 'GET', undefined, { ...DATA, docs: [] }],
  [['reset', '--json'], '/online/data', 'DELETE', undefined, DATA],
  [['reset', '--hosted', '--yes', '--json'], '/online/hosted', 'DELETE', undefined, { ok: true }],
] as const)('%j calls %s %s and prints JSON', async (args, route, method, body, result) => {
  reply(result);
  await runOnlineCli([...args]);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe(`http://127.0.0.1:7456/api/projects/game${route}`);
  expect(init).toMatchObject({ method, headers: { Origin: 'http://127.0.0.1:7456' } });
  expect(init.body === undefined ? undefined : JSON.parse(init.body as string)).toEqual(body);
  expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual(result);
  expect(process.exitCode).toBe(originalExitCode);
});

it('sends the data in a --from file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openpixo-online-cli-'));
  try {
    const file = path.join(directory, 'team.json');
    await writeFile(file, JSON.stringify({ units: ['knight'] }));
    reply({ players: 3, docs: 3 });
    await runOnlineCli(['seed', '--players', '3', '--collection', 'teams', '--from', file]);
    expect(JSON.parse(request.mock.calls[0]![1].body as string)).toEqual({ players: 3, collection: 'teams', data: { units: ['knight'] } });
    expect(output).toHaveBeenCalledWith('Added 3 test players with 3 entries.');
    await writeFile(file, 'not json');
    reply({});
    await runOnlineCli(['seed', '--from', file]);
    expect(process.exitCode).toBe(1);
    expect(request).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('asks for --yes before clearing the public game, without a request', async () => {
  reply({ ok: true });
  await runOnlineCli(['reset', '--hosted']);
  expect(process.exitCode).toBe(1);
  expect(errors.mock.calls.flat().join()).toContain('--hosted --yes');
  expect(request).not.toHaveBeenCalled();
});

it('forwards the project flag and the agent token', async () => {
  vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_test');
  reply(STATUS);
  await runOnlineCli(['status', '--project', 'other', '--json']);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe('http://127.0.0.1:7456/api/projects/other/online');
  expect(init).toMatchObject({ headers: { authorization: 'Bearer pixott_test' } });
});

it('prints readable text', async () => {
  reply(STATUS);
  await runOnlineCli(['status']);
  const text = output.mock.calls.flat().join('\n');
  expect(text).toContain('SDK: src/openpixo-online.ts');
  expect(text).toContain('Local test data: 20 players');
  expect(text).toContain('Your account: 1,000,000 of 1,000,000 requests');
  expect(text).toContain("this month's online requests are used up");
  reply({ url: 'http://127.0.0.1:5173/?pixoOnline=x', emulatorUrl: 'x' });
  await runOnlineCli(['test']);
  expect(output.mock.lastCall![0]).toContain('http://127.0.0.1:5173/?pixoOnline=x');
  reply({ players: 4, docs: 0 });
  await runOnlineCli(['seed', '--players', '4']);
  expect(output.mock.lastCall![0]).toContain('no saved entries yet');
});

it('does not guess when it could not ask the cloud', async () => {
  reply({ ...STATUS, usage: null, cloudUnknown: true });
  await runOnlineCli(['status']);
  const text = output.mock.calls.flat().join('\n');
  expect(text).toContain('Sign in and check your connection');
  expect(text).not.toContain('Read-only');
});

it.each([false, true])('reports a refusal and exits 1 (json=%s)', async json => {
  const error = { error: { code: 'FORBIDDEN', message: 'Only the creator can clear the public game\'s online data.' } };
  reply(error, 403);
  await runOnlineCli(['reset', '--hosted', '--yes', ...(json ? ['--json'] : [])]);
  expect(process.exitCode).toBe(1);
  if (json) expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual(error);
  else expect(errors).toHaveBeenCalledWith(error.error.message);
});

it.each([[['launch']], [['add', 'extra']], [['seed', '--players', 'lots']], [['seed', '--players', '0']]])('rejects %j without a request', async args => {
  reply({});
  await runOnlineCli(args);
  expect(process.exitCode).toBe(1);
  expect(request).not.toHaveBeenCalled();
});

it('prints usage for help and needs a project', async () => {
  await runOnlineCli(['--help']);
  expect(output.mock.calls[0]![0]).toContain('pixo online seed');
  vi.stubEnv('PIXO_PROJECT_ID', '');
  reply({});
  await runOnlineCli(['status', '--json']);
  expect(JSON.parse(output.mock.calls[1]![0] as string).error.message).toContain('Project id required');
});
