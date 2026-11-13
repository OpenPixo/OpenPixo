import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { ApiErrorResponse, MarketplacePluginEntry, StoreCatalogResponse, StoreItemDetail, StorePurchaseResponse } from '@openpixo/contracts';
import JSZip from 'jszip';
import { create as createTar } from 'tar';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, openDatabase } from '../../src/db.js';
import { ensureMarketplaceManifest, getMarketplace } from '../../src/plugins/marketplaces.js';
import { registerBundledPlugins } from '../../src/plugins/bundled.js';
import { getInstalledPlugin } from '../../src/plugins/registry.js';
import { registerStoreRoutes, type RegisterStoreRoutesDeps } from '../../src/routes/store.js';
import { resolveProjectExtensions } from '../../src/services/project-extensions.js';
import { AccountError } from '../../src/account/errors.js';
import type { StoreAccount } from '../../src/store/purchase.js';
import { builtInSkills } from '../../src/store/built-in-skills.js';
import type { SkillInfo } from '../../src/skills.js';

let root: string;
let db: ReturnType<typeof openDatabase>;
let server: Server;
let base: string;
let archive: Buffer;
let fetchArchive: ReturnType<typeof vi.fn>;
let deps: RegisterStoreRoutesDeps;
let allowOrigin: boolean;
let allowLocal: boolean;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-store-'));
  const fixture = path.join(root, 'fixture');
  await mkdir(fixture);
  await writeFile(path.join(fixture, 'pixo.json'), JSON.stringify({ name: 'free-skill', version: '1.0.0', title: 'Free skill', pixo: { kind: 'skill' } }));
  await writeFile(path.join(fixture, 'SKILL.md'), '---\nname: free-skill\ndescription: Fixture skill\n---\nUse this skill.\n');
  const file = path.join(root, 'fixture.tgz');
  await createTar({ file, cwd: root, gzip: true }, ['fixture']);
  archive = await readFile(file);
  db = openDatabase(root, { dataDir: root });
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('game', 'Game', 1, 1);
  const seeded = ensureMarketplaceManifest(db, { id: 'fixtures', url: 'https://registry.example/catalog.json', trust: 'restricted',
    manifestText: JSON.stringify({ name: 'fixtures', version: '1.0.0', plugins: [
      { name: 'openpixo/free', kind: 'skill', version: '1.0.0', source: 'https://registry.example/free.tgz', engines: ['godot'],
        license: 'MIT', pricing: { type: 'free' }, archive: { url: 'https://registry.example/free.tgz', integrity: `sha256:${createHash('sha256').update(archive).digest('hex')}`, size: archive.length } },
      { name: 'openpixo/paid', kind: 'recipe', version: '1.0.0', source: 'paid', license: 'MIT', pricing: { type: 'paid', credits: 300, sku: 'workshop.paid' } },
    ] }) });
  if (!seeded.ok) throw new Error(seeded.message);
  // Exercise the real installer and digest checker without making a network request.
  fetchArchive = vi.fn(async () => new Response(new Uint8Array(archive)));
  vi.stubGlobal('fetch', fetchArchive);
  const app = express();
  app.use(express.json());
  allowOrigin = true; allowLocal = true;
  deps = {
    db, paths: { RUNTIME_DATA_DIR: root, PLUGIN_REGISTRY_DIR: path.join(root, 'registry'), PROJECTS_DIR: path.join(root, 'projects'), USER_SKILLS_DIR: path.join(root, 'user-skills'), SKILLS_DIR: path.join(root, 'skills') } as RegisterStoreRoutesDeps['paths'],
    http: { requireLocalDaemonRequest: (_req, res, next) => allowLocal ? next() : res.sendStatus(403), isLocalSameOrigin: () => allowOrigin, resolvedPortRef: { current: 0 } } as RegisterStoreRoutesDeps['http'],
    authorizeProjectRequest: async () => true,
  };
  registerStoreRoutes(app, deps);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  closeDatabase();
  await rm(root, { recursive: true, force: true });
});

