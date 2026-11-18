import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { PublishedGamesResponse, ShareListResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountError } from '../../src/account/errors.js';
import { shareListResponse } from '../../src/account/publish-cloud.js';
import { closeDatabase, getProject, openDatabase, updateProject } from '../../src/db.js';
import { sendApiError } from '../../src/http/api-errors.js';
import { registerPublishRoutes, type RegisterPublishRoutesDeps } from '../../src/routes/publish.js';
import { registerPublishedGamesRoutes } from '../../src/routes/published-games.js';
import type { PublishService } from '../../src/publish/service.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';
import { fakeAccount, GAME, USAGE } from './harness.js';

const ORPHAN = { ...GAME, shareId: 'orphan-1', url: 'https://play.example/orphan-1', title: 'Old game' };
const LIST: ShareListResponse = {
  games: [{ game: GAME, rooms: USAGE, online: null }, { game: ORPHAN, rooms: USAGE, online: null }],
  paused: { publish: false, rooms: true, online: false },
  limits: { maxPlayers: 8, creditsPerPlayerHour: 5 },
  publishPlan: { planRequired: false, sku: 'plan_starter', maxLiveGames: 10, maxGameBytes: 104_857_600, liveGames: 2 },
  onlineAccount: null,
  roomsAccount: { month: '2026-11', freeMinutesTotal: 600, freeMinutesUsed: 90, creditsCharged: 3, openRooms: 1 },
};

let root: string;
let db: ReturnType<typeof openDatabase>;
let server: Server;
let base: string;
let account: ReturnType<typeof fakeAccount>;
let service: PublishService;
let sameOrigin: boolean;
const tokens: string[] = [];

function call(route: string, method = 'GET', body?: unknown, token?: string) {
  return fetch(`${base}/api/published-games${route}`, { method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-published-games-'));
  db = openDatabase(root, { dataDir: root });
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('game', 'My game', 1, 1);
  updateProject(db, 'game', { metadata: { kind: 'prototype', publishShareId: GAME.shareId } });
  account = fakeAccount('http://127.0.0.1:1/upload');
  account.shareList.mockResolvedValue(LIST);
  sameOrigin = true;
  const app = express();
  app.use(express.json());
  const http = { sendApiError, requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
    isLocalSameOrigin: () => sameOrigin, resolvedPortRef: { current: 7456 } } as unknown as RegisterPublishRoutesDeps['http'];
  service = registerPublishRoutes(app, { db, http, paths: { PROJECTS_DIR: path.join(root, 'projects'), RUNTIME_DATA_DIR: root } as RegisterPublishRoutesDeps['paths'],
    authorizeProjectRequest: async () => true, authorizeProjectToolRequest: async (_res: unknown, projectId: string) => ({ projectId }), account } as never);
  registerPublishedGamesRoutes(app, { http, publish: service });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  for (const token of tokens.splice(0)) toolTokenRegistry.revokeToken(token, 'manual');
  await service.dispose();
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
  closeDatabase();
  await rm(root, { recursive: true, force: true });
});

describe('the game hub list', () => {
  it('lists every link on the account and names the project on this computer that has it', async () => {
    const list = await (await call('')).json() as PublishedGamesResponse;
    expect(list.available).toBe(true);
    expect(list.games.map(item => [item.game.shareId, item.project])).toEqual([[GAME.shareId, { id: 'game', name: 'My game' }], [ORPHAN.shareId, null]]);
    expect(list.account).toEqual({ paused: LIST.paused, limits: LIST.limits, publishPlan: LIST.publishPlan, onlineAccount: null, roomsAccount: LIST.roomsAccount });
  });

  it('says why there is no list when signed out or the session ended', async () => {
    account.hasSession.mockResolvedValueOnce(false);
    expect(await (await call('')).json()).toEqual({ available: false, unavailableReason: 'signed_out', games: [] });
    account.shareList.mockRejectedValueOnce(new AccountError('ACCOUNT_SIGNED_OUT'));
    expect(await (await call('')).json()).toEqual({ available: false, unavailableReason: 'signed_out', games: [] });
  });

  it('refuses an agent token: these routes reach the whole account', async () => {
    const grant = toolTokenRegistry.mint({ runId: 'run-hub', projectId: 'game', allowedOperations: ['publish:read', 'publish:write'] });
    tokens.push(grant.token);
    for (const [route, method, body] of [['', 'GET'], [`/${ORPHAN.shareId}`, 'DELETE'], [`/${ORPHAN.shareId}/rooms`, 'PATCH', { monthlyCreditLimit: 5 }]] as const) {
      const response = await call(route, method, body, grant.token);
      expect(response.status).toBe(403);
    }
    expect(account.shareList).not.toHaveBeenCalled();
    expect(account.shareRemove).not.toHaveBeenCalled();
    expect(account.shareLimit).not.toHaveBeenCalled();
  });
});

describe('managing a link by its share id', () => {
  it('removes a link whose project is gone from this computer', async () => {
    expect(await (await call(`/${ORPHAN.shareId}`, 'DELETE')).json()).toEqual({ ok: true });
    expect(account.shareRemove).toHaveBeenCalledWith(ORPHAN.shareId);
  });

  it('removes a local game’s link through its project, which forgets the share id', async () => {
    expect((await call(`/${GAME.shareId}`, 'DELETE')).status).toBe(200);
    expect(account.shareRemove).toHaveBeenCalledWith(GAME.shareId);
    expect(getProject(db, 'game')?.metadata?.publishShareId).toBeUndefined();
  });

  it('sets the rooms spending limit of any link and checks the number', async () => {
    const response = await call(`/${ORPHAN.shareId}/rooms`, 'PATCH', { monthlyCreditLimit: 900 });
    expect(await response.json()).toEqual({ usage: USAGE });
    expect(account.shareLimit).toHaveBeenCalledWith(ORPHAN.shareId, 900);
    for (const monthlyCreditLimit of [-1, 1.5, 10_000_001, '9']) {
      expect((await call(`/${ORPHAN.shareId}/rooms`, 'PATCH', { monthlyCreditLimit })).status).toBe(400);
    }
  });

  it('refuses a write from another origin and an id that cannot be a share id', async () => {
    sameOrigin = false;
    expect((await call(`/${ORPHAN.shareId}`, 'DELETE')).status).toBe(403);
    sameOrigin = true;
    expect((await call('/bad%20id', 'DELETE')).status).toBe(404);
    expect(account.shareRemove).not.toHaveBeenCalled();
  });
});

describe('reading the cloud list', () => {
  it('keeps only contract fields and refuses an unreadable answer', () => {
    const parsed = shareListResponse({ ...LIST, debug: 'x', games: [{ game: { ...GAME, secret: 1 }, rooms: USAGE, online: null }],
      onlineAccount: { month: '2026-11', state: 'read-only', stateReason: 'requests-cap', requests: 10, bytes: 5, maxRequests: 10, maxBytes: 100, extra: true } });
    expect(parsed).toEqual({ ...LIST, games: [{ game: GAME, rooms: USAGE, online: null }],
      onlineAccount: { month: '2026-11', state: 'read-only', stateReason: 'requests-cap', requests: 10, bytes: 5, maxRequests: 10, maxBytes: 100 } });
    expect(() => shareListResponse({ ...LIST, games: 'nope' })).toThrow();
    expect(() => shareListResponse({ ...LIST, paused: { publish: false, rooms: false } })).toThrow();
    expect(() => shareListResponse({ ...LIST, roomsAccount: undefined })).toThrow();
  });
});
