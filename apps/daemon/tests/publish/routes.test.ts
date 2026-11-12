import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { GameRunStatus, PublishStartResponse, PublishStatusResponse, RoomsInstallResponse, RoomsStatusResponse, RoomsTestResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountError, PublishCloudError } from '../../src/account/errors.js';
import { closeDatabase, getProject, openDatabase, updateProject } from '../../src/db.js';
import { sendApiError } from '../../src/http/api-errors.js';
import { registerPublishRoutes, type RegisterPublishRoutesDeps } from '../../src/routes/publish.js';
import { registerRoomsRoutes } from '../../src/routes/rooms.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';
import type { PublishService } from '../../src/publish/service.js';
import { fakeAccount, fakeUploads, GAME, shareStatus, USAGE, writeGameFiles } from './harness.js';

const SDK_DIR = path.resolve(import.meta.dirname, '../../../../game-sdk');
const FULL_PLAN = { planRequired: false, sku: 'plan_starter_monthly_v3', maxLiveGames: 10, maxGameBytes: 104_857_600, liveGames: 10, extraGameCredits: 100, extraGames: 0 };

let root: string;
let projectDir: string;
let db: ReturnType<typeof openDatabase>;
let server: Server;
let base: string;
let uploads: Awaited<ReturnType<typeof fakeUploads>>;
let account: ReturnType<typeof fakeAccount>;
let service: PublishService;
let build: ReturnType<typeof vi.fn<NonNullable<RegisterPublishRoutesDeps['build']>>>;
let sameOrigin: boolean;
let allowProject: boolean;
let run: GameRunStatus;
let gameRuns: { status: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
const tokens: string[] = [];

function agentToken(projectId = 'game', operations = ['publish:read', 'publish:write', 'rooms:read', 'rooms:write']): string {
  const grant = toolTokenRegistry.mint({ runId: `run-${tokens.length}`, projectId, allowedOperations: operations });
  tokens.push(grant.token);
  return grant.token;
}

function request(route: string, method = 'GET', body?: unknown, token?: string) {
  return fetch(`${base}/api/projects/game${route}`, { method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function publishAndWait(body: unknown = {}, token?: string): Promise<PublishStatusResponse> {
  const response = await request('/publish', 'POST', body, token);
  expect(response.status).toBe(202);
  expect((await response.json() as PublishStartResponse).job.id).toEqual(expect.any(String));
  await service.settled('game');
  return await (await request('/publish')).json() as PublishStatusResponse;
}

async function writePhaser(): Promise<void> {
  await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', dev: 'vite' }, dependencies: { phaser: '3.90.0' } }));
  await writeFile(path.join(projectDir, 'index.html'), '<script src="/src/main.ts"></script>');
  await writeFile(path.join(projectDir, 'tsconfig.json'), '{}');
  await mkdir(path.join(projectDir, 'src'));
  await writeGameFiles(projectDir);
}

async function start(deps: Partial<RegisterPublishRoutesDeps> = {}): Promise<void> {
  const app = express();
  app.use(express.json());
  const ctx = { db, paths: { PROJECTS_DIR: path.join(root, 'projects'), RUNTIME_DATA_DIR: root } as RegisterPublishRoutesDeps['paths'],
    http: { sendApiError, requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(), isLocalSameOrigin: () => sameOrigin, resolvedPortRef: { current: 7456 } } as unknown as RegisterPublishRoutesDeps['http'],
    authorizeProjectRequest: async (_req: unknown, res: express.Response) => {
      if (!allowProject) sendApiError(res, 403, 'FORBIDDEN', 'project access denied');
      return allowProject;
    },
    authorizeProjectToolRequest: async (res: express.Response, projectId: string) => {
      if (!allowProject) { sendApiError(res, 403, 'FORBIDDEN', 'project access denied'); return null; }
      return { projectId };
    } };
  service = registerPublishRoutes(app, { ...ctx, account, build, sleep: async () => {}, ...deps });
  registerRoomsRoutes(app, { ...ctx, publish: service, gameRuns: gameRuns as never, sdkDir: SDK_DIR, runPollMs: 1 });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-publish-routes-'));
  projectDir = path.join(root, 'folder');
  await mkdir(projectDir);
  await writePhaser();
  db = openDatabase(root, { dataDir: root });
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('game', 'My game', 1, 1);
  updateProject(db, 'game', { metadata: { kind: 'prototype', baseDir: projectDir } });
  uploads = await fakeUploads();
  account = fakeAccount(uploads.baseUrl);
  build = vi.fn(async () => {});
  sameOrigin = true; allowProject = true;
  run = { status: 'running', url: 'http://127.0.0.1:5173/' };
  gameRuns = { status: vi.fn(() => run), start: vi.fn(async () => run) };
  await start();
});

afterEach(async () => {
  for (const token of tokens.splice(0)) toolTokenRegistry.revokeToken(token, 'manual');
  await service.dispose();
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
  await uploads.close();
  closeDatabase();
  await rm(root, { recursive: true, force: true });
});

describe('publish', () => {
  it('publishes, saves the share id in the project and reports the link', async () => {
    account.shareStatus.mockImplementation(async id => shareStatus(id ? { game: GAME } : {}));
    const status = await publishAndWait({ title: ' Space rocks ' });
    expect(status).toMatchObject({ available: true, game: { url: GAME.url }, job: { phase: 'done', filesDone: 3 } });
    expect(account.publishBegin.mock.calls[0]![0]).toMatchObject({ title: 'Space rocks' });
    expect(getProject(db, 'game')?.metadata).toMatchObject({ publishShareId: 'share-1', baseDir: projectDir });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('defaults the title to the project name', async () => {
    await publishAndWait();
    expect(account.publishBegin.mock.calls[0]![0]).toMatchObject({ title: 'My game' });
  });

  it('says plainly what is wrong with a long title', async () => {
    const response = await request('/publish', 'POST', { title: 'x'.repeat(81) });
    expect(await response.json()).toMatchObject({ error: { message: 'The game title can be at most 80 characters.' } });
  });

  it('publishes an extra game when the creator agrees, and shows the plan fields', async () => {
    account.shareStatus.mockResolvedValue(shareStatus({ publishPlan: FULL_PLAN }));
    const refused = await publishAndWait();
    expect(refused.job).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits: 100 } });
    expect(refused.publishPlan).toMatchObject({ extraGameCredits: 100 });
    expect(build).not.toHaveBeenCalled();
    const status = await publishAndWait({ payExtraGame: true });
    expect(status.job).toMatchObject({ phase: 'done' });
    expect(account.publishBegin.mock.calls[0]![0]).toMatchObject({ payExtraGame: true });
  });

  it.each([[{ title: '' }], [{ title: 'x'.repeat(81) }], [{ title: 3 }], [{ acceptTerms: 'yes' }], [{ skipBuild: 1 }], [{ payExtraGame: 'yes' }], [[1]]])('rejects the body %j', async body => {
    expect((await request('/publish', 'POST', body)).status).toBe(400);
    expect(account.publishBegin).not.toHaveBeenCalled();
  });

  it('refuses Godot with a plain message and no cloud call', async () => {
    await rm(path.join(projectDir, 'package.json'));
    await rm(path.join(projectDir, 'index.html'));
    await writeFile(path.join(projectDir, 'project.godot'), 'config_version=5\n');
    const response = await request('/publish', 'POST', {});
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: expect.stringContaining("Godot games can't be published") } });
    expect(account.publishBegin).not.toHaveBeenCalled();
    expect(await (await request('/publish')).json()).toMatchObject({ available: false, unavailableReason: 'engine_unsupported' });
  });

  it('reports a signed-out account up front', async () => {
    account.hasSession.mockResolvedValue(false);
    const response = await request('/publish', 'POST', {});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'ACCOUNT_SIGNED_OUT' } });
    expect(build).not.toHaveBeenCalled();
    expect(await (await request('/publish')).json()).toMatchObject({ available: false, unavailableReason: 'signed_out' });
  });

  it('reports a build with no cloud', async () => {
    const stopped = server;
    await new Promise<void>(resolve => { stopped.closeAllConnections(); stopped.close(() => resolve()); });
    await start({ account: undefined });
    const status = await request('/publish', 'POST', {});
    expect(status.status).toBe(503);
    expect(await status.json()).toMatchObject({ error: { code: 'ACCOUNT_NOT_CONFIGURED' } });
    expect(await (await request('/publish')).json()).toMatchObject({ available: false, unavailableReason: 'no_cloud', game: null, job: null });
  });

  it('reports paused in status and keeps the current game visible', async () => {
    account.shareStatus.mockResolvedValue(shareStatus({ paused: { publish: true, rooms: true }, game: GAME }));
    expect(await (await request('/publish')).json()).toMatchObject({ available: false, unavailableReason: 'paused', game: { shareId: GAME.shareId } });
  });

  it('forgets a link the cloud no longer knows', async () => {
    updateProject(db, 'game', { metadata: { ...getProject(db, 'game')!.metadata, publishShareId: 'gone' } });
    account.shareStatus.mockImplementation(async id => { if (id) throw new PublishCloudError('SHARE_NOT_FOUND'); return shareStatus(); });
    expect(await (await request('/publish')).json()).toMatchObject({ available: true, game: null });
    expect(getProject(db, 'game')?.metadata).not.toHaveProperty('publishShareId');
  });

  it('still reports the job when the cloud cannot be read', async () => {
    await publishAndWait();
    account.shareStatus.mockRejectedValue(new AccountError('CLOUD_UNAVAILABLE'));
    expect(await (await request('/publish')).json()).toMatchObject({ available: true, job: { phase: 'done' }, game: { shareId: GAME.shareId } });
  });

  it('answers 503 with no job when the cloud cannot be read', async () => {
    account.shareStatus.mockRejectedValue(new AccountError('CLOUD_UNAVAILABLE'));
    const response = await request('/publish');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'CLOUD_UNAVAILABLE' } });
  });

  it('does not call the cloud on every poll during a publish', async () => {
    let release!: () => void;
    build.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    expect((await request('/publish', 'POST', {})).status).toBe(202);
    await vi.waitFor(() => { expect(build).toHaveBeenCalled(); });
    await request('/publish');
    const reads = account.shareStatus.mock.calls.length;
    for (let index = 0; index < 5; index += 1) await request('/publish');
    expect(account.shareStatus.mock.calls.length).toBe(reads);
    release();
    await service.settled('game');
  });

  it('removes the link and clears the project', async () => {
    await publishAndWait();
    const removed = await request('/publish', 'DELETE');
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    expect(account.shareRemove).toHaveBeenCalledWith('share-1');
    expect(getProject(db, 'game')?.metadata).not.toHaveProperty('publishShareId');
    expect(await (await request('/publish')).json()).toMatchObject({ job: null });
    expect((await request('/publish', 'DELETE')).status).toBe(404);
  });

  it('treats a removal of an already missing link as done', async () => {
    updateProject(db, 'game', { metadata: { ...getProject(db, 'game')!.metadata, publishShareId: 'gone' } });
    account.shareRemove.mockRejectedValue(new PublishCloudError('SHARE_NOT_FOUND'));
    expect((await request('/publish', 'DELETE')).status).toBe(200);
    expect(getProject(db, 'game')?.metadata).not.toHaveProperty('publishShareId');
  });

  it('refuses to remove during a publish', async () => {
    updateProject(db, 'game', { metadata: { ...getProject(db, 'game')!.metadata, publishShareId: 'share-1' } });
    let release!: () => void;
    build.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    await request('/publish', 'POST', {});
    expect((await request('/publish', 'DELETE')).status).toBe(409);
    await vi.waitFor(() => { expect(build).toHaveBeenCalled(); });
    release();
    await service.settled('game');
  });
});

