import Database from 'better-sqlite3';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { EngineProfile, ProjectMetadata } from '@openpixo/contracts';
import { ProjectAssetIndexer } from '../src/assets/indexer.js';
import { assetRelPath, hashAssetFile, resolveAssetFile } from '../src/assets/paths.js';
import { listAssetProvenance, recordAssetProvenance } from '../src/assets/provenance-store.js';
import { subscribe } from '../src/project-watchers.js';
import { insertMediaTask, migrateMediaTasks, updateMediaTask } from '../src/media/tasks.js';

async function fixture(engine: 'unity' | 'godot' | 'unreal') {
  const dir = await mkdtemp(path.join(tmpdir(), 'asset-indexer-'));
  const root = path.join(dir, 'external-game');
  const projectsRoot = path.join(dir, 'managed-projects');
  const profile: EngineProfile = { engine, detectorVersion: 1, detectedAt: 0, confidence: 'certain', evidence: [],
    languages: [], assetRoots: ['assets/'], importMetadata: engine === 'unity' ? 'unity-meta' : engine === 'godot' ? 'godot-import' : 'none', commands: {}, tools: [] };
  const metadata: ProjectMetadata = { kind: 'other', baseDir: root, engineProfile: profile };
  const put = async (rel: string, data: string | Buffer) => {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, data);
  };
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } }).png().toBuffer();
  await put('assets/hero.png', png);
  await put('assets/copy.png', png);
  await put('assets/model.glb', 'model');
  await put('assets/font.ttf', 'font');
  await put('assets/atlas.json', JSON.stringify({ frames: { idle: { frame: { x: 0, y: 0, w: 16, h: 16 } } }, meta: { image: 'hero.png' } }));
  const pair = engine === 'unity' ? 'assets/hero.png.meta' : 'assets/hero.png.import';
  if (engine !== 'unreal') await put(pair, engine === 'unity' ? 'guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nTextureImporter:\n  spriteMode: 2\n  spriteSheet:\n' : 'uid="uid://hero"\nimporter="texture"');
  const ignores = engine === 'unity' ? ['Library', 'Temp', 'Logs', 'obj'] : engine === 'godot' ? ['.godot'] : ['Intermediate', 'Saved', 'DerivedDataCache'];
  for (const name of [...ignores, 'node_modules']) await put(`${name}/hidden.png`, png);
  const db = new Database(':memory:');
  const indexer = new ProjectAssetIndexer({ db, projectsRoot });
  const cleanup = async () => { await indexer.close(); db.close(); await rm(dir, { recursive: true, force: true }); };
  return { dir, root, db, indexer, metadata, projectsRoot, put, png, pair, ignores, cleanup };
}

