import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runGameCli } from '../../src/game/install-deps-cli.js';
import { installGameDependencies, resolveGameCommandDirectory } from '../../src/game/install-deps.js';
import { resolveDaemonUrl } from '../../src/daemon-url.js';
vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: vi.fn() }));
vi.mock('../../src/game/install-deps.js', async original => ({ ...(await original<typeof import('../../src/game/install-deps.js')>()), installGameDependencies: vi.fn(), resolveGameCommandDirectory: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }));
const previousExitCode = process.exitCode;
beforeEach(() => {
  vi.mocked(resolveDaemonUrl).mockResolvedValue('http://127.0.0.1:4555/');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.stubEnv('PIXO_PROJECT_ID', 'game/id'); vi.stubEnv('PIXO_TOOL_TOKEN', 'local-token');
  process.exitCode = undefined;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); process.exitCode = previousExitCode; });

it('waits for installation and prints its final JSON, using the project environment by default', async () => {
  const result = { status: 'installed', packageManager: 'pnpm', logTail: 'done', logRef: 'log' };
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ status: 'installing' })).mockResolvedValueOnce(Response.json(result));
  vi.stubGlobal('fetch', fetchMock);
  await runGameCli(['install-deps', '--json']);
  expect(fetchMock.mock.calls.map(call => [call[0], call[1].method])).toEqual([
    ['http://127.0.0.1:4555/api/projects/game%2Fid/game/install-deps', 'POST'],
    ['http://127.0.0.1:4555/api/projects/game%2Fid/game/install-deps', 'GET'],
  ]);
  expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({ Origin: 'http://127.0.0.1:4555', authorization: 'Bearer local-token' });
  expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toEqual(result);
  expect(process.exitCode).toBeUndefined();
});

it('preserves Node-missing reasons and failure logs for machine consumers', async () => {
  const result = { status: 'failed', reasonCode: 'NODE_MISSING', message: 'Install Node.js' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(result)));
  await runGameCli(['install-deps', 'project', '--json']);
  expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toEqual(result);
  expect(process.exitCode).toBe(1);
});

it('runs dependency installation in the agent CLI sandbox using scoped verification context', async () => {
  vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_agent');
  vi.mocked(resolveGameCommandDirectory).mockResolvedValue('/game');
  const result = { status: 'installed' as const, packageManager: 'npm' as const };
  vi.mocked(installGameDependencies).mockResolvedValue(result);
  const fetcher = vi.fn(async () => Response.json({ projectDir: '/game', artifactDir: '/artifacts', runtimeDataDir: '/data', toolPaths: {}, profile: { engine: 'phaser', commands: {} } }));
  vi.stubGlobal('fetch', fetcher);
  await runGameCli(['install-deps', '--json']);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4555/api/projects/game%2Fid/game/verify/context', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ authorization: 'Bearer pixott_agent' }) }));
  expect(installGameDependencies).toHaveBeenCalledWith('/game', '/data', expect.any(Function));
  expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toEqual(result);
});