// Keep HTTP calls independent of the archive-fetch stub.
const httpFetch = globalThis.fetch;
const post = (body: unknown) => httpFetch(`${base}/api/store/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function replaceFreeEntry(change: Partial<MarketplacePluginEntry>) {
  const manifest = getMarketplace(db, 'fixtures')!.manifest;
  Object.assign(manifest.plugins[0]!, change);
  const result = ensureMarketplaceManifest(db, { id: 'fixtures', url: 'https://registry.example/catalog.json', trust: 'restricted', manifestText: JSON.stringify(manifest) });
  if (!result.ok) throw new Error(result.message);
}

it('filters catalog by kind and pricing and returns namespaced item details', async () => {
  const free = await httpFetch(`${base}/api/store/catalog?kind=skill&pricing=free&engine=godot&q=free`).then(res => res.json()) as StoreCatalogResponse;
  expect(free.items.map((item: { name: string }) => item.name)).toEqual(['openpixo/free']);
  const paid = await httpFetch(`${base}/api/store/catalog?pricing=paid`).then(res => res.json()) as StoreCatalogResponse;
  expect(paid.items.map((item: { name: string }) => item.name)).toEqual(['openpixo/paid']);
  const mismatch = await httpFetch(`${base}/api/store/catalog?kind=skill&pricing=paid`).then(res => res.json()) as StoreCatalogResponse;
  expect(mismatch.items).toEqual([]);
  const detail = await httpFetch(`${base}/api/store/items/openpixo%2Ffree`).then(res => res.json());
  expect(detail).toMatchObject({ name: 'openpixo/free', license: 'MIT', versions: ['1.0.0'] });
  expect(detail).not.toHaveProperty('archive');
});

it('uses bundled manifest translations when the Store snapshot omits them', async () => {
  const bundledRoot = path.join(root, 'bundled');
  const recipeDir = path.join(bundledRoot, 'recipes', 'localized');
  await mkdir(recipeDir, { recursive: true });
  await writeFile(path.join(recipeDir, 'pixo.json'), JSON.stringify({ name: 'openpixo/localized', version: '1.0.0',
    title: 'Looping background music', title_i18n: { en: 'Looping background music', 'zh-CN': '循环背景音乐' },
    description: 'A looping track.', description_i18n: { en: 'A looping track.', 'zh-CN': '适合游戏场景的循环音乐。' },
    pixo: { kind: 'recipe', recipe: { surface: 'code', category: 'feature', inputs: [] }, useCase: { query: 'Create music' } } }));
  await registerBundledPlugins({ db, bundledRoot });
  const seeded = ensureMarketplaceManifest(db, { id: 'official', url: 'bundled:openpixo-official', trust: 'official',
    manifestText: JSON.stringify({ name: 'offline', version: '1.0.0', plugins: [
      { name: 'openpixo/localized', title: 'Looping background music', description: 'A looping track.', kind: 'recipe',
        source: recipeDir, version: '1.0.0', license: 'MIT', title_i18n: { 'zh-CN': '目录中的标题' } },
    ] }) });
  if (!seeded.ok) throw new Error(seeded.message);
  const catalog = await httpFetch(`${base}/api/store/catalog?kind=recipe`).then(res => res.json()) as StoreCatalogResponse;
  expect(catalog.items.find(item => item.name === 'openpixo/localized')).toMatchObject({
    title_i18n: { en: 'Looping background music', 'zh-CN': '目录中的标题' },
    description_i18n: { en: 'A looping track.', 'zh-CN': '适合游戏场景的循环音乐。' },
  });
  const detail = await httpFetch(`${base}/api/store/items/openpixo%2Flocalized`).then(res => res.json());
  expect(detail).toMatchObject({ description_i18n: { en: 'A looping track.', 'zh-CN': '适合游戏场景的循环音乐。' } });
});

it('uses existing bundled skill frontmatter translations in Store metadata', async () => {
  const skill = path.join(root, 'localized-skill');
  await mkdir(skill);
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: localized-skill\nen_name: Game asset batch processing\nzh_name: 游戏素材批处理\ndescription: Process selected images.\nzh_description: 批量处理选定的图片。\n---\nUse this skill.\n');
  const seeded = ensureMarketplaceManifest(db, { id: 'official', url: 'bundled:openpixo-official', trust: 'official',
    manifestText: JSON.stringify({ name: 'offline', version: '1.0.0', plugins: [
      { name: 'openpixo/localized-skill', title: 'Game asset batch processing', description: 'Process selected images.',
        kind: 'skill', source: skill, version: '1.0.0', license: 'MIT' },
    ] }) });
  if (!seeded.ok) throw new Error(seeded.message);
  const catalog = await httpFetch(`${base}/api/store/catalog?kind=skill`).then(res => res.json()) as StoreCatalogResponse;
  expect(catalog.items.find(item => item.name === 'openpixo/localized-skill')).toMatchObject({
    title_i18n: { 'zh-CN': '游戏素材批处理' },
    description_i18n: { en: 'Process selected images.', 'zh-CN': '批量处理选定的图片。' },
  });
});

it('marks a bundled skill the agent already gets as built in, with its Settings switch state', async () => {
  const skill = path.join(root, 'phaser-skill');
  await mkdir(skill);
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: phaser-skill\ndescription: Phaser rules.\n---\nUse this skill.\n');
  const seeded = ensureMarketplaceManifest(db, { id: 'official', url: 'bundled:openpixo-official', trust: 'official',
    manifestText: JSON.stringify({ name: 'offline', version: '1.0.0', plugins: [
      { name: 'openpixo/phaser-skill', kind: 'skill', source: skill, version: '1.0.0', license: 'MIT', engines: ['phaser'] },
    ] }) });
  if (!seeded.ok) throw new Error(seeded.message);
  deps.builtInSkills = async () => builtInSkills([
    { id: 'phaser-skill', dir: skill, source: 'built-in', mode: 'utility' },
    { id: 'not-a-workflow', dir: path.join(root, 'other'), source: 'built-in', mode: 'image' },
  ] as unknown as SkillInfo[], ['phaser-skill']);
  const catalog = await httpFetch(`${base}/api/store/catalog?kind=skill`).then(res => res.json()) as StoreCatalogResponse;
  expect(catalog.items.find(item => item.name === 'openpixo/phaser-skill')?.builtIn).toEqual({ skillId: 'phaser-skill', enabled: false });
  // A store-only skill is still something to install.
  expect(catalog.items.find(item => item.name === 'openpixo/free')?.builtIn).toBeUndefined();
  const detail = await httpFetch(`${base}/api/store/items/${encodeURIComponent('openpixo/phaser-skill')}`).then(res => res.json()) as StoreItemDetail;
  expect(detail.builtIn).toEqual({ skillId: 'phaser-skill', enabled: false });
});

it('installs a free archive with integrity and enables its v2 reference in a project', async () => {
  const response = await post({ name: 'openpixo/free', version: '1.0.0', projectId: 'game' });
  expect(await response.json()).toMatchObject({ pluginId: 'free-skill', name: 'openpixo/free', version: '1.0.0', projectId: 'game' });
  expect(response.status).toBe(200);
  expect(getInstalledPlugin(db, 'free-skill')?.archiveIntegrity).toMatch(/^sha256:/);
  expect(JSON.parse(await readFile(path.join(root, 'project-extensions', 'game', 'manifest.json'), 'utf8'))).toEqual({
    version: 2, entries: [{ kind: 'skill', pluginId: 'free-skill', version: '1.0.0', enabled: true }],
  });
  expect((await resolveProjectExtensions({ dataDir: root, projectId: 'game', skillsRoots: [] })).skills).toHaveLength(1);
});

it('installs a free ZIP package using the catalog archive URL and checksum', async () => {
  const zip = new JSZip();
  zip.file('pixo.json', await readFile(path.join(root, 'fixture', 'pixo.json')));
  zip.file('SKILL.md', await readFile(path.join(root, 'fixture', 'SKILL.md')));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const integrity = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  replaceFreeEntry({ archive: { url: 'free.zip', integrity, size: bytes.length } });
  fetchArchive.mockImplementation(async () => new Response(new Uint8Array(bytes)));
  const response = await post({ name: 'openpixo/free' });
  expect(await response.json()).toMatchObject({ name: 'openpixo/free', version: '1.0.0' });
  expect(response.status).toBe(200);
  expect(fetchArchive.mock.calls[0]?.[0]).toBe('https://registry.example/free.zip');
  expect(getInstalledPlugin(db, 'free-skill')?.archiveIntegrity).toBe(integrity);
});

it('checks a pinned GitHub tarball instead of falling back to unchecked contents', async () => {
  await mkdir(path.join(root, 'repo'));
  await rename(path.join(root, 'fixture'), path.join(root, 'repo', 'plugin'));
  const file = path.join(root, 'github.tgz');
  await createTar({ file, cwd: root, gzip: true }, ['repo']);
  const bytes = await readFile(file);
  replaceFreeEntry({ source: 'github:fixture/repo@v1/plugin', archive: undefined, integrity: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
  fetchArchive.mockImplementation(async () => new Response(new Uint8Array(bytes)));
  const response = await post({ name: 'openpixo/free' });
  expect(await response.json()).toMatchObject({ name: 'openpixo/free', version: '1.0.0' });
  expect(response.status).toBe(200);
  expect(fetchArchive).toHaveBeenCalledTimes(1);
  expect(fetchArchive.mock.calls[0]?.[0]).toBe('https://codeload.github.com/fixture/repo/tar.gz/v1');
});

it('rejects corrupt free archives and paid installs before installation', async () => {
  fetchArchive.mockImplementation(async () => new Response(Buffer.from('corrupt archive')));
  const corrupt = await post({ name: 'openpixo/free' });
  expect(corrupt.status).toBe(422);
  expect((await corrupt.json() as ApiErrorResponse).error.message).toMatch(/integrity mismatch/i);
  expect(getInstalledPlugin(db, 'free-skill')).toBeNull();
  fetchArchive.mockClear();
  const paid = await post({ name: 'openpixo/paid' });
  expect(paid.status).toBe(422);
  expect(await paid.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: 'Only asset packs can be bought and installed.' } });
  expect(fetchArchive).not.toHaveBeenCalled();
});

it('reuses a recipe the app already ships as a bundled plugin instead of reinstalling it', async () => {
  const bundledRoot = path.join(root, 'bundled');
  // A real shipped recipe, so the bundled walker registers it exactly as the app does.
  await cp(fileURLToPath(new URL('../../../../plugins/_official/recipes/item-icon-set', import.meta.url)),
    path.join(bundledRoot, 'recipes', 'item-icon-set'), { recursive: true });
  await registerBundledPlugins({ db, bundledRoot });
  expect(getInstalledPlugin(db, 'openpixo/item-icon-set')?.sourceKind).toBe('bundled');
  const seeded = ensureMarketplaceManifest(db, { id: 'official', url: 'bundled:openpixo-official', trust: 'official',
    manifestText: JSON.stringify({ name: 'offline', version: '1.0.0', plugins: [
      { name: 'openpixo/item-icon-set', kind: 'recipe', source: path.join(bundledRoot, 'recipes', 'item-icon-set'), version: '0.1.0', license: 'MIT' },
    ] }) });
  if (!seeded.ok) throw new Error(seeded.message);
  const catalog = await httpFetch(`${base}/api/store/catalog?kind=recipe&pricing=free`).then(res => res.json()) as StoreCatalogResponse;
  expect(catalog.items.find(item => item.name === 'openpixo/item-icon-set')?.installedVersion).toBe('0.1.0');
  const response = await post({ name: 'openpixo/item-icon-set' });
  expect(await response.json()).toMatchObject({ name: 'openpixo/item-icon-set', pluginId: 'openpixo/item-icon-set', version: '0.1.0' });
  expect(response.status).toBe(200);
  expect(getInstalledPlugin(db, 'openpixo/item-icon-set')?.sourceKind).toBe('bundled');
});

it('installs bundled skills, templates and MCP presets offline through the installer', async () => {
  const template = path.join(root, 'template');
  const skill = path.join(root, 'skill');
  await mkdir(template); await mkdir(skill);
  await writeFile(path.join(template, 'template.json'), '{"id":"fixture"}');
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: fixture-skill\ndescription: Offline skill\n---\nUse this skill.\n');
  const seeded = ensureMarketplaceManifest(db, { id: 'official', url: 'bundled:openpixo-official', trust: 'restricted',
    manifestText: JSON.stringify({ name: 'offline', version: '1.0.0', plugins: [
      { name: 'openpixo/offline-skill', kind: 'skill', source: skill, version: '1.0.0', license: 'MIT' },
      { name: 'openpixo/offline-template', kind: 'project-template', source: template, version: '1.0.0', license: 'MIT' },
      { name: 'openpixo/offline-mcp', kind: 'mcp', source: 'github:Coding-Solo/godot-mcp', mcpTemplateId: 'godot-mcp', version: '1.0.0', license: 'MIT' },
    ] }) });
  if (!seeded.ok) throw new Error(seeded.message);
  for (const name of ['openpixo/offline-skill', 'openpixo/offline-template', 'openpixo/offline-mcp']) {
    const response = await post({ name, projectId: 'game' });
    expect(await response.json()).toMatchObject({ name, version: '1.0.0', projectId: 'game' });
    expect(response.status).toBe(200);
  }
  expect(fetchArchive).not.toHaveBeenCalled();
  const extensions = await resolveProjectExtensions({ dataDir: root, projectId: 'game', skillsRoots: [] });
  expect(extensions.skills.map(item => item.id)).toEqual(['fixture-skill']);
  expect(extensions.mcpServers.map(item => item.id)).toEqual(['godot-mcp']);
  await expect(readFile(path.join(template, 'pixo.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves bundled skill sidecar examples and the catalog version during offline installation', async () => {
  const folder = path.join(root, 'example-skill');
  await mkdir(folder);
  await writeFile(path.join(folder, 'SKILL.md'), '---\nname: example-skill\ndescription: Fixture skill\n---\nUse this skill.\n');
  const examples = [{ title: 'Character', title_i18n: { 'zh-CN': '\u89d2\u8272' }, prompt: 'Build a character.', prompt_i18n: { 'zh-CN': '\u5236\u4f5c\u4e00\u4e2a\u89d2\u8272\u3002' } }];
  await writeFile(path.join(folder, 'pixo.json'), JSON.stringify({ name: 'example-skill', version: '1.0.0',
    title: 'Examples skill', title_i18n: { 'zh-CN': '\u6280\u80fd\u793a\u4f8b' }, examples, pixo: { kind: 'skill' } }));
  const seeded = ensureMarketplaceManifest(db, { id: 'official', url: 'bundled:openpixo-official', trust: 'official',
    manifestText: JSON.stringify({ name: 'offline', version: '1.0.0', plugins: [{ name: 'openpixo/example-skill', kind: 'skill',
      title: 'Examples skill', source: folder, version: '1.0.0', license: 'Apache-2.0' }] }) });
  if (!seeded.ok) throw new Error(seeded.message);
  const catalog = await httpFetch(`${base}/api/store/catalog?kind=skill&locale=zh-CN`).then(res => res.json()) as StoreCatalogResponse;
  expect(catalog.items.find(item => item.name === 'openpixo/example-skill')).toMatchObject({ title: '\u6280\u80fd\u793a\u4f8b', examples: [{ title: '\u89d2\u8272', prompt: '\u5236\u4f5c\u4e00\u4e2a\u89d2\u8272\u3002' }] });
  const response = await post({ name: 'openpixo/example-skill' });
  expect(response.status).toBe(200);
  expect(getInstalledPlugin(db, 'example-skill')).toMatchObject({ version: '1.0.0', manifest: { examples, title_i18n: { 'zh-CN': '\u6280\u80fd\u793a\u4f8b' } } });
  expect(fetchArchive).not.toHaveBeenCalled();
});

const purchase = (body: unknown) => httpFetch(base + '/api/store/purchase', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function bundledArtworkFixtures({ cover = true, previews = [1, 2] }: { cover?: boolean; previews?: number[] } = {}) {
  const official = path.join(deps.paths.PLUGIN_REGISTRY_DIR, 'official');
  await mkdir(path.join(official, 'covers'), { recursive: true });
  await mkdir(path.join(official, 'previews', 'local-art'), { recursive: true });
  if (cover) await writeFile(path.join(official, 'covers', 'local-art.webp'), 'cover-fixture');
  for (const number of previews) await writeFile(path.join(official, 'previews', 'local-art', number + '.webp'), 'preview-' + number);
  const seeded = ensureMarketplaceManifest(db, { id: 'official', url: 'bundled:openpixo-official', trust: 'official',
    manifestText: JSON.stringify({ name: 'artwork-fixture', version: '1.0.0', plugins: [
      { name: 'openpixo/local-art', title: 'Local art', kind: 'asset-pack', version: '1.0.0',
        source: 'openpixo-cloud:local-art', engines: ['any'], license: 'LicenseRef-OpenPixo-Asset',
        assetLicense: { commercialUse: true, attributionRequired: false },
        pricing: { type: 'paid', credits: 600, sku: 'workshop.local-art' }, tags: ['pixel', 'dungeon'],
        icon: 'https://example.com/ignored-for-bundled.webp', previews: ['https://example.com/ignored.webp'] },
    ] }) });
  if (!seeded.ok) throw new Error(seeded.message);
}

it('serves a bundled cover and exposes its URL and tags without breaking namespaced details', async () => {
  await bundledArtworkFixtures();
  const catalog = await httpFetch(base + '/api/store/catalog?kind=asset-pack').then(res => res.json()) as StoreCatalogResponse;
  expect(catalog.items).toMatchObject([{ name: 'openpixo/local-art', tags: ['pixel', 'dungeon'],
    coverUrl: '/api/store/items/openpixo%2Flocal-art/cover' }]);
  const response = await httpFetch(base + catalog.items[0]!.coverUrl);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await response.text()).toBe('cover-fixture');
  const detail = await httpFetch(base + '/api/store/items/openpixo%2Flocal-art');
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({ name: 'openpixo/local-art', tags: ['pixel', 'dungeon'] });
  expect(fetchArchive).not.toHaveBeenCalled();
});

it('omits a bundled cover URL and returns 404 when its cover file is missing', async () => {
  await bundledArtworkFixtures({ cover: false });
  const catalog = await httpFetch(base + '/api/store/catalog?kind=asset-pack').then(res => res.json()) as StoreCatalogResponse;
  expect(catalog.items[0]).not.toHaveProperty('coverUrl');
  expect((await httpFetch(base + '/api/store/items/openpixo%2Flocal-art/cover')).status).toBe(404);
});

it.each(['openpixo/unknown', 'openpixo/..', '../local-art', 'openpixo/../../secret', 'openpixo\\..\\secret'])(
  'rejects unknown or unsafe cover names: %s', async name => {
    await bundledArtworkFixtures();
    expect((await httpFetch(base + '/api/store/items/' + encodeURIComponent(name) + '/cover')).status).toBe(404);
  },
);

it('rejects malformed URL encoding in artwork names', async () => {
  expect((await httpFetch(base + '/api/store/items/%E0%A4%A/cover')).status).toBe(400);
});

it('lists and serves bundled preview files using zero-based public indexes', async () => {
  await bundledArtworkFixtures();
  const detail = await httpFetch(base + '/api/store/items/openpixo%2Flocal-art').then(res => res.json()) as StoreItemDetail;
  expect(detail.previews).toEqual(['/api/store/items/openpixo%2Flocal-art/previews/0', '/api/store/items/openpixo%2Flocal-art/previews/1']);
  for (const [index, url] of detail.previews.entries()) {
    const response = await httpFetch(base + url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await response.text()).toBe('preview-' + (index + 1));
  }
  expect((await httpFetch(base + '/api/store/items/openpixo%2Flocal-art/previews/2')).status).toBe(404);
  expect((await httpFetch(base + '/api/store/items/openpixo%2Funknown/previews/0')).status).toBe(404);
});

it.each(['-1', 'abc', '1.5', '01', '00', '1e0', '9007199254740992', '../0', '1\n', '+1', ' 1'])(
  'rejects invalid preview index %s', async index => {
    await bundledArtworkFixtures();
    expect((await httpFetch(base + '/api/store/items/openpixo%2Flocal-art/previews/' + encodeURIComponent(index))).status).toBe(404);
  },
);

it('stops listing and serving previews at the first missing number', async () => {
  await bundledArtworkFixtures({ previews: [1, 3] });
  const detail = await httpFetch(base + '/api/store/items/openpixo%2Flocal-art').then(res => res.json()) as StoreItemDetail;
  expect(detail.previews).toEqual(['/api/store/items/openpixo%2Flocal-art/previews/0']);
  expect((await httpFetch(base + '/api/store/items/openpixo%2Flocal-art/previews/2')).status).toBe(404);
});

it('uses HTTPS artwork from remote marketplaces and preserves HTTPS preview resolution', async () => {
  replaceFreeEntry({ icon: 'https://cdn.example/cover.webp', tags: ['tools', 'game'],
    previews: ['https://cdn.example/1.webp', '2.webp', 'http://cdn.example/insecure.webp', 'file:///secret.webp'] });
  const detail = await httpFetch(base + '/api/store/items/openpixo%2Ffree').then(res => res.json()) as StoreItemDetail;
  expect(detail).toMatchObject({ coverUrl: 'https://cdn.example/cover.webp', tags: ['tools', 'game'],
    previews: ['https://cdn.example/1.webp', 'https://registry.example/2.webp'] });
  expect((await httpFetch(base + '/api/store/items/openpixo%2Ffree/cover')).status).toBe(404);
});

it.each(['http://cdn.example/cover.webp', 'file:///secret.webp', '/relative.webp', 'javascript:alert(1)', 'invalid'])(
  'omits a remote icon without an HTTPS URL: %s', async icon => {
    replaceFreeEntry({ icon });
    const detail = await httpFetch(base + '/api/store/items/openpixo%2Ffree').then(res => res.json());
    expect(detail).not.toHaveProperty('coverUrl');
  },
);

it('never lets an agent token spend credits on a store item', async () => {
  const response = await httpFetch(base + '/api/store/purchase', {
    method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer pixott_agent' },
    body: JSON.stringify({ name: 'openpixo/paid' }),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
});

it.each([{}, { name: '' }, { name: '   ' }, { name: 1 }, { name: 'openpixo/paid', version: 1 }, { name: 'openpixo/paid', version: null }])(
  'rejects an invalid purchase body: %j', async body => {
    const response = await purchase(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  },
);

it('rejects a missing purchase body', async () => {
  const response = await httpFetch(base + '/api/store/purchase', { method: 'POST' });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
});

it('returns NOT_FOUND for an unknown purchase and directs free items to install', async () => {
  const unknown = await purchase({ name: 'openpixo/unknown' });
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  for (const pricing of [{ type: 'free' } as const, undefined]) {
    replaceFreeEntry({ pricing });
    const free = await purchase({ name: 'openpixo/free' });
    expect(free.status).toBe(400);
    expect(await free.json()).toEqual({ error: { code: 'BAD_REQUEST', message: 'item is free; install it instead' } });
  }
});

it('returns the purchase-unavailable error without fetching or debiting', async () => {
  const response = await purchase({ name: 'openpixo/paid', version: '1.0.0' });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: 'STORE_PURCHASE_UNAVAILABLE',
    message: 'Buying Workshop items with credits opens soon.' } });
  expect(fetchArchive).not.toHaveBeenCalled();
  expect(getInstalledPlugin(db, 'openpixo/paid')).toBeNull();
});

const OWNED_AT = '2026-11-02T00:00:00.000Z';
function fakeAccount(owned: string[] = []) {
  return {
    storePurchase: vi.fn<StoreAccount['storePurchase']>(async sku => ({ entitlementId: 'test-entitlement', itemName: 'openpixo/paid',
      sku, creditsSpent: 300, balance: 700, createdAt: OWNED_AT })),
    entitlements: vi.fn<StoreAccount['entitlements']>(async () => owned.map(itemName => ({ id: `e-${itemName}`, itemName,
      sku: 'workshop.paid', creditsSpent: 300, createdAt: OWNED_AT }))),
    storeDownload: vi.fn<StoreAccount['storeDownload']>(async (itemName, version) => ({ itemName, version,
      baseUrl: `https://play.example/__pack/${itemName.split('/')[1]}/${version}`, token: 'pack-token', expiresAt: OWNED_AT })),
  };
}