describe('authorization', () => {
  const routes: [string, string, unknown?][] = [['/publish', 'GET'], ['/publish', 'POST', {}], ['/publish', 'DELETE'], ['/rooms', 'GET'], ['/rooms', 'PATCH', { monthlyCreditLimit: 1 }], ['/rooms/install', 'POST', {}], ['/rooms/test', 'POST', {}]];

  it.each(routes)('%s %s needs project access', async (route, method, body) => {
    allowProject = false;
    expect((await request(route, method, body)).status).toBe(403);
  });

  it.each(routes.filter(([, method]) => method !== 'GET'))('%s %s needs the local origin', async (route, method, body) => {
    sameOrigin = false;
    const response = await request(route, method, body);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { message: 'local origin required' } });
  });

  it('answers 404 for an unknown project', async () => {
    expect((await fetch(`${base}/api/projects/missing/publish`)).status).toBe(404);
  });

  it('refuses a token for another project, a read token writing, and a revoked token', async () => {
    const other = agentToken('other');
    expect((await request('/publish', 'GET', undefined, other)).status).toBe(403);
    const reader = agentToken('game', ['publish:read']);
    expect((await request('/publish', 'GET', undefined, reader)).status).toBe(200);
    expect((await request('/publish', 'POST', { skipBuild: true }, reader)).status).toBe(403);
    toolTokenRegistry.revokeToken(reader, 'manual');
    expect((await request('/publish', 'GET', undefined, reader)).status).toBe(403);
  });

  it('never lets an agent make the daemon run the build', async () => {
    const response = await request('/publish', 'POST', {}, agentToken());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining('inside the pixo CLI process') } });
    expect(build).not.toHaveBeenCalled();
    expect((await publishAndWait({ skipBuild: true }, agentToken())).job?.phase).toBe('done');
    expect(build).not.toHaveBeenCalled();
  });

  it('never lets an agent accept the sharing rules', async () => {
    const response = await request('/publish', 'POST', { skipBuild: true, acceptTerms: true }, agentToken());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining('creator must accept') } });
    expect(account.publishBegin).not.toHaveBeenCalled();
  });

  it('never lets an agent agree to the extra-game charge', async () => {
    account.shareStatus.mockResolvedValue(shareStatus({ publishPlan: FULL_PLAN }));
    const response = await request('/publish', 'POST', { skipBuild: true, payExtraGame: true }, agentToken());
    expect(response.status).toBe(403);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain('Share dialog');
    expect(body.error.message).toContain('pixo publish --pay-extra-game');
    expect(account.publishBegin).not.toHaveBeenCalled();
    // Without the agreement the agent gets the same refusal the creator would, with the price.
    const status = await publishAndWait({ skipBuild: true }, agentToken());
    expect(status.job).toMatchObject({ phase: 'failed', error: { code: 'PUBLISH_EXTRA_GAME_REQUIRED', credits: 100 } });
  });

  it('never lets an agent change the spending limit', async () => {
    updateProject(db, 'game', { metadata: { ...getProject(db, 'game')!.metadata, publishShareId: 'share-1' } });
    const response = await request('/rooms', 'PATCH', { monthlyCreditLimit: 100_000 }, agentToken());
    expect(response.status).toBe(403);
    expect(account.shareLimit).not.toHaveBeenCalled();
  });

  it('lets an agent read status, remove a link and add the SDK', async () => {
    updateProject(db, 'game', { metadata: { ...getProject(db, 'game')!.metadata, publishShareId: 'share-1' } });
    const token = agentToken();
    expect((await request('/rooms', 'GET', undefined, token)).status).toBe(200);
    expect((await request('/rooms/install', 'POST', {}, token)).status).toBe(200);
    expect((await request('/publish', 'DELETE', undefined, token)).status).toBe(200);
  });
});

