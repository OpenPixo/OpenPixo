import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { GameRunStatus, OnlineDataResponse, OnlineStatusResponse, OnlineTestResponse, OnlineUsage } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountError, PublishCloudError } from '../../src/account/errors.js';
import { closeDatabase, openDatabase, updateProject } from '../../src/db.js';
import { sendApiError } from '../../src/http/api-errors.js';
import { OnlineEmulator } from '../../src/online/emulator.js';
import { registerOnlineRoutes, type OnlineCloudAccount } from '../../src/routes/online.js';
import { registerPublishRoutes, type RegisterPublishRoutesDeps } from '../../src/routes/publish.js';
import { installRoomsSdk } from '../../src/rooms/sdk-install.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';
import type { PublishService } from '../../src/publish/service.js';
import { fakeAccount } from '../publish/harness.js';

const SDK_DIR = path.resolve(import.meta.dirname, '../../../../game-sdk');

const USAGE: OnlineUsage = { month: '2026-11', state: 'ok', gameRequests: 1200, gameBytes: 4096, players: 14, accountRequests: 5000,
  accountBytes: 9000, maxRequests: 1_000_000, maxBytes: 104_857_600, collections: { scores: 14 } };

let root: string;
let projectDir: string;
let db: ReturnType<typeof openDatabase>;
let server: Server;
let base: string;
let service: PublishService;
let emulator: OnlineEmulator;
let cloud: { [K in keyof OnlineCloudAccount]: ReturnType<typeof vi.fn> };
let sameOrigin: boolean;
let allowProject: boolean;
let run: GameRunStatus;
let gameRuns: { status: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
const tokens: string[] = [];

function agentToken(projectId = 'game', operations = ['online:read', 'online:write']): string {
  const grant = toolTokenRegistry.mint({ runId: `run-${tokens.length}`, projectId, allowedOperations: operations });
  tokens.push(grant.token);
  return grant.token;
}

function request(route: string, method = 'GET', body?: unknown, token?: string) {
  return fetch(`${base}/api/projects/game${route}`, { method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const json = async <T>(response: Response | Promise<Response>) => await (await response).json() as T;

function share(shareId: string | null): void {
  updateProject(db, 'game', { metadata: { kind: 'prototype', baseDir: projectDir, ...(shareId ? { publishShareId: shareId } : {}) } });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-online-routes-'));
  projectDir = path.join(root, 'folder');
  await mkdir(path.join(projectDir, 'src'), { recursive: true });
  await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', dev: 'vite' }, dependencies: { phaser: '3.90.0' } }));
  await writeFile(path.join(projectDir, 'index.html'), '<script src="/src/main.ts"></script>');
  await writeFile(path.join(projectDir, 'tsconfig.json'), '{}');
  db = openDatabase(root, { dataDir: root });
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('game', 'My game', 1, 1);
  share(null);
  sameOrigin = true; allowProject = true;
  run = { status: 'running', url: 'http://127.0.0.1:5173/' };
  gameRuns = { status: vi.fn(() => run), start: vi.fn(async () => run) };
  cloud = { assertConfigured: vi.fn(), hasSession: vi.fn(async () => true), onlineStatus: vi.fn(async () => USAGE), onlineReset: vi.fn(async () => {}) };
  emulator = new OnlineEmulator({ dataDir: root });
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
  service = registerPublishRoutes(app, { ...ctx, account: fakeAccount('http://127.0.0.1:1/upload'), build: async () => {}, sleep: async () => {} });
  registerOnlineRoutes(app, { ...ctx, publish: service, gameRuns: gameRuns as never, sdkDir: SDK_DIR, emulator, account: cloud as never, runPollMs: 1 });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  for (const token of tokens.splice(0)) toolTokenRegistry.revokeToken(token, 'manual');
  await service.dispose();
  emulator.dispose();
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
  closeDatabase();
  await rm(root, { recursive: true, force: true });
});

describe('status', () => {
  it('reports the SDK and local data, without asking the cloud before the game is published', async () => {
    expect(await json<OnlineStatusResponse>(request('/online'))).toEqual({ sdkInstalled: false, usage: null, local: { players: 0, collections: {} } });
    expect(cloud.onlineStatus).not.toHaveBeenCalled();
    emulator.seed('game', { players: 3, collection: 'scores' });
    await request('/online/install', 'POST', {});
    expect(await json<OnlineStatusResponse>(request('/online'))).toEqual({ sdkInstalled: true, sdkPath: 'src/openpixo-online.ts', usage: null,
      local: { players: 3, collections: { scores: 3 } } });
  });

  it('shows this month\'s use once published', async () => {
    share('share-1');
    expect(await json<OnlineStatusResponse>(request('/online'))).toMatchObject({ usage: USAGE });
    expect(cloud.onlineStatus).toHaveBeenCalledWith('share-1');
  });

  it.each([
    ['signed out', () => { cloud.hasSession.mockResolvedValue(false); }],
    ['offline', () => { cloud.onlineStatus.mockRejectedValue(new AccountError('CLOUD_UNAVAILABLE')); }],
  ])('says it could not ask when %s', async (_name, arrange) => {
    share('share-1');
    arrange();
    expect(await json<OnlineStatusResponse>(request('/online'))).toMatchObject({ usage: null, cloudUnknown: true, local: { players: 0 } });
  });

  it('treats a link the cloud no longer knows as unpublished', async () => {
    share('share-1');
    cloud.onlineStatus.mockRejectedValue(new PublishCloudError('SHARE_NOT_FOUND'));
    const status = await json<OnlineStatusResponse>(request('/online'));
    expect(status.usage).toBeNull();
    expect(status.cloudUnknown).toBeUndefined();
  });
});

describe('install', () => {
  it('adds the SDK to the game and refuses a Godot project in plain words', async () => {
    expect(await json(request('/online/install', 'POST', {}))).toEqual({ sdkPath: 'src/openpixo-online.ts', changed: true });
    expect(await readFile(path.join(projectDir, 'src', 'openpixo-online.ts'), 'utf8')).toContain('export const online');
    await rm(path.join(projectDir, 'package.json'));
    await rm(path.join(projectDir, 'index.html'));
    await writeFile(path.join(projectDir, 'project.godot'), 'config_version=5\n');
    const refused = await request('/online/install', 'POST', {});
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { message: expect.stringContaining("Godot games can't use OpenPixo online features") } });
  });

  it('refuses to overwrite a copy edited by hand', async () => {
    await writeFile(path.join(projectDir, 'src', 'openpixo-online.ts'), 'export const mine = 1;\n');
    const response = await request('/online/install', 'POST', {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining('changed by hand') } });
  });
});

