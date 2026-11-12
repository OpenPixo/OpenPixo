import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { PluginManifest, StylesResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { closeDatabase, getProject, insertProject, openDatabase } from '../../src/db.js';
import { upsertInstalledPlugin } from '../../src/plugins/registry.js';
import { ensureMarketplaceManifest } from '../../src/plugins/marketplaces.js';
import { registerStyleRoutes, type RegisterStyleRoutesDeps } from '../../src/routes/styles.js';
import { registerStoreRoutes } from '../../src/routes/store.js';
import { storeCatalog, storeItemDetail } from '../../src/store/catalog.js';
import { getArtStyle, getProjectArtStyle, resolveArtStyleForGeneration, resolveArtStylePreview } from '../../src/styles/service.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

let root: string;
let db: ReturnType<typeof openDatabase>;
let server: Server;
let base: string;
let allowOrigin = true;
let authorized = true;
let styleFolder: string;
const manifest: PluginManifest = {
  name: 'openpixo/pixel-test', version: '1.0.0', title: 'Pixel test', title_i18n: { 'zh-CN': '像素测试' },
  description: 'Crisp pixels.', description_i18n: { 'zh-CN': '清晰的像素。' }, license: 'Apache-2.0',
  examples: [{ title: 'Knight', title_i18n: { 'zh-CN': '骑士' }, prompt: 'Make a knight.', prompt_i18n: { 'zh-CN': '生成一位骑士。' } }],
  pixo: { kind: 'style', style: { id: 'pixel-test', dimension: ['2d'], medium: ['pixel'],
    prompt: 'Crisp pixel art.', negativePrompt: 'Blur.', palette: ['#111111', '#eeeeee'], previews: ['preview.webp'],
    constraints: { pixelSize: 32, background: 'transparent', recommendedResolution: '1024x1024' } } },
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-styles-'));
  styleFolder = path.join(root, 'styles', 'pixel-test');
  await mkdir(styleFolder, { recursive: true });
  await writeFile(path.join(styleFolder, 'preview.webp'), 'fixture');
  db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'game', name: 'Game', metadata: { kind: 'prototype', imageModel: 'kept' }, createdAt: 1, updatedAt: 1 });
  upsertInstalledPlugin(db, { id: manifest.name, title: manifest.title!, version: manifest.version,
    sourceKind: 'bundled', source: styleFolder, trust: 'bundled', capabilitiesGranted: [], manifest,
    fsPath: styleFolder, installedAt: 1, updatedAt: 1 });
  const seeded = ensureMarketplaceManifest(db, { id: 'styles', url: 'bundled:openpixo-official', trust: 'official',
    manifestText: JSON.stringify({ name: 'styles', version: '1.0.0', plugins: [{ name: manifest.name, title: manifest.title,
      description: manifest.description, version: manifest.version, kind: 'style', source: styleFolder, license: 'Apache-2.0' }] }) });
  if (!seeded.ok) throw new Error(seeded.message);
  allowOrigin = true; authorized = true;
  const app = express(); app.use(express.json());
  const deps: RegisterStyleRoutesDeps = { db, paths: { PROJECT_ROOT: root, PROJECTS_DIR: path.join(root, 'projects') } as RegisterStyleRoutesDeps['paths'],
    http: { requireLocalDaemonRequest: (_req, _res, next) => next(), isLocalSameOrigin: () => allowOrigin, resolvedPortRef: { current: 0 } } as RegisterStyleRoutesDeps['http'],
    authorizeProjectRequest: async (_req, res) => { if (!authorized) res.status(403).json({ error: { code: 'FORBIDDEN' } }); return authorized; },
    authorizeProjectToolRequest: async (_res, projectId) => authorized ? { projectId } : null };
  registerStyleRoutes(app, deps);
  registerStoreRoutes(app, deps);
  server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  toolTokenRegistry.clear();
  closeDatabase(); await rm(root, { recursive: true, force: true });
});
const request = (url: string, styleId?: unknown) => fetch(`${base}${url}`, styleId === undefined ? {} : {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ styleId }),
});