describe('rooms', () => {
  it('installs the SDK, then reports it, and a second add changes nothing', async () => {
    const first = await request('/rooms/install', 'POST', {});
    expect(await first.json()).toEqual({ sdkPath: 'src/openpixo-rooms.ts', changed: true } satisfies RoomsInstallResponse);
    expect(await readFile(path.join(projectDir, 'src', 'openpixo-rooms.ts'), 'utf8')).toContain('export async function createRoom');
    expect(await (await request('/rooms/install', 'POST', {})).json()).toEqual({ sdkPath: 'src/openpixo-rooms.ts', changed: false });
    expect(await (await request('/rooms')).json()).toMatchObject({ sdkInstalled: true, sdkPath: 'src/openpixo-rooms.ts' });
  });

  it('refuses to overwrite an edited SDK and says so', async () => {
    await request('/rooms/install', 'POST', {});
    const file = path.join(projectDir, 'src', 'openpixo-rooms.ts');
    await writeFile(file, `${await readFile(file, 'utf8')}\n// mine\n`);
    const response = await request('/rooms/install', 'POST', {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT', message: expect.stringContaining('changed by hand') } });
    expect(await readFile(file, 'utf8')).toContain('// mine');
  });

  it('refuses a Godot project for the SDK and the test', async () => {
    await rm(path.join(projectDir, 'package.json'));
    await rm(path.join(projectDir, 'index.html'));
    await writeFile(path.join(projectDir, 'project.godot'), 'config_version=5\n');
    for (const route of ['/rooms/install', '/rooms/test']) {
      const response = await request(route, 'POST', {});
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining("Godot games can't use OpenPixo rooms") } });
    }
    expect(gameRuns.start).not.toHaveBeenCalled();
  });

  it('shows usage for a published game and hides it for an unpublished one', async () => {
    account.shareStatus.mockResolvedValue(shareStatus({ usage: USAGE, paused: { publish: false, rooms: true } }));
    expect(await (await request('/rooms')).json()).toEqual({ sdkInstalled: false, usage: null, paused: true, maxPlayers: 8, creditsPerPlayerHour: 5 } satisfies RoomsStatusResponse);
    updateProject(db, 'game', { metadata: { ...getProject(db, 'game')!.metadata, publishShareId: 'share-1' } });
    expect(await (await request('/rooms')).json()).toMatchObject({ usage: USAGE });
  });

  it('still answers locally when signed out or offline', async () => {
    account.shareStatus.mockRejectedValue(new AccountError('ACCOUNT_SIGNED_OUT'));
    expect(await (await request('/rooms')).json()).toMatchObject({ sdkInstalled: false, usage: null, paused: true, cloudUnknown: true });
  });

  it('sets the limit on the saved link', async () => {
    updateProject(db, 'game', { metadata: { ...getProject(db, 'game')!.metadata, publishShareId: 'share-1' } });
    account.shareStatus.mockResolvedValue(shareStatus({ usage: { ...USAGE, monthlyCreditLimit: 900 } }));
    const response = await request('/rooms', 'PATCH', { monthlyCreditLimit: 900 });
    expect(response.status).toBe(200);
    expect(account.shareLimit).toHaveBeenCalledWith('share-1', 900);
    expect(await response.json()).toMatchObject({ usage: { monthlyCreditLimit: 900 } });
  });

  it('needs a published game for a limit', async () => {
    const response = await request('/rooms', 'PATCH', { monthlyCreditLimit: 900 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining('Publish the game first') } });
  });

  it.each([[-1], [1.5], ['500'], [null], [10_000_001]])('rejects the limit %j', async limit => {
    const response = await request('/rooms', 'PATCH', { monthlyCreditLimit: limit });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: 'The limit must be a whole number of credits, from 0 to 10,000,000.' } });
  });
});