it('sends only the catalogue SKU to the cloud account and returns its purchase', async () => {
  const account = fakeAccount();
  deps.account = account;
  const response = await purchase({ name: ' OPENPIXO/PAID ', version: '1.0.0', amount: 1, sku: 'workshop.client-choice' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ name: 'openpixo/paid', version: '1.0.0', creditsSpent: 300, balance: 700,
    entitlementId: 'test-entitlement' } satisfies StorePurchaseResponse);
  expect(account.storePurchase).toHaveBeenCalledExactlyOnceWith('workshop.paid');
  expect(fetchArchive).not.toHaveBeenCalled();
});

it('refuses a cloud purchase that resolves to a different item', async () => {
  const account = fakeAccount();
  account.storePurchase.mockResolvedValueOnce({ entitlementId: 'e', itemName: 'openpixo/other', sku: 'workshop.paid',
    creditsSpent: 300, balance: 700, createdAt: OWNED_AT });
  deps.account = account;
  const response = await purchase({ name: 'openpixo/paid' });
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
});

it.each([
  ['INSUFFICIENT_CREDITS', 402, 'INSUFFICIENT_CREDITS'],
  ['ACCOUNT_SIGNED_OUT', 401, 'UNAUTHORIZED'],
  ['STORE_PURCHASE_UNAVAILABLE', 503, 'STORE_PURCHASE_UNAVAILABLE'],
  ['ACCOUNT_NOT_CONFIGURED', 503, 'STORE_PURCHASE_UNAVAILABLE'],
  ['BILLING_SKU_UNKNOWN', 404, 'NOT_FOUND'],
  ['CLOUD_UNAVAILABLE', 503, 'UPSTREAM_UNAVAILABLE'],
] as const)('maps the cloud %s error to %i %s', async (cloudCode, status, code) => {
  const account = fakeAccount();
  account.storePurchase.mockRejectedValueOnce(new AccountError(cloudCode));
  deps.account = account;
  const response = await purchase({ name: 'openpixo/paid' });
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code, message: new AccountError(cloudCode).message } });
});