describe('local test', () => {
  it('wires the running game to this project\'s emulator', async () => {
    const result = await json<OnlineTestResponse>(request('/online/test', 'POST', {}));
    expect(result.emulatorUrl).toBe('http://127.0.0.1:7456/api/online/local/game');
    const url = new URL(result.url);
    expect(url.origin).toBe('http://127.0.0.1:5173');
    expect(url.searchParams.get('pixoOnline')).toBe(result.emulatorUrl);
    expect(url.searchParams.has('pixoRooms')).toBe(false);
  });

  it('adds the rooms relay too when the game has rooms', async () => {
    await installRoomsSdk({ sdkDir: SDK_DIR, projectDir, cwd: '.' });
    const { url } = await json<OnlineTestResponse>(request('/online/test', 'POST', { gameUrl: 'http://localhost:8080/play?level=2' }));
    const parsed = new URL(url);
    expect(parsed.searchParams.get('level')).toBe('2');
    expect(parsed.searchParams.get('pixoRooms')).toBe('http://127.0.0.1:7456/api/rooms/local');
    expect(parsed.searchParams.get('pixoOnline')).toBe('http://127.0.0.1:7456/api/online/local/game');
  });

  it('starts the game for the creator, but never for an agent', async () => {
    run = { status: 'idle' };
    gameRuns.start.mockImplementation(async () => { run = { status: 'running', url: 'http://127.0.0.1:5174/' }; return run; });
    const refused = await request('/online/test', 'POST', {}, agentToken());
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { message: expect.stringContaining('pixo online test --url') } });
    expect(gameRuns.start).not.toHaveBeenCalled();
    const agent = await json<OnlineTestResponse>(request('/online/test', 'POST', { gameUrl: 'http://127.0.0.1:5199/' }, agentToken()));
    expect(new URL(agent.url).port).toBe('5199');
    const creator = await json<OnlineTestResponse>(request('/online/test', 'POST', {}));
    expect(new URL(creator.url).port).toBe('5174');
    expect(gameRuns.start).toHaveBeenCalledTimes(1);
  });

  it('accepts only a local game URL', async () => {
    expect((await request('/online/test', 'POST', { gameUrl: 'https://example.com/' })).status).toBe(400);
  });
});