describe('rooms test', () => {
  const relayUrl = 'http://127.0.0.1:7456/api/rooms/local';
  const wired = `http://127.0.0.1:5173/?pixoRooms=${encodeURIComponent(relayUrl)}`;

  it('returns two relay-wired URLs of the running game without starting another', async () => {
    const response = await request('/rooms/test', 'POST', {});
    expect(await response.json()).toEqual({ urls: [wired, wired], relayUrl } satisfies RoomsTestResponse);
    expect(gameRuns.start).not.toHaveBeenCalled();
  });

  it('starts the game when it is not running and waits for its URL', async () => {
    const statuses: GameRunStatus[] = [{ status: 'idle' }, { status: 'idle' }, { status: 'starting' }, { status: 'running' }, { status: 'running', url: 'http://127.0.0.1:6000/' }];
    gameRuns.status.mockImplementation(() => statuses.shift() ?? { status: 'running', url: 'http://127.0.0.1:6000/' });
    gameRuns.start.mockResolvedValue({ status: 'starting' });
    const response = await request('/rooms/test', 'POST', {});
    expect(response.status).toBe(200);
    expect(gameRuns.start).toHaveBeenCalledWith('game');
    expect((await response.json() as RoomsTestResponse).urls[1]).toContain('http://127.0.0.1:6000/?pixoRooms=');
  });

  it('explains why the game could not start', async () => {
    run = { status: 'idle' };
    gameRuns.start.mockResolvedValue({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', message: 'Project dependencies are missing.' });
    const response = await request('/rooms/test', 'POST', {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining('Project dependencies are missing.') } });
  });

  it('never starts the game for an agent, but uses a running one', async () => {
    run = { status: 'idle' };
    const refused = await request('/rooms/test', 'POST', {}, agentToken());
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { message: expect.stringContaining('--url') } });
    expect(gameRuns.start).not.toHaveBeenCalled();
    run = { status: 'running', url: 'http://127.0.0.1:5173/' };
    expect((await request('/rooms/test', 'POST', {}, agentToken())).status).toBe(200);
  });

  it('accepts the dev server an agent started itself', async () => {
    run = { status: 'idle' };
    const response = await request('/rooms/test', 'POST', { gameUrl: 'http://localhost:8000/game/?level=2' }, agentToken());
    const { urls } = await response.json() as RoomsTestResponse;
    expect(urls[0]).toBe(`http://localhost:8000/game/?level=2&pixoRooms=${encodeURIComponent(relayUrl)}`);
    expect(gameRuns.start).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example/', 'http://evil.example/', 'file:///c:/x.html', 'not a url', 7])('refuses the game URL %j', async gameUrl => {
    expect((await request('/rooms/test', 'POST', { gameUrl })).status).toBe(400);
  });

  it('never saves a port in the project', async () => {
    await request('/rooms/test', 'POST', {});
    expect(JSON.stringify(getProject(db, 'game')?.metadata)).not.toContain('5173');
    expect(JSON.stringify(getProject(db, 'game')?.metadata)).not.toContain('7456');
  });
});

describe('while the game plan waits for approval', () => {
  beforeEach(() => {
    const metadata = getProject(db, 'game')!.metadata!;
    updateProject(db, 'game', { metadata: { ...metadata, gamePlan: { status: 'planning', startedAt: 1 } } });
  });

  it.each([
    ['/publish', 'POST', { skipBuild: true }],
    ['/publish', 'DELETE', undefined],
    ['/rooms/install', 'POST', {}],
    ['/rooms/test', 'POST', {}],
  ] as const)('refuses an agent %s %s, which would leave the read-only turn', async (route, method, body) => {
    const response = await request(route, method, body, agentToken());
    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('GAME_PLAN_NOT_APPROVED');
    expect(account.publishBegin).not.toHaveBeenCalled();
    expect(account.shareRemove).not.toHaveBeenCalled();
  });

  it('still lets an agent read the sharing state', async () => {
    expect((await request('/publish', 'GET', undefined, agentToken())).status).toBe(200);
    expect((await request('/rooms', 'GET', undefined, agentToken())).status).toBe(200);
  });

  it('leaves the creator free to share', async () => {
    await publishAndWait({ skipBuild: true });
    expect(account.publishFinish).toHaveBeenCalledOnce();
  });
});