it('marks owned paid items in the catalogue and item detail', async () => {
  deps.account = fakeAccount(['OpenPixo/Paid']);
  const catalog = await httpFetch(`${base}/api/store/catalog`).then(res => res.json()) as StoreCatalogResponse;
  expect(catalog.items.find(item => item.name === 'openpixo/paid')).toMatchObject({ owned: true });
  expect(catalog.items.find(item => item.name === 'openpixo/free')).not.toHaveProperty('owned');
  const detail = await httpFetch(`${base}/api/store/items/openpixo%2Fpaid`).then(res => res.json()) as StoreItemDetail;
  expect(detail.owned).toBe(true);
  deps.account = fakeAccount();
  const notOwned = await httpFetch(`${base}/api/store/catalog?pricing=paid`).then(res => res.json()) as StoreCatalogResponse;
  expect(notOwned.items[0]).toMatchObject({ owned: false });
});

it('leaves ownership unknown when the account cannot answer', async () => {
  const account = fakeAccount();
  account.entitlements.mockRejectedValue(new AccountError('ACCOUNT_SIGNED_OUT'));
  deps.account = account;
  const catalog = await httpFetch(`${base}/api/store/catalog`).then(res => res.json()) as StoreCatalogResponse;
  expect(catalog.items).toHaveLength(2);
  expect(catalog.items.some(item => 'owned' in item)).toBe(false);
});