describe('test data', () => {
  it('seeds, lists and resets, for the creator and an agent alike', async () => {
    const token = agentToken();
    expect(await json(request('/online/seed', 'POST', { players: 20, collection: 'scores' }, token))).toEqual({ players: 20, docs: 20 });
    expect(await json<OnlineDataResponse>(request('/online/data', 'GET', undefined, token))).toEqual({ players: 20, collections: { scores: 20 } });
    const listed = await json<OnlineDataResponse>(request('/online/data?collection=scores'));
    expect(listed.docs).toHaveLength(20);
    expect(listed.docs![0]).toMatchObject({ collection: 'scores', key: 'main', score: expect.any(Number) });
    expect(await json(request('/online/data', 'DELETE', undefined, token))).toEqual({ players: 0, collections: {} });
  });

  it('copies data it is given and refuses a bad request plainly', async () => {
    expect(await json(request('/online/seed', 'POST', { players: 2, collection: 'teams', data: { units: ['archer'] } }))).toEqual({ players: 2, docs: 2 });
    expect((await json<OnlineDataResponse>(request('/online/data?collection=teams'))).docs!.map(doc => doc.data)).toEqual([{ units: ['archer'] }, { units: ['archer'] }]);
    for (const body of [{ players: 'many' }, { collection: 3 }, [1]]) expect((await request('/online/seed', 'POST', body)).status).toBe(400);
    const named = await request('/online/seed', 'POST', { collection: 'High Scores' });
    expect(named.status).toBe(400);
    expect(await named.json()).toMatchObject({ error: { message: expect.stringContaining('lowercase') } });
    expect((await request('/online/data?collection=Bad Name')).status).toBe(400);
  });
});

describe('clearing the public game\'s data', () => {
  it('is the creator\'s call', async () => {
    share('share-1');
    expect(await json(request('/online/hosted', 'DELETE'))).toEqual({ ok: true });
    expect(cloud.onlineReset).toHaveBeenCalledWith('share-1');
    const refused = await request('/online/hosted', 'DELETE', undefined, agentToken());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { message: expect.stringContaining('Only the creator') } });
    expect(cloud.onlineReset).toHaveBeenCalledTimes(1);
  });

  it('needs a public link', async () => {
    const response = await request('/online/hosted', 'DELETE');
    expect(response.status).toBe(409);
    expect(cloud.onlineReset).not.toHaveBeenCalled();
  });

  it('passes on a cloud refusal', async () => {
    share('share-1');
    cloud.onlineReset.mockRejectedValue(new AccountError('ACCOUNT_SIGNED_OUT'));
    const response = await request('/online/hosted', 'DELETE');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'ACCOUNT_SIGNED_OUT' } });
  });
});

describe('authorization', () => {
  const routes: [string, string, unknown?][] = [['/online', 'GET'], ['/online/install', 'POST', {}], ['/online/test', 'POST', {}],
    ['/online/seed', 'POST', {}], ['/online/data', 'GET'], ['/online/data', 'DELETE'], ['/online/hosted', 'DELETE']];

  it.each(routes)('%s %s needs project access', async (route, method, body) => {
    allowProject = false;
    expect((await request(route, method, body)).status).toBe(403);
  });

  it.each(routes.filter(([, method]) => method !== 'GET'))('%s %s needs the local origin', async (route, method, body) => {
    sameOrigin = false;
    expect((await request(route, method, body)).status).toBe(403);
  });

  it('refuses a token for another project and a read token writing', async () => {
    expect((await request('/online', 'GET', undefined, agentToken('other'))).status).toBe(403);
    const reader = agentToken('game', ['online:read']);
    expect((await request('/online', 'GET', undefined, reader)).status).toBe(200);
    expect((await request('/online/seed', 'POST', {}, reader)).status).toBe(403);
    expect((await request('/online/data', 'DELETE', undefined, reader)).status).toBe(403);
  });

  it('answers 404 for an unknown project', async () => {
    expect((await fetch(`${base}/api/projects/missing/online`)).status).toBe(404);
  });
});