it('lists styles and Store examples localized and serves manifest-listed previews', async () => {
  const response = await fetch(`${base}/api/styles`, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  expect(await response.json()).toMatchObject({ styles: [{ id: 'pixel-test', title: '像素测试', description: '清晰的像素。',
    examples: [{ title: '骑士', prompt: '生成一位骑士。' }], previews: ['/api/styles/pixel-test/previews/0'] }] });
  expect(storeCatalog(db, { kind: 'style' }, 'zh-CN')[0]).toMatchObject({ kind: 'style', pricing: { type: 'free' },
    title: '像素测试', examples: [{ title: '骑士' }], style: { id: 'pixel-test', palette: ['#111111', '#eeeeee'] } });
  expect(storeItemDetail(db, manifest.name)?.previews).toEqual(['/api/styles/pixel-test/previews/0']);
  expect((await fetch(`${base}/api/styles/pixel-test/previews/0`)).status).toBe(200);
  expect((await fetch(`${base}/api/styles/pixel-test/previews/1`)).status).toBe(404);
});

it('gets, sets and clears project defaults while preserving other metadata', async () => {
  expect(await (await request('/api/projects/game/art-style')).json()).toEqual({ styleId: null, style: null, referenceImage: null });
  expect(await (await request('/api/projects/game/art-style', 'pixel-test')).json()).toMatchObject({ styleId: 'pixel-test', style: { id: 'pixel-test' } });
  expect(getProject(db, 'game')?.metadata).toMatchObject({ imageModel: 'kept', artStyleId: 'pixel-test' });
  expect((await request('/api/projects/game/art-style', 'missing')).status).toBe(404);
  expect(getProjectArtStyle(db, root, 'game').styleId).toBe('pixel-test');
  expect(await (await request('/api/projects/game/art-style', null)).json()).toEqual({ styleId: null, style: null, referenceImage: null });
  expect((await request('/api/projects/missing/art-style')).status).toBe(404);
});

it('resolves retired monochrome styles for saved defaults, generation and preview URLs', async () => {
  const replacement: PluginManifest = { ...manifest, name: 'openpixo/pixel-8-bit',
    pixo: { ...manifest.pixo, style: { ...manifest.pixo!.style!, id: 'pixel-8-bit' } } };
  upsertInstalledPlugin(db, { id: replacement.name, title: replacement.title!, version: replacement.version,
    sourceKind: 'bundled', source: styleFolder, trust: 'bundled', capabilitiesGranted: [], manifest: replacement,
    fsPath: styleFolder, installedAt: 1, updatedAt: 1 });

  expect(getArtStyle(db, 'monochrome-1-bit')?.id).toBe('pixel-8-bit');
  expect(await (await fetch(`${base}/api/styles/monochrome-1-bit`)).json()).toMatchObject({ style: { id: 'pixel-8-bit' } });
  expect((await request('/api/projects/game/art-style', 'monochrome-1-bit')).status).toBe(200);
  expect(getProjectArtStyle(db, root, 'game').style?.id).toBe('pixel-8-bit');
  expect((await resolveArtStyleForGeneration(db, root, 'game'))?.id).toBe('pixel-8-bit');
  expect((await resolveArtStyleForGeneration(db, root, undefined, 'monochrome-1-bit'))?.id).toBe('pixel-8-bit');
  expect(await resolveArtStylePreview(db, 'monochrome-1-bit', 0)).toBe(await resolveArtStylePreview(db, 'pixel-8-bit', 0));
  expect((await fetch(`${base}/api/styles/monochrome-1-bit/previews/0`)).status).toBe(200);
  const listed = await (await fetch(`${base}/api/styles`)).json() as StylesResponse;
  expect(listed.styles.map(style => style.id).sort()).toEqual(['pixel-8-bit', 'pixel-test']);
});

it('rejects malformed ids, cross-origin changes, denied project access and preview traversal', async () => {
  expect((await request('/api/projects/game/art-style', 42)).status).toBe(400);
  allowOrigin = false;
  expect((await request('/api/projects/game/art-style', 'pixel-test')).status).toBe(403);
  allowOrigin = true; authorized = false;
  expect((await request('/api/projects/game/art-style')).status).toBe(403);
  const record = db.prepare('SELECT manifest_json FROM installed_plugins WHERE id = ?').get(manifest.name) as { manifest_json: string };
  const unsafe = JSON.parse(record.manifest_json) as PluginManifest;
  unsafe.pixo!.style!.previews = ['../../outside.webp', 'C:/outside.webp', 'preview.svg'];
  db.prepare('UPDATE installed_plugins SET manifest_json = ? WHERE id = ?').run(JSON.stringify(unsafe), manifest.name);
  expect(await resolveArtStylePreview(db, 'pixel-test', 0)).toBeNull();
  expect(await resolveArtStylePreview(db, 'pixel-test', 1)).toBeNull();
  expect(await resolveArtStylePreview(db, 'pixel-test', 2)).toBeNull();
});

it('resolves explicit style, project default and explicit none without provider calls', async () => {
  await request('/api/projects/game/art-style', 'pixel-test');
  expect((await resolveArtStyleForGeneration(db, root, 'game'))?.id).toBe('pixel-test');
  expect((await resolveArtStyleForGeneration(db, root, undefined, 'pixel-test'))?.prompt).toBe('Crisp pixel art.');
  expect(await resolveArtStyleForGeneration(db, root, 'game', null)).toBeNull();
  await expect(resolveArtStyleForGeneration(db, root, 'game', 'missing')).rejects.toMatchObject({ code: 'STYLE_NOT_FOUND', status: 400 });
});

it('authorizes run-scoped style CLI calls and prevents project and operation overrides', async () => {
  const grant = toolTokenRegistry.mint({ runId: 'style-run', projectId: 'game' });
  const headers = { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' };
  expect((await fetch(`${base}/api/styles`, { headers })).status).toBe(200);
  expect((await fetch(`${base}/api/styles/pixel-test`, { headers })).status).toBe(200);
  expect((await fetch(`${base}/api/styles/pixel-test/previews/0`, { headers })).status).toBe(200);
  allowOrigin = false;
  expect((await fetch(`${base}/api/projects/game/art-style`, { headers, method: 'PUT', body: JSON.stringify({ styleId: 'pixel-test' }) })).status).toBe(200);
  expect((await fetch(`${base}/api/projects/game/art-style`, { headers })).status).toBe(200);
  expect((await fetch(`${base}/api/projects/other/art-style`, { headers })).status).toBe(403);
  expect((await fetch(`${base}/api/projects/other/art-style`, { headers, method: 'PUT', body: JSON.stringify({ styleId: null }) })).status).toBe(403);
  const readOnly = toolTokenRegistry.mint({ runId: 'style-read', projectId: 'game', allowedOperations: ['style:read'] });
  expect((await fetch(`${base}/api/projects/game/art-style`, { headers: { ...headers, Authorization: `Bearer ${readOnly.token}` }, method: 'PUT', body: JSON.stringify({ styleId: null }) })).status).toBe(403);
  expect((await fetch(`${base}/api/styles`, { headers: { Authorization: 'Bearer pixott_invalid' } })).status).toBe(403);
});

it('installs a bundled free style through Store and selects it for a project', async () => {
  const response = await fetch(`${base}/api/store/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: manifest.name, projectId: 'game' }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ name: manifest.name, pluginId: manifest.name, version: '1.0.0', projectId: 'game' });
  expect(getProjectArtStyle(db, root, 'game')).toMatchObject({ styleId: 'pixel-test', style: { id: 'pixel-test' } });
});

it('records a style reference only for an existing image inside the project', async () => {
  const put = (body: unknown) => fetch(`${base}/api/projects/game/style-reference`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const dir = path.join(root, 'projects', 'game', 'concept');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'style-2.png'), 'png');
  await writeFile(path.join(root, 'outside.png'), 'png');
  expect(await (await put({ path: 'concept\\style-2.png' })).json()).toMatchObject({ referenceImage: 'concept/style-2.png' });
  expect(getProject(db, 'game')?.metadata).toMatchObject({ imageModel: 'kept', styleReference: 'concept/style-2.png' });
  expect(await (await request('/api/projects/game/art-style')).json()).toMatchObject({ referenceImage: 'concept/style-2.png' });
  expect((await put({ path: '../../outside.png' })).status).toBe(400);
  expect((await put({ path: path.join(root, 'outside.png') })).status).toBe(400);
  expect((await put({ path: 'concept/missing.png' })).status).toBe(404);
  expect((await put({ path: 'concept/notes.txt' })).status).toBe(400);
  expect((await put({ styleId: 'x' })).status).toBe(400);
  expect(getProject(db, 'game')?.metadata?.styleReference).toBe('concept/style-2.png');
  allowOrigin = false;
  expect((await put({ path: null })).status).toBe(403);
  allowOrigin = true;
  expect(await (await put({ path: null })).json()).toMatchObject({ referenceImage: null });
});