/** A pack the fake Worker serves: its manifest plus each file, all checked by size and SHA-256. */
function servePack(files: Record<string, string>, tamper?: string) {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const manifest = { schema: 1, name: 'openpixo/local-art', version: '1.0.0', title: 'Local art', license: 'LicenseRef-OpenPixo-Asset',
    commercialUse: true, attributionRequired: false, animations: [],
    files: Object.entries(files).map(([file, text]) => ({ path: file, size: Buffer.byteLength(text), sha256: sha(text),
      kind: 'icon', title: `Title of ${file}`, use: 'Inventory icon.' })) };
  const requests: Array<{ url: string; auth: string | null }> = [];
  fetchArchive.mockImplementation(async (url: string, init?: { headers?: Record<string, string> }) => {
    requests.push({ url, auth: init?.headers?.authorization ?? null });
    const file = decodeURIComponent(url.replace('https://play.example/__pack/local-art/1.0.0/', ''));
    if (file === 'pack.json') return new Response(JSON.stringify(manifest));
    if (!(file in files)) return new Response('missing', { status: 404 });
    return new Response(file === tamper ? `${files[file]}!` : files[file]);
  });
  return requests;
}

it('downloads an owned asset pack into the game, with what every file is for', async () => {
  await bundledArtworkFixtures();
  const account = fakeAccount(['openpixo/local-art']);
  deps.account = account;
  const requests = servePack({ 'PACK.md': '# Local art', 'pieces/icons/01-sword.png': 'sword-bytes' });
  const response = await post({ name: 'openpixo/local-art', projectId: 'game' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ name: 'openpixo/local-art', pluginId: 'openpixo/local-art', version: '1.0.0',
    projectId: 'game', folder: 'assets/packs/local-art', files: 3, warnings: [] });
  expect(account.storeDownload).toHaveBeenCalledExactlyOnceWith('openpixo/local-art', '1.0.0');
  expect(requests.length).toBe(3);
  expect(requests.every(request => request.auth === 'Bearer pack-token')).toBe(true);
  const folder = path.join(root, 'projects', 'game', 'assets', 'packs', 'local-art');
  expect(await readFile(path.join(folder, 'pieces', 'icons', '01-sword.png'), 'utf8')).toBe('sword-bytes');
  expect(await readFile(path.join(folder, 'PACK.md'), 'utf8')).toBe('# Local art');
  expect(JSON.parse(await readFile(path.join(folder, 'pack.json'), 'utf8')).files[1]).toMatchObject({ title: 'Title of pieces/icons/01-sword.png' });
});

