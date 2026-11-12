import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveDaemonUrl } from '../../src/daemon-url.js';
import { runGameTuningCli, runGameTuningDispatch } from '../../src/game/tuning-cli.js';

vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
const previousExit = process.exitCode;
const parameter = { id: 'jump', key: 'jump', type: 'float', source: 'web-json', value: -460, defaultValue: -460,
  label_i18n: { 'zh-CN': '跳跃速度' }, group_i18n: { 'zh-CN': '角色' },
  group: 'Player', filePath: 'src/tuning.json', line: 2, fileHash: 'a'.repeat(64) };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); vi.stubEnv('PIXO_PROJECT_ID', 'game/id'); vi.stubEnv('PIXO_TOOL_TOKEN', 'tuning-token');
  vi.mocked(resolveDaemonUrl).mockResolvedValue('http://127.0.0.1:4555/');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  fetchMock.mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === 'PATCH'
    ? { parameter: { ...parameter, value: -500 } } : { parameters: [parameter], warnings: [] })));
  process.exitCode = undefined;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); process.exitCode = previousExit; });
const output = () => JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]));

it('lists through the same project HTTP endpoint with token, origin and clean JSON', async () => {
  await runGameTuningCli(['list', '--json']);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4555/api/projects/game%2Fid/game/tuning', {
    method: 'GET', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4555', authorization: 'Bearer tuning-token' },
  });
  expect(output().parameters[0]).toEqual(parameter); expect(console.log).not.toHaveBeenCalled();
});
it('accepts negative values and forwards the hash read from list', async () => {
  await runGameTuningCli(['set', 'jump', '-500', '--project', 'chosen', '--json']);
  expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:4555/api/projects/chosen/game/tuning');
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ id: 'jump', value: -500, fileHash: 'a'.repeat(64) });
  expect(output().parameter.value).toBe(-500); expect(process.exitCode).toBeUndefined();
});
it('forwards an explicit prior revision and preserves structured conflict codes', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ parameters: [parameter], warnings: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'TUNING_CONFLICT', message: 'Source changed' } }), { status: 409 }));
  await runGameTuningCli(['set', 'jump', '-500', '--file-hash', 'c'.repeat(64), '--json']);
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).fileHash).toBe('c'.repeat(64));
  expect(output()).toEqual({ error: { code: 'TUNING_CONFLICT', message: 'Source changed' } }); expect(process.exitCode).toBe(1);
});
it('rejects malformed arguments before discovery and preserves other game commands', async () => {
  await runGameTuningCli(['set', '--json']);
  expect(resolveDaemonUrl).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
  const fallback = vi.fn(async () => {});
  await runGameTuningDispatch(['install-deps', 'game'], fallback);
  expect(fallback).toHaveBeenCalledExactlyOnceWith(['install-deps', 'game']);
});
it('advertises tuning commands alongside existing game help', async () => {
  const fallback = vi.fn(async () => {});
  await runGameTuningDispatch(['--help'], fallback);
  expect(fallback).toHaveBeenCalledExactlyOnceWith(['--help']);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('game tuning list'));
});
