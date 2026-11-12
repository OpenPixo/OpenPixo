import type { ApiErrorResponse, CheckGameTargetResponse, CreateGameFromTemplateResponse, GameEngineOption, GameTemplatesResponse, ImportFolderResponse } from '@openpixo/contracts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { expect, it } from 'vitest';
import * as store from '../../src/db.js';
import * as projects from '../../src/projects.js';
import { signDesktopImportToken, verifyDesktopImportToken } from '../../src/desktop-auth.js';
import { sendApiError } from '../../src/http/api-errors.js';
import { registerImportRoutes } from '../../src/import-export-routes.js';
import { registerGameTemplateRoutes } from '../../src/routes/game-templates.js';

it('uses folder import authorization and registration, rejecting before copying', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'openpixo-template-route-'));
  const data = path.join(root, 'data');
  await mkdir(data);
  const secret = randomBytes(32);
  const consumed = new Map<string, number>();
  const db = store.openDatabase(data, { dataDir: data });
  let server: Server | undefined;
  try {
    const app = express();
    app.use(express.json());
    const folderImporter = registerImportRoutes(app, {
      db, http: { sendApiError }, node: { fs, path }, ids: { randomId: randomUUID },
      paths: { PROJECTS_DIR: path.join(data, 'projects'), RUNTIME_DATA_DIR_CANONICAL: await realpath(data) },
      imports: projects, projectStore: store, conversations: store, projectFiles: store,
      uploads: { importUpload: { single: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next() } },
      validation: {
        validateProjectSkillId: async () => ({ ok: true, id: null }),
      },
      auth: {
        desktopAuthSecret: () => secret, isDesktopAuthGateActive: () => true,
        consumedImportNonces: consumed, pruneExpiredImportNonces: () => {},
        verifyDesktopImportToken,
      },
    } as unknown as Parameters<typeof registerImportRoutes>[1]);
    registerGameTemplateRoutes(app, {
      http: { sendApiError } as Parameters<typeof registerGameTemplateRoutes>[1]['http'],
      folderImporter, templatesRoot: fileURLToPath(new URL('../../../../game-templates/', import.meta.url)),
    });
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const base = `http://127.0.0.1:${address.port}`;
    const token = (dir: string) => signDesktopImportToken(secret, dir, { nonce: randomUUID(), exp: new Date(Date.now() + 60_000).toISOString() });
    const post = (endpoint: string, body: unknown, auth?: string) => fetch(base + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'x-pixo-desktop-import-token': auth } : {}) },
      body: JSON.stringify(body),
    });
    const input = { templateId: 'phaser3-sample-platformer', parentDir: root, name: 'game' };
    expect((await post('/api/projects/game-from-template', input)).status).toBe(403);
    expect((await readdir(root)).sort()).toEqual(['data']);
    expect((await post('/api/projects/game-from-template', input, token(data))).status).toBe(403);
    const auth = token(root);
    // The preflight applies the same gate but never spends the token.
    const check = async (body: unknown, header?: string) => {
      const response = await post('/api/projects/game-from-template/check', body, header);
      expect(response.status).toBe(200);
      return await response.json() as CheckGameTargetResponse;
    };
    expect(await check({ parentDir: root, name: 'game' })).toMatchObject({ status: 'picker-required', message: 'token missing' });
    expect(await check({ parentDir: root, name: 'bad:name' }, auth)).toEqual({ status: 'invalid-name', nameProblem: 'characters' });
    expect(await check({ parentDir: path.join(root, 'missing'), name: 'game' }, token(path.join(root, 'missing'))))
      .toMatchObject({ status: 'invalid-parent' });
    expect(await check({ parentDir: root, name: 'data' }, auth)).toMatchObject({ status: 'exists' });
    expect(await check({ parentDir: data, name: 'blocked' }, token(data)))
      .toMatchObject({ status: 'rejected', message: 'cannot import the data directory' });
    expect(await check({ parentDir: root, name: 'game' }, auth))
      .toEqual({ status: 'available', target: path.join(await realpath(root), 'game') });
    expect((await readdir(root)).sort()).toEqual(['data']);
    const created = await post('/api/projects/game-from-template', input, auth);
    expect(created.status).toBe(200);
    const body = await created.json() as CreateGameFromTemplateResponse;
    expect(['initialized', 'skipped']).toContain(body.git.status);
    expect(body.project.metadata).toMatchObject({ baseDir: path.join(await realpath(root), 'game'), importedFrom: 'folder', fromTrustedPicker: true });
    expect(store.getProject(db, body.project.id)?.name).toBe('game');
    expect(store.getConversation(db, body.conversationId)?.projectId).toBe(body.project.id);
    expect(body.entryFile).toBe('index.html');
    const projectRoot = path.join(await realpath(root), 'game');
    if (body.git.status === 'initialized') {
      const { stdout } = await promisify(execFile)('git', ['log', '-1', '--format=%an <%ae>%n%s'], { cwd: projectRoot, windowsHide: true });
      expect(stdout.trim()).toBe('OpenPixo <openpixo@local.invalid>\nInitial project from phaser3-sample-platformer');
    } else expect(body.git.reasonCode).toBe('GIT_MISSING');
    const assets = ['player.png', 'ground.png', 'coin.png', 'background.png', 'jump.wav', 'coin.wav'];
    const sampleRoot = fileURLToPath(new URL('../../../../game-templates/phaser3-sample-platformer/', import.meta.url));
    expect((await readdir(path.join(projectRoot, 'public/assets'))).sort()).toEqual([...assets].sort());
    for (const asset of assets) {
      expect(await readFile(path.join(projectRoot, 'public/assets', asset)))
        .toEqual(await readFile(path.join(sampleRoot, 'files/public/assets', asset)));
    }
    expect(await readdir(projectRoot)).not.toContain('template.json');
    expect(await readdir(projectRoot)).not.toContain('generate-assets.ts');
    expect((await post('/api/projects/game-from-template', { ...input, name: 'replay' }, auth)).status).toBe(403);
    const rejected = await post('/api/projects/game-from-template', { ...input, parentDir: data, name: 'blocked' }, token(data));
    expect(rejected.status).toBe(400);
    expect((await rejected.json() as ApiErrorResponse).error.message).toBe('cannot import the data directory');
    expect(fs.existsSync(path.join(data, 'blocked'))).toBe(false);
    const imported = await post('/api/import/folder', { baseDir: path.join(root, 'game') }, token(path.join(root, 'game')));
    expect(imported.status).toBe(200);
    expect((await imported.json() as ImportFolderResponse).project.metadata?.baseDir).toBe(body.project.metadata?.baseDir);
    const parentDir = path.join(root, 'new', 'games');
    const newInput = { templateId: 'godot4-2d', parentDir, name: 'new-game', createParent: true };
    const parentToken = token(parentDir);
    expect(await check(newInput, parentToken)).toMatchObject({ status: 'available' });
    expect(fs.existsSync(parentDir)).toBe(false);
    const newGame = await post('/api/projects/game-from-template', newInput, parentToken);
    expect(newGame.status).toBe(200);
    expect(fs.existsSync(path.join(parentDir, 'new-game', 'project.godot'))).toBe(true);
    const blockedParent = path.join(data, 'missing', 'games');
    const deniedParent = await post('/api/projects/game-from-template', { ...newInput, parentDir: blockedParent }, token(blockedParent));
    expect(deniedParent.status).toBe(400);
    expect((await deniedParent.json() as ApiErrorResponse).error.details).toMatchObject({ reasonCode: 'TARGET_REJECTED' });
    expect(fs.existsSync(path.join(data, 'missing'))).toBe(false);
    const templates = (await (await fetch(base + '/api/game-templates')).json() as GameTemplatesResponse).templates;
    expect(templates).toHaveLength(5);
    expect(templates).toContainEqual(expect.objectContaining({
      id: 'phaser3-sample-platformer', name: 'Sample: pixel platformer', nameZhCN: '示例：像素平台跳跃',
      descriptionZhCN: expect.stringContaining('无需配置生成密钥'),
    }));
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('says what this machine can run, and a failed check leaves the template list intact', async () => {
  const shipped = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
  const listen = async (engineOptions: () => Promise<GameEngineOption[]>) => {
    const app = express();
    registerGameTemplateRoutes(app, {
      http: { sendApiError } as Parameters<typeof registerGameTemplateRoutes>[1]['http'],
      folderImporter: {} as Parameters<typeof registerGameTemplateRoutes>[1]['folderImporter'],
      templatesRoot: shipped, engineOptions,
    });
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const body = await (await fetch(`http://127.0.0.1:${address.port}/api/game-templates`)).json() as GameTemplatesResponse;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return body;
  };
  const godot: GameEngineOption = { engine: 'godot', name: 'Godot', templates: [], available: false, missingTools: ['godot'] };
  expect((await listen(async () => [godot])).engines).toEqual([godot]);
  const failed = await listen(async () => { throw new Error('tool lookup failed'); });
  expect(failed.engines).toBeUndefined();
  expect(failed.templates).toHaveLength(5);
});