it('leaves the installed copy as it was when a downloaded file does not match the pack', async () => {
  await bundledArtworkFixtures();
  deps.account = fakeAccount(['openpixo/local-art']);
  servePack({ 'PACK.md': 'first' });
  expect((await post({ name: 'openpixo/local-art', projectId: 'game' })).status).toBe(200);
  servePack({ 'PACK.md': 'second', 'pieces/a.png': 'a' }, 'pieces/a.png');
  const response = await post({ name: 'openpixo/local-art', projectId: 'game' });
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE', message: expect.stringContaining('pieces/a.png') } });
  const packs = path.join(root, 'projects', 'game', 'assets', 'packs');
  expect(await readFile(path.join(packs, 'local-art', 'PACK.md'), 'utf8')).toBe('first');
  expect(await readdir(packs)).toEqual(['local-art']);
});

it('replaces an older copy of the pack in one step', async () => {
  await bundledArtworkFixtures();
  deps.account = fakeAccount(['openpixo/local-art']);
  servePack({ 'PACK.md': 'first', 'pieces/old.png': 'old' });
  expect((await post({ name: 'openpixo/local-art', projectId: 'game' })).status).toBe(200);
  servePack({ 'PACK.md': 'second' });
  expect((await post({ name: 'openpixo/local-art', projectId: 'game' })).status).toBe(200);
  const folder = path.join(root, 'projects', 'game', 'assets', 'packs', 'local-art');
  expect(await readFile(path.join(folder, 'PACK.md'), 'utf8')).toBe('second');
  expect((await readdir(folder)).sort()).toEqual(['PACK.md', 'pack.json']);
});