describe('project asset index', () => {
  it('treats a project folder that does not exist yet as empty, then finds files once it does', async () => {
    const f = await fixture('godot');
    const metadata: ProjectMetadata = { kind: 'other' };
    try {
      expect(await f.indexer.mediaAssetCount('new-game', metadata)).toBe(0);
      expect((await f.indexer.list('new-game', {}, metadata)).assets).toEqual([]);
      const folder = path.join(f.projectsRoot, 'new-game');
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'hero.png'), f.png);
      expect(await f.indexer.mediaAssetCount('new-game', metadata)).toBe(1);
    } finally { await f.cleanup(); }
  });
  it('counts existing and generated media before the Assets list is opened using the same inventory', async () => {
    const f = await fixture('godot');
    try {
      expect(await f.indexer.mediaAssetCount('game', f.metadata)).toBe(4);
      await f.indexer.watchingReady('game');
      await f.put('assets/generated.png', f.png);
      await f.indexer.applyEvent('game', { type: 'file-changed', kind: 'add', path: 'assets/generated.png' });
      expect(await f.indexer.mediaAssetCount('game', f.metadata)).toBe(5);
      expect((await f.indexer.list('game', {}, f.metadata)).assets).toHaveLength(5);
    } finally { await f.cleanup(); }
  });
  it.each(['unity', 'godot', 'unreal'] as const)('scans %s using stats first, excluding only its engine caches', async engine => {
    const f = await fixture(engine);
    try {
      const first = await f.indexer.list('game', { kind: 'all', limit: 100 }, f.metadata);
      expect(first.assets).toHaveLength(engine === 'unreal' ? 5 : 6);
      expect(first.assets.every(asset => asset.relPath.startsWith('assets/') && asset.contentHash === undefined && asset.width === undefined)).toBe(true);
      expect(first.assets.filter(asset => asset.kind === 'image')).toHaveLength(2); // Path identity, even for identical bytes.
      await f.indexer.flushBackground();
      const hero = await f.indexer.info('game', 'assets/hero.png', f.metadata);
      expect(hero).toMatchObject({ width: 16, height: 16, kind: 'image', semantics: expect.arrayContaining([expect.objectContaining({ type: 'atlas', source: 'assets/atlas.json' })]) });
      if (engine !== 'unreal') {
        expect(hero.engineMeta).toMatchObject(engine === 'unity' ? { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } : { uid: 'uid://hero', importer: 'texture' });
        expect((await f.indexer.info('game', 'assets/copy.png', f.metadata)).engineMeta?.pairMissing).toBe(true);
      }
      const page = await f.indexer.list('game', { limit: 2 }, f.metadata);
      expect(page.assets).toHaveLength(2); expect(page.nextCursor).toBeTypeOf('string');
      const next = await f.indexer.list('game', { cursor: page.nextCursor!, limit: 2 }, f.metadata);
      expect(next.assets[0]!.relPath > page.assets[1]!.relPath).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('defaults to media and unambiguous sprite/tilemap data while preserving explicit file filters', async () => {
    const f = await fixture('godot');
    const projectFiles = ['.gitignore', 'main.tscn', 'player.gd', 'project.godot', 'package.json', 'config.json', 'config.yaml', 'resource.tres', 'Editor.tsx'];
    const mediaFiles = ['assets/theme.ogg', 'assets/cutscene.webm', 'assets/sprites.atlas', 'assets/map.tmx', 'assets/world.ldtk'];
    try {
      await Promise.all([...projectFiles, ...mediaFiles].map(rel => f.put(rel, 'fixture')));
      const media = await f.indexer.list('game', {}, f.metadata);
      expect(media.assets.map(asset => asset.relPath)).toEqual([
        'assets/copy.png', 'assets/font.ttf', 'assets/hero.png', 'assets/model.glb', ...mediaFiles,
      ].sort());
      expect(media.assets.find(asset => asset.relPath === 'assets/world.ldtk')?.kind).toBe('data');
      const all = await f.indexer.list('game', { kind: 'all' }, f.metadata);
      expect(all.assets.map(asset => asset.relPath)).toEqual([
        'assets/atlas.json', 'assets/copy.png', 'assets/font.ttf', 'assets/hero.png', 'assets/hero.png.import',
        // `.gitignore` is on disk but hidden: the imported folder's file API cannot open it.
        'assets/model.glb', ...projectFiles.filter(rel => rel !== '.gitignore'), ...mediaFiles,
      ].sort());
      const data = await f.indexer.list('game', { kind: 'data' }, f.metadata);
      expect(data.assets.map(asset => asset.relPath)).toEqual([
        'Editor.tsx', 'assets/atlas.json', 'assets/hero.png.import', 'assets/map.tmx', 'assets/sprites.atlas',
        'assets/world.ldtk', 'config.json', 'config.yaml', 'main.tscn', 'package.json', 'resource.tres',
      ].sort());
    } finally { await f.cleanup(); }
  });

  it('uses watcher add/unlink events and relinks provenance by hash after a rename', async () => {
    const f = await fixture('godot');
    let observer: ReturnType<typeof subscribe> | undefined;
    try {
      await f.indexer.list('game', {}, f.metadata);
      const original = await f.indexer.info('game', 'assets/hero.png', f.metadata);
      recordAssetProvenance(f.db, { projectId: 'game', relPath: original.relPath, contentHash: original.contentHash!, origin: 'generated',
        runId: 'run-1', mediaTaskId: 'task-1', promptText: 'a hero', provider: 'test', model: 'fixture', referenceHashes: ['ref'] });
      const expected = new Set(['unlink:assets/hero.png', 'add:assets/renamed.png']);
      let notify!: () => void;
      const changed = new Promise<void>(resolve => { notify = resolve; });
      observer = subscribe(f.projectsRoot, 'game', event => {
        expected.delete(`${event.kind}:${event.path}`); if (!expected.size) notify();
      }, { metadata: f.metadata, awaitWriteFinish: false });
      await observer.ready;
      await rename(path.join(f.root, 'assets/hero.png'), path.join(f.root, 'assets/renamed.png'));
      await changed;
      await f.indexer.flushUpdates('game');
      const current = await f.indexer.info('game', 'assets/renamed.png', f.metadata);
      expect(current.origin).toBe('generated');
      expect(current.engineMeta?.pairMissing).toBe(true);
      expect(listAssetProvenance(f.db, 'game', { relPath: current.relPath })).toEqual([expect.objectContaining({ runId: 'run-1', relPath: 'assets/hero.png', modifiedSinceProvenance: false })]);
      expect((await f.indexer.list('game', {}, f.metadata)).assets.some(asset => asset.relPath === original.relPath)).toBe(false);
      expect((await f.indexer.list('game', { origin: 'generated' }, f.metadata)).assets.map(asset => asset.relPath)).toContain('assets/renamed.png');
    } finally { await observer?.unsubscribe(); await f.cleanup(); }
  });

  it('keeps user tags/grids across changes and marks historical provenance as modified', async () => {
    const f = await fixture('unity');
    try {
      const original = await f.indexer.info('game', 'assets/hero.png', f.metadata);
      recordAssetProvenance(f.db, { projectId: 'game', relPath: original.relPath, contentHash: original.contentHash!, origin: 'processed', parentHashes: ['parent'] });
      await f.indexer.tags('game', [original.relPath], ['hero', 'old'], [], f.metadata);
      await f.indexer.tags('game', [original.relPath], [], ['old'], f.metadata);
      await f.indexer.grid('game', original.relPath, { rows: 2, cols: 2 }, f.metadata);
      await f.put(original.relPath, await sharp({ create: { width: 32, height: 16, channels: 4, background: '#00ff00' } }).png().toBuffer());
      await f.indexer.applyEvent('game', { type: 'file-changed', kind: 'change', path: original.relPath });
      const current = await f.indexer.info('game', original.relPath, f.metadata);
      expect(current).toMatchObject({ width: 32, tags: ['hero'], modifiedSinceProvenance: true });
      expect(current.semantics).toContainEqual({ type: 'grid', source: original.relPath, grid: { rows: 2, cols: 2 } });
      expect((await f.indexer.list('game', { tag: 'hero', semantic: 'grid', query: 'hero.png' }, f.metadata)).assets.map(asset => asset.relPath)).toEqual([original.relPath]);
      await f.indexer.applyEvent('game', { type: 'file-changed', kind: 'unlink', path: original.relPath });
      expect(listAssetProvenance(f.db, 'game', { relPath: original.relPath })).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  it('rejects traversal, absolute paths and symlink escapes for imported folders', async () => {
    const f = await fixture('godot');
    try {
      for (const rel of ['../outside', 'a/../outside', '/absolute', 'C:\\outside', '\\\\server\\share', 'C:relative', './hero.png']) expect(() => assetRelPath(rel)).toThrow();
      const outside = path.join(f.dir, 'outside');
      await mkdir(outside); await writeFile(path.join(outside, 'secret.txt'), 'private');
      await symlink(outside, path.join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(resolveAssetFile(f.projectsRoot, 'game', 'escape/secret.txt', f.metadata)).rejects.toThrow(/escape|outside/i);
      const listed = await f.indexer.list('game', {}, f.metadata);
      expect(listed.assets.some(asset => asset.relPath.startsWith('escape/'))).toBe(false);
    } finally { await f.cleanup(); }
  });

  // Real run 2026-11-13: every staged `.pixo-skills/**` file in an imported game logged
  // "[assets] enrichment skipped … hidden path segments are not accessible" with a stack trace.
  it('leaves hidden paths of an imported folder out of the index, as the file API does', async () => {
    const f = await fixture('godot');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await f.put('.pixo-skills/level-design-abc/SKILL.md', '# skill');
      await f.put('.pixo-skills/level-design-abc/preview.png', f.png);
      await f.put('assets/.cache/thumb.png', f.png);
      const listed = await f.indexer.list('game', { kind: 'all', limit: 100 }, f.metadata);
      expect(listed.assets.filter(asset => asset.relPath.split('/').some(segment => segment.startsWith('.')))).toEqual([]);
      await f.indexer.applyEvent('game', { type: 'file-changed', kind: 'add', path: '.pixo-skills/level-design-abc/new.png' });
      await f.indexer.flushBackground();
      expect(warn.mock.calls.filter(call => String(call[0]).startsWith('[assets]'))).toEqual([]);
    } finally { warn.mockRestore(); await f.cleanup(); }
  });

  it('still indexes hidden folders of a managed project, whose file API allows them', async () => {
    const f = await fixture('godot');
    const metadata: ProjectMetadata = { kind: 'other' };
    try {
      const folder = path.join(f.projectsRoot, 'managed');
      await mkdir(path.join(folder, '.art'), { recursive: true });
      await writeFile(path.join(folder, '.art', 'hero.png'), f.png);
      expect((await f.indexer.list('managed', {}, metadata)).assets.map(asset => asset.relPath)).toEqual(['.art/hero.png']);
    } finally { await f.cleanup(); }
  });

  it('records exact generated bytes, reference hashes and run/task identity on media completion', async () => {
    const f = await fixture('godot');
    try {
      vi.stubEnv('OPENAI_API_KEY', 'fixture-key');
      vi.stubEnv('PIXO_MEDIA_CONFIG_DIR', f.dir);
      vi.stubEnv('PIXO_MEDIA_MODEL_ALIASES', '{}');
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: f.png.toString('base64') }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }));
      vi.stubGlobal('fetch', fetchMock);
      const { generateMedia } = await import('../src/media/index.js');
      const generated = await generateMedia({ projectRoot: f.dir, projectsRoot: f.projectsRoot, projectId: 'game', metadata: f.metadata,
        surface: 'image', model: 'gpt-image-2', prompt: 'a game hero', image: 'assets/hero.png', output: 'assets/generated.png' });
      f.db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects(id) VALUES ('game')");
      migrateMediaTasks(f.db);
      insertMediaTask(f.db, { id: 'task-generated', projectId: 'game', runId: 'run-generated' });
      updateMediaTask(f.db, 'task-generated', { status: 'done', file: generated });
      updateMediaTask(f.db, 'task-generated', { status: 'done' });
      expect(listAssetProvenance(f.db, 'game', { relPath: generated.name })).toEqual([expect.objectContaining({
        origin: 'generated', runId: 'run-generated', mediaTaskId: 'task-generated', provider: 'openai', model: 'gpt-image-2',
        promptText: 'a game hero', contentHash: await hashAssetFile(path.join(f.root, generated.name)),
        referenceHashes: [await hashAssetFile(path.join(f.root, 'assets/hero.png'))], params: expect.objectContaining({ surface: 'image' }),
      })]);
      expect(fetchMock).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await f.cleanup(); }
  });
});

it.skipIf(process.env.PIXO_ASSET_PERF !== '1')('lists 10,000 stat-only files within the 2s budget', async () => {
  const f = await fixture('godot');
  try {
    for (let base = 0; base < 10_000; base += 100) await Promise.all(Array.from({ length: 100 }, (_, i) => f.put(`bulk/${base + i}.txt`, 'x')));
    const start = performance.now();
    const page = await f.indexer.list('game', { kind: 'all', limit: 100 }, f.metadata);
    const elapsed = performance.now() - start;
    console.info(`10,000-file first list: ${elapsed.toFixed(0)} ms`);
    expect(page.assets).toHaveLength(100);
    expect(elapsed).toBeLessThan(2000);
  } finally { await f.cleanup(); }
});