it('serves a listed template cover and 404s for unknown, invalid or cover-less ids', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'openpixo-template-cover-'));
  let server: Server | undefined;
  try {
    await mkdir(path.join(root, 'plain', 'files'), { recursive: true });
    await writeFile(path.join(root, 'plain', 'template.json'), JSON.stringify({ id: 'plain', name: 'Plain', engine: 'phaser', description: 'No cover' }));
    const shipped = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
    const app = express();
    const deps = (templatesRoot: string) => ({
      http: { sendApiError } as Parameters<typeof registerGameTemplateRoutes>[1]['http'],
      folderImporter: {} as Parameters<typeof registerGameTemplateRoutes>[1]['folderImporter'], templatesRoot,
    });
    const shippedApp = express();
    registerGameTemplateRoutes(shippedApp, deps(shipped));
    registerGameTemplateRoutes(app, deps(root));
    app.use('/shipped', shippedApp);
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const base = `http://127.0.0.1:${address.port}`;
    const listed = (await (await fetch(`${base}/shipped/api/game-templates`)).json() as GameTemplatesResponse).templates;
    const platformer = listed.find(template => template.id === 'phaser3-sample-platformer');
    expect(platformer?.coverUrl).toBe('/api/game-templates/phaser3-sample-platformer/cover');
    const cover = await fetch(`${base}/shipped${platformer!.coverUrl}`);
    expect(cover.status).toBe(200);
    expect(cover.headers.get('content-type')).toMatch(/^image\/(webp|png)/);
    expect(cover.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(Buffer.from(await cover.arrayBuffer()))
      .toEqual(await readFile(path.join(shipped, 'phaser3-sample-platformer', cover.headers.get('content-type')!.includes('webp') ? 'cover.webp' : 'cover.png')));
    for (const id of ['plain', 'missing', 'Bad_Id', '%2e%2e%2fplain', '.plain']) {
      const response = await fetch(`${base}/api/game-templates/${id}/cover`);
      expect(response.status, id).toBe(404);
      expect((await response.json() as ApiErrorResponse).error.code, id).toBe('NOT_FOUND');
    }
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

// A packaged test build and a worktree both keep their files under a dot-folder.
it('serves a template cover when the templates root sits under a dot-directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'openpixo-template-dotdir-'));
  let server: Server | undefined;
  try {
    const templatesRoot = path.join(root, '.tmp', 'templates');
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    await mkdir(path.join(templatesRoot, 'plain', 'files'), { recursive: true });
    await writeFile(path.join(templatesRoot, 'plain', 'template.json'), JSON.stringify({ id: 'plain', name: 'Plain', engine: 'phaser', description: 'Has a cover' }));
    await writeFile(path.join(templatesRoot, 'plain', 'cover.png'), png);
    const app = express();
    registerGameTemplateRoutes(app, {
      http: { sendApiError } as Parameters<typeof registerGameTemplateRoutes>[1]['http'],
      folderImporter: {} as Parameters<typeof registerGameTemplateRoutes>[1]['folderImporter'], templatesRoot,
    });
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const cover = await fetch(`http://127.0.0.1:${address.port}/api/game-templates/plain/cover`);
    expect(cover.status).toBe(200);
    expect(cover.headers.get('content-type')).toMatch(/^image\/png/);
    expect(Buffer.from(await cover.arrayBuffer())).toEqual(png);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

it('mounts template listing and creation on the daemon', async () => {
  const { startServer } = await import('../../src/server.js');
  const parent = await mkdtemp(path.join(tmpdir(), 'openpixo-template-bootstrap-'));
  let server: Server | undefined;
  try {
    const started = await startServer({ port: 0, returnServer: true }) as { url: string; server: Server };
    server = started.server;
    const listed = await fetch(started.url + '/api/game-templates');
    expect(listed.status).toBe(200);
    expect((await listed.json() as GameTemplatesResponse).templates).toHaveLength(5);
    const response = await fetch(started.url + '/api/projects/game-from-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: started.url },
      body: JSON.stringify({ templateId: 'godot4-2d', parentDir: parent, name: 'game' }),
    });
    const body = await response.json() as ImportFolderResponse;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.project.metadata?.baseDir).toBe(path.join(await realpath(parent), 'game'));
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(parent, { recursive: true, force: true });
  }
});

// Phaser centres its canvas with a margin that collapses through unstyled parents, so
// the page overflows its frame and shows both scrollbars. A game page never scrolls.
it.each(['phaser3-sample-platformer', 'phaser3-vite', 'threejs-vite'])('%s fills its page without overflowing', async (id) => {
  const html = await readFile(fileURLToPath(new URL(`../../../../game-templates/${id}/files/index.html`, import.meta.url)), 'utf8');
  expect(html).toMatch(/html, body \{[^}]*overflow: hidden/);
  if (id !== 'threejs-vite') expect(html).toMatch(/#game \{[^}]*height: 100%[^}]*overflow: hidden/);
});