it('needs a game to add a pack to, and an owned pack', async () => {
  await bundledArtworkFixtures();
  const account = fakeAccount();
  account.storeDownload.mockRejectedValueOnce(new AccountError('STORE_ITEM_NOT_OWNED'));
  deps.account = account;
  const noProject = await post({ name: 'openpixo/local-art' });
  expect(noProject.status).toBe(400);
  const notOwned = await post({ name: 'openpixo/local-art', projectId: 'game' });
  expect(notOwned.status).toBe(402);
  expect(await notOwned.json()).toMatchObject({ error: { code: 'STORE_PURCHASE_REQUIRED' } });
  expect(fetchArchive).not.toHaveBeenCalled();
});

it('refuses to install a paid item that is not an asset pack', async () => {
  deps.account = fakeAccount(['openpixo/paid']);
  const response = await post({ name: 'openpixo/paid', projectId: 'game' });
  expect(response.status).toBe(422);
  expect(fetchArchive).not.toHaveBeenCalled();
});

it('requires a local request for artwork and purchase, plus a same-origin purchase', async () => {
  await bundledArtworkFixtures();
  allowLocal = false;
  expect((await httpFetch(base + '/api/store/items/openpixo%2Flocal-art/cover')).status).toBe(403);
  expect((await httpFetch(base + '/api/store/items/openpixo%2Flocal-art/previews/0')).status).toBe(403);
  expect((await purchase({ name: 'openpixo/paid' })).status).toBe(403);
  allowLocal = true; allowOrigin = false;
  const response = await purchase({ name: 'openpixo/paid' });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'local origin required' } });
});

it('refuses artwork directories redirected outside the bundled registry', async () => {
  await bundledArtworkFixtures();
  const outside = path.join(root, 'outside-artwork');
  await mkdir(outside);
  await writeFile(path.join(outside, 'local-art.webp'), 'private-cover');
  await writeFile(path.join(outside, '1.webp'), 'private-preview');
  const official = path.join(deps.paths.PLUGIN_REGISTRY_DIR, 'official');
  for (const directory of [path.join(official, 'covers'), path.join(official, 'previews', 'local-art')]) {
    await rm(directory, { recursive: true });
    await symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  }
  expect((await httpFetch(base + '/api/store/items/openpixo%2Flocal-art/cover')).status).toBe(404);
  expect((await httpFetch(base + '/api/store/items/openpixo%2Flocal-art/previews/0')).status).toBe(404);
  const detail = await httpFetch(base + '/api/store/items/openpixo%2Flocal-art').then(res => res.json()) as StoreItemDetail;
  expect(detail).not.toHaveProperty('coverUrl');
  expect(detail.previews).toEqual([]);
});
