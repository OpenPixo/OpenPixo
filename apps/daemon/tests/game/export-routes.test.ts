/**
 * `/api/projects/:id/game/export`, the route behind the export menu and
 * `pixo game export`. See `export-playable.test.ts` for the file it makes.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { GAME_EXPORT_FILES_HEADER, type GameExportStatusResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, openDatabase, updateProject } from '../../src/db.js';
import { sendApiError } from '../../src/http/api-errors.js';
import { PublishBuildError } from '../../src/publish/build.js';
import { registerPublishRoutes, type RegisterPublishRoutesDeps } from '../../src/routes/publish.js';
import { registerGameExportRoutes } from '../../src/routes/game-export.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';
import type { PublishService } from '../../src/publish/service.js';

let root: string;
let projectDir: string;
let db: ReturnType<typeof openDatabase>;
let server: Server;
let base: string;
let service: PublishService;
let build: ReturnType<typeof vi.fn<NonNullable<RegisterPublishRoutesDeps['build']>>>;
const tokens: string[] = [];

function request(method = 'GET', body?: unknown, token?: string) {
  return fetch(`${base}/api/projects/game/game/export`, { method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-game-export-'));
  projectDir = path.join(root, 'folder');
  await mkdir(path.join(projectDir, 'src'), { recursive: true });
  await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', dev: 'vite' }, dependencies: { phaser: '3.90.0' } }));
  await writeFile(path.join(projectDir, 'index.html'), '<script type="module" src="/src/main.ts"></script>');
  await mkdir(path.join(projectDir, 'dist', 'assets'), { recursive: true });
  await mkdir(path.join(projectDir, 'dist', 'art'), { recursive: true });
  await writeFile(path.join(projectDir, 'dist', 'index.html'), '<html><head><script type="module" crossorigin src="/assets/index.js"></script></head><body></body></html>');
  await writeFile(path.join(projectDir, 'dist', 'assets', 'index.js'), 'this.load.image("hero","art/hero.png")');
  await writeFile(path.join(projectDir, 'dist', 'art', 'hero.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  db = openDatabase(root, { dataDir: root });
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('game', '火星农场', 1, 1);
  updateProject(db, 'game', { metadata: { kind: 'prototype', baseDir: projectDir } });
  build = vi.fn(async () => {});
  const app = express();
  app.use(express.json());
  const ctx = { db, paths: { PROJECTS_DIR: path.join(root, 'projects'), RUNTIME_DATA_DIR: root } as RegisterPublishRoutesDeps['paths'],
    http: { sendApiError, requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(), isLocalSameOrigin: () => true, resolvedPortRef: { current: 7456 } } as unknown as RegisterPublishRoutesDeps['http'],
    authorizeProjectRequest: async () => true,
    authorizeProjectToolRequest: async (_res: express.Response, projectId: string) => ({ projectId }) };
  service = registerPublishRoutes(app, { ...ctx, build });
  registerGameExportRoutes(app, { ...ctx, publish: service });
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

describe('exporting a web game as one offline file', () => {
  it('says the game can be exported and which file is the game', async () => {
    expect(await (await request()).json() as GameExportStatusResponse).toEqual({ available: true, entry: 'index.html' });
  });

  it('builds, then answers with the playable file named after the game', async () => {
    const response = await request('POST', {});
    expect(response.status).toBe(200);
    expect(build).toHaveBeenCalledTimes(1);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/u.exec(response.headers.get('content-disposition')!)![1]!)).toBe('火星农场.html');
    expect(response.headers.get(GAME_EXPORT_FILES_HEADER)).toBe('1');
    const html = await response.text();
    expect(html).toContain('<script type="module">this.load.image("hero","art/hero.png")</script>');
    expect(html).toContain('"art/hero.png":["image/png"');
  });

  it('says plainly when the build fails', async () => {
    build.mockRejectedValueOnce(new PublishBuildError('The game failed to build. Fix the errors below, then export again.\nsrc/main.ts(3): error'));
    const response = await request('POST', {});
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'GAME_EXPORT_BUILD_FAILED', message: expect.stringContaining('then export again') } });
  });

  it('is not offered for an engine that has its own exporter', async () => {
    await rm(path.join(projectDir, 'package.json'));
    await rm(path.join(projectDir, 'index.html'));
    await writeFile(path.join(projectDir, 'project.godot'), '[application]\nconfig/name="x"\n');
    const status = await (await request()).json() as GameExportStatusResponse;
    expect(status.available).toBe(false);
    expect(status.message).toMatch(/Godot/u);
    expect(await (await request('POST', {})).json()).toMatchObject({ error: { code: 'GAME_EXPORT_UNSUPPORTED' } });
  });

  it('makes an agent build in its own process first', async () => {
    const grant = toolTokenRegistry.mint({ runId: 'run-1', projectId: 'game', allowedOperations: ['game:export'] });
    tokens.push(grant.token);
    expect((await request('POST', {}, grant.token)).status).toBe(403);
    expect(build).not.toHaveBeenCalled();
    const response = await request('POST', { skipBuild: true }, grant.token);
    expect(response.status).toBe(200);
    expect(build).not.toHaveBeenCalled();
  });
});
