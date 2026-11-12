import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express, { type Response as ExpressResponse } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { GAME_PLAYTEST_PRESET_IDS, gamePlaytestPreset, parseGamePlaytestRequest } from '@openpixo/contracts';
import { runGameCli } from '../../src/game/verify-cli.js';
import { registerGamePlaytestRoutes } from '../../src/game/playtest-routes.js';
import type { RegisterGameVerifyRoutesDeps } from '../../src/routes/game-verify.js';
import { requireLocalDaemonRequest } from '../../src/http/local-daemon-request.js';
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); process.exitCode = undefined;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const report = { completed: true, durationMs: 100, frames: [], console: [], pageErrors: [], fps: { min: 50, avg: 60, samples: 5 }, inputSupported: true };
it('normal CLI uses the UI playtest endpoint with file input and duration, and emits JSON', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-playtest-cli-')); roots.push(root);
  const file = path.join(root, 'inputs.json'); await writeFile(file, '[{"key":"Space","press":true}]');
  vi.stubEnv('PIXO_TOOL_TOKEN', '');
  const request = vi.fn(async () => Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [], playtest: report }));
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await runGameCli(['playtest', '--project', 'my game', '--script', file, '--duration', '0.1', '--daemon-url', 'http://127.0.0.1:7456', '--json']);
  expect(request.mock.calls[0]).toEqual(['http://127.0.0.1:7456/api/projects/my%20game/game/playtest',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ durationMs: 100, captureIntervalMs: 1000, script: [{ key: 'Space', press: true, holdMs: 80 }] }) })]);
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ status: 'passed', playtest: report });
});
it('agent CLI uses only the confined verification context/capture/register boundary and retains lineage', async () => {
  vi.stubEnv('PIXO_PROJECT_ID', 'game'); vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_fixture');
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/context')) return Response.json({ projectDir: '/', artifactDir: '/', toolPaths: {}, webCaptureAvailable: false, runId: 'lineage',
      profile: { engine: 'unity', commands: {} } });
    if (String(url).endsWith('/register')) {
      const value = JSON.parse(String(init?.body));
      expect(value.runId).toBe('lineage');
      return Response.json({ ...value.result, runId: value.runId });
    }
    throw new Error('Agent CLI must not ask the daemon to execute a project command');
  });
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await runGameCli(['playtest', '--daemon-url', 'http://127.0.0.1:7456', '--json']);
  expect(request.mock.calls.map(call => String(call[0]).split('/').at(-1))).toEqual(['context', 'register']);
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ runId: 'lineage', status: 'unavailable', playtest: { reasonCode: 'UNSUPPORTED_ENGINE' } });
  expect(process.exitCode).toBe(2);
});
it('rejects agent execution tokens before project lookup or execution at the HTTP endpoint', async () => {
  const authorize = vi.fn();
  const app = express(); app.use(express.json());
  registerGamePlaytestRoutes(app, { db: null, http: { requireLocalDaemonRequest,
    sendApiError: (res: ExpressResponse, status: number, _code: string, message: string) => res.status(status).json({ error: message }) },
    authorizeProjectRequest: authorize } as unknown as RegisterGameVerifyRoutesDeps);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await fetch('http://127.0.0.1:' + (server.address() as {port:number}).port + '/api/projects/game/game/playtest',
      { method: 'POST', headers: { authorization: 'Bearer pixott_expired', 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403); expect(await response.text()).toContain('CLI process'); expect(authorize).not.toHaveBeenCalled();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('expands --preset/--seed through the shared preset functions and keeps --json output a single document', async () => {
  vi.stubEnv('PIXO_TOOL_TOKEN', '');
  const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [],
    playtest: { ...report, preset: 'monkey', seed: 42 }, echo: JSON.parse(String(init?.body)) }));
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runGameCli(['playtest', '--project', 'game', '--preset', 'monkey', '--seed', '42', '--daemon-url', 'http://127.0.0.1:7456', '--json']);
  const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
  expect(body).toEqual(parseGamePlaytestRequest(gamePlaytestPreset('monkey', { seed: 42 })));
  expect(output).toHaveBeenCalledOnce(); expect(log).not.toHaveBeenCalled();
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ playtest: { preset: 'monkey', seed: 42 } });
});
it('prints a replay command for seeded runs and draws a seed when none is given', async () => {
  vi.stubEnv('PIXO_TOOL_TOKEN', '');
  const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({ status: 'passed', steps: [], screenshots: [], missingTools: [], playtest: { ...report, preset: body.preset, seed: body.seed } });
  });
  vi.stubGlobal('fetch', request);
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line); });
  await runGameCli(['playtest', '--project', 'game', '--preset', 'random', '--daemon-url', 'http://127.0.0.1:7456']);
  const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
  expect(Number.isInteger(body.seed)).toBe(true);
  expect(lines.join('\n')).toContain('--preset random --seed ' + body.seed);
});
it('lists presets as clean JSON without a project and rejects contradictory preset flags', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('listing presets must not contact the daemon'); }));
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await runGameCli(['playtest', '--list-presets', '--json']);
  expect(JSON.parse(String(output.mock.calls[0]?.[0])).presets.map((preset: { id: string }) => preset.id)).toEqual([...GAME_PLAYTEST_PRESET_IDS]);
  for (const args of [['--preset', 'observe', '--seed', '1'], ['--seed', '1'], ['--preset', 'nope'], ['--preset', 'random', '--seed', '-3'],
    ['--preset', 'random', '--seed', '4294967296'], ['--preset', 'observe', '--script', '-']]) {
    output.mockClear(); process.exitCode = undefined;
    await runGameCli(['playtest', '--project', 'game', ...args, '--json']);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toHaveProperty('error.message');
    expect(process.exitCode).toBe(1);
  }
});
