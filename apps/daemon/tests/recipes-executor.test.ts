import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecipeExecutor, RECIPE_RETENTION_MS } from '../src/recipes/executor.js';
import { createMediaTaskStore } from '../src/media/task-store.js';
import { migrateMediaTasks } from '../src/media/tasks.js';
import { generateMedia } from '../src/media/index.js';
import { IMAGE_MODELS, type MediaModel } from '../src/media/models.js';
import { runAssetOp } from '../src/assets/ops/index.js';
import { listAssetProvenance } from '../src/assets/provenance-store.js';
import { recipeDetail } from './fixtures/recipes.js';
import type { ArtStyle, RecipeRun } from '@openpixo/contracts';
import { discoverRecipes } from '../src/recipes/catalog.js';

let root: string, project: string, data: string, db: Database.Database;
const model: MediaModel = { id: 'recipe-test-stub', provider: 'stub', caps: ['t2i', 'i2i'], label: 'Test stub', hint: '' };
beforeEach(async () => {
  vi.stubEnv('PIXO_MEDIA_ALLOW_STUBS', '1');
  root = await mkdtemp(path.join(tmpdir(), 'recipe-executor-')); project = path.join(root, 'game'); data = path.join(root, 'data');
  await mkdir(project); await mkdir(data);
  db = new Database(':memory:'); db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p')"); migrateMediaTasks(db);
  IMAGE_MODELS.push(model);
});
afterEach(async () => {
  IMAGE_MODELS.splice(IMAGE_MODELS.indexOf(model), 1); db.close(); vi.unstubAllEnvs();
  if (!path.resolve(root).startsWith(path.join(tmpdir(), 'recipe-executor-'))) throw new Error('Unsafe cleanup target');
  await rm(root, { recursive: true, force: true });
});
it('stages stub candidates, postprocesses survivors, keeps failing checks, and adopts with suffixes and provenance across restart', async () => {
  const postprocess = vi.fn(runAssetOp);
  let calls = 0;
  // The media stub's raster fixture is not decodable by libvips; its SVG branch exercises the real stub dispatcher and image ops.
  const generate: typeof generateMedia = async args => { if (++calls === 1) throw new Error('One candidate failed'); return generateMedia({ ...args, output: 'primary.svg' }); };
  const deps = { runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db), postprocess, generate };
  const executor = new RecipeExecutor(deps);
  await sharp({ create: { width: 8, height: 8, channels: 4, background: 'red' } }).png().toFile(path.join(project, 'reference.png'));
  const started = await executor.start(recipeDetail(), 'p', project, { recipeId: 'test-sprite', inputs: { reference: 'reference.png' } }, model);
  const ready = await executor.wait('p', started.id);
  expect(ready.status, JSON.stringify(ready)).toBe('ready'); expect(ready.candidates.some(candidate => candidate.error === 'One candidate failed')).toBe(true);
  const candidate = ready.candidates.find(candidate => !candidate.error)!;
  expect(candidate.stagedFiles.every(file => file.ref.startsWith(data))).toBe(true);
  expect(candidate.checks).toContainEqual(expect.objectContaining({ check: 'dimensions', ok: false }));
  expect(postprocess.mock.calls.map(call => call[1].op)).toEqual(['resize', 'slice', 'pixelate']);
  expect(postprocess.mock.calls[0]?.[0].projectRoot).toContain(path.join('recipe-runs', started.id, candidate.id));
  expect(await readdir(project)).toEqual(['reference.png']);
  const staged = await executor.stagedFile('p', started.id, candidate.id, 0);
  expect(staged).toEqual({ file: await realpath(candidate.stagedFiles[0]!.ref), mime: candidate.stagedFiles[0]!.mime });
  await expect(executor.stagedFile('p', started.id, candidate.id, 99)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(executor.stagedFile('other', started.id, candidate.id, 0)).rejects.toThrow('Recipe run not found');
  const destination = path.join(project, 'assets/sprites/hero'); await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'hero.svg'), 'keep me');
  const restored = new RecipeExecutor(deps);
  const adopted = await restored.adopt('p', started.id, [candidate.id], { projectId: 'p', root: project });
  const paths = adopted.candidates[candidate.index]!.adoptedPaths!;
  expect(paths[0]).toBe('assets/sprites/hero/hero_1.svg');
  expect(await readFile(path.join(destination, 'hero.svg'), 'utf8')).toBe('keep me');
  expect(await readFile(path.join(project, paths[0]!))).toEqual(await readFile(candidate.stagedFiles[0]!.ref));
  const descriptor = JSON.parse(await readFile(path.join(project, paths.find(file => file.endsWith('.json'))!), 'utf8')) as { source: string; frames: Array<{ path: string }> };
  expect(paths).toContain(descriptor.source);
  expect(descriptor.frames).toHaveLength(4);
  for (const frame of descriptor.frames) expect(paths).toContain(frame.path);
  expect(listAssetProvenance(db, 'p', { relPath: paths[0]! })[0]).toMatchObject({ origin: 'generated', recipeRunId: started.id, provider: 'stub', model: model.id, promptText: 'pixel sprite', referenceHashes: [expect.stringMatching(/^[a-f0-9]{64}$/)] });
  await restored.adopt('p', started.id, [candidate.id], { projectId: 'p', root: project });
  expect(listAssetProvenance(db, 'p', { relPath: paths[0]! })).toHaveLength(1);
  const adoptedBytes = await readFile(path.join(project, paths[0]!));
  await mkdir(path.join(restored.root, '00000000-0000-4000-8000-000000000000'));
  await restored.cleanup(Date.now() + RECIPE_RETENTION_MS + 1000);
  await expect(restored.get('p', started.id)).rejects.toThrow('not found');
  expect(await readdir(restored.root)).toEqual([]);
  expect(await readFile(path.join(project, paths[0]!))).toEqual(adoptedBytes);
});
it('cancels during generation and rejects late candidates and production stub output', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const generating = new Promise<void>(resolve => { entered = resolve; });
  let signal: AbortSignal | undefined;
  const generate: typeof generateMedia = async args => { signal = args.signal; entered(); await gate; return generateMedia(args); };
  const executor = new RecipeExecutor({ runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db), generate });
  const started = await executor.start(recipeDetail(), 'p', project, { recipeId: 'test-sprite', inputs: {}, count: 1 }, model);
  await generating;
  expect((await executor.cancel('p', started.id)).status).toBe('cancelled');
  expect(signal?.aborted).toBe(true);
  release();
  const cancelled = await executor.wait('p', started.id);
  expect(cancelled.status).toBe('cancelled'); expect(cancelled.candidates[0]?.stagedFiles).toEqual([]);
  await expect(executor.adopt('p', started.id, [cancelled.candidates[0]!.id], { projectId: 'p', root: project })).rejects.toThrow('not ready');
  vi.stubEnv('NODE_ENV', 'production');
  await expect(executor.start(recipeDetail(), 'p', project, { recipeId: 'test-sprite', inputs: {} }, model)).rejects.toThrow('only allowed in tests');
});

it('sends the selected style and recipe negative prompt to the stubbed image provider deterministically', async () => {
  const style: ArtStyle = { id: 'ink-test', title: 'Ink test', description: 'Ink game art', dimension: ['2d'], medium: ['ink'],
    prompt: 'Bold carved ink shapes', negativePrompt: 'photography', palette: ['#101010', '#eeeeee'],
    constraints: { outline: 'heavy black contour', recommendedResolution: '1024x1024' }, previews: [], examples: [], license: 'Apache-2.0' };
  const generate = vi.fn<typeof generateMedia>(async args => generateMedia({ ...args, output: 'primary.svg' }));
  const executor = new RecipeExecutor({ runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db), generate });
  const detail = recipeDetail();
  detail.manifest.pixo!.recipe!.negative = 'letters';
  detail.manifest.pixo!.recipe!.postprocess = [];
  detail.manifest.pixo!.recipe!.checks = [];
  const started = await executor.start(detail, 'p', project, { recipeId: 'test-sprite', inputs: {}, count: 1 }, model, undefined, style);
  expect(started.styleId).toBe('ink-test');
  expect((await executor.wait('p', started.id)).status).toBe('ready');
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]![0]).toMatchObject({ resolution: '1024x1024',
    prompt: 'pixel sprite\n\nBold carved ink shapes\n\nPalette: #101010, #eeeeee.\nOutline: heavy black contour.\nRecommended output resolution: 1024x1024.\n\nAvoid: letters, photography' });
});

it('applies a pixel style to actual output pixels and preserves the declared pixel grid and palette', async () => {
  const style: ArtStyle = { id: 'pixel-test', title: 'Pixel', description: '', dimension: ['2d'], medium: ['pixel'],
    prompt: 'Pixel art', negativePrompt: '', palette: ['#000000', '#ffffff'], constraints: { pixelSize: 2 }, previews: [], examples: [], license: 'Apache-2.0' };
  const pixels = Buffer.from(Array.from({ length: 6 * 4 }, (_, i) => [i * 11, 255 - i * 9, i * 7, 255]).flat());
  const generate: typeof generateMedia = async args => {
    const meta = await generateMedia(args);
    await writeFile(path.join(args.projectsRoot, args.projectId, meta.name), await sharp(pixels, { raw: { width: 6, height: 4, channels: 4 } }).png().toBuffer());
    return meta;
  };
  const postprocess = vi.fn(runAssetOp);
  const executor = new RecipeExecutor({ runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db), generate, postprocess });
  const detail = recipeDetail();
  detail.manifest.pixo!.recipe!.postprocess = [{ op: 'resize', params: { width: 12, height: 8 } }];
  detail.manifest.pixo!.recipe!.checks = [];
  const started = await executor.start(detail, 'p', project, { recipeId: detail.id, inputs: {}, count: 1 }, model, undefined, style);
  const ready = await executor.wait('p', started.id);
  expect(ready.status, JSON.stringify(ready)).toBe('ready');
  expect(postprocess.mock.calls[0]![1].params).toMatchObject({ filter: 'nearest' });
  expect(postprocess.mock.calls.map(call => call[1].op)).toEqual(['resize', 'pixelate', 'palette']);
  const final = ready.candidates[0]!.stagedFiles.filter(file => file.ref.endsWith('.png')).at(-1)!;
  const { data: rgba, info } = await sharp(final.ref).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([12, 8]);
  const colors = new Set<string>();
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * 4;
    const color = [...rgba.subarray(offset, offset + 3)].join(',');
    colors.add(color);
    const anchor = ((y - y % 2) * info.width + x - x % 2) * 4;
    expect(rgba.subarray(offset, offset + 4)).toEqual(rgba.subarray(anchor, anchor + 4));
  }
  expect([...colors].every(color => ['0,0,0', '255,255,255'].includes(color))).toBe(true);
});

it.each(['godot', 'phaser', 'aseprite'] as const)('adopts %s animation metadata with final texture paths after restart and filename collisions', async format => {
  if (format === 'godot') await writeFile(path.join(project, 'project.godot'), 'config_version=5\n');
  if (format === 'phaser') await writeFile(path.join(project, 'package.json'), '{"dependencies":{"phaser":"^3.90.0"}}');
  const deps = { runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db),
    generate: ((args) => generateMedia({ ...args, output: 'primary.svg' })) as typeof generateMedia };
  const executor = new RecipeExecutor(deps);
  const detail = recipeDetail();
  detail.manifest.pixo!.recipe!.postprocess = [{ op: 'resize', params: { width: 4, height: 4 } }, { op: 'slice', params: { grid: '2x2' } },
    { op: 'export-spritesheet', params: { name: 'walk', columns: 2, animations: ['down', 'up'], fps: 7.5 } }];
  detail.manifest.pixo!.recipe!.checks = [];
  const started = await executor.start(detail, 'p', project, { recipeId: detail.id, inputs: {}, count: 1 }, model);
  const ready = await executor.wait('p', started.id);
  expect(ready.status, JSON.stringify(ready)).toBe('ready');
  const candidate = ready.candidates[0]!;
  expect(new Set(candidate.stagedFiles.map(file => file.ref)).size).toBe(candidate.stagedFiles.length);
  const dir = path.join(project, 'assets/sprites/hero');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'hero_walk.png'), 'existing texture');
  const restored = new RecipeExecutor(deps);
  const adopted = await restored.adopt('p', started.id, [candidate.id], { projectId: 'p', root: project });
  const paths = adopted.candidates[0]!.adoptedPaths!;
  const atlas = paths.find(file => file.endsWith('hero_walk_1.png'))!;
  expect(atlas).toBeTruthy();
  expect(await readFile(path.join(dir, 'hero_walk.png'), 'utf8')).toBe('existing texture');
  if (format === 'godot') {
    const tres = await readFile(path.join(project, paths.find(file => file.endsWith('.tres'))!), 'utf8');
    expect(tres).toContain(`path="res://${atlas}"`);
    expect(tres).toContain('"speed": 7.5');
    expect(tres).not.toContain('res://derived/');
  } else {
    const descriptor = paths.find(file => file.endsWith(`.${format}.json`))!;
    const parsed = JSON.parse(await readFile(path.join(project, descriptor), 'utf8'));
    expect(parsed.meta.image).toBe(path.posix.basename(atlas));
    if (format === 'phaser') {
      const config = JSON.parse(await readFile(path.join(project, paths.find(file => file.endsWith('.animations.json'))!), 'utf8'));
      expect(config.texture).toMatchObject({ image: path.posix.basename(atlas), atlas: path.posix.basename(descriptor) });
      expect(config.anims[0]).toMatchObject({ frameRate: 7.5, repeat: -1 });
    }
  }
});

// The 8-direction walk recipe painted a magenta background and keyed it with a
// hard tolerance; on a real Codex run every outline kept a purple edge and
// enclosed gaps stayed magenta. Image generation can be asked for transparency,
// with a careful keyed fallback when a model cannot return alpha.
it('asks the image provider for a transparent background when the recipe declares one', async () => {
  const generate = vi.fn<typeof generateMedia>(async args => generateMedia({ ...args, output: 'primary.svg' }));
  const executor = new RecipeExecutor({ runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db), generate });
  const detail = recipeDetail();
  detail.manifest.pixo!.recipe!.generation = { count: { default: 1, max: 1 }, background: 'transparent' };
  detail.manifest.pixo!.recipe!.postprocess = [];
  detail.manifest.pixo!.recipe!.checks = [];
  const started = await executor.start(detail, 'p', project, { recipeId: 'test-sprite', inputs: {}, count: 1 }, model);
  expect((await executor.wait('p', started.id)).status).toBe('ready');
  expect(generate.mock.calls[0]![0]).toMatchObject({ background: 'transparent' });

  const plain = recipeDetail();
  plain.manifest.pixo!.recipe!.postprocess = [];
  plain.manifest.pixo!.recipe!.checks = [];
  const second = await executor.start(plain, 'p', project, { recipeId: 'test-sprite', inputs: {}, count: 1 }, model);
  await executor.wait('p', second.id);
  expect(generate.mock.calls[1]![0]).not.toHaveProperty('background');
});

it('makes the bundled walk recipe request transparency instead of keying a painted magenta', () => {
  const walk = discoverRecipes(path.resolve(import.meta.dirname, '../../../plugins/_official')).find(recipe => recipe.id === 'sprite-walk-8dir')!;
  const recipe = walk.manifest.pixo!.recipe!;
  expect(recipe.generation?.background).toBe('transparent');
  expect(`${recipe.prompt}\n${recipe.negative ?? ''}`).not.toMatch(/magenta|#FF00FF/i);
  expect(recipe.postprocess?.map(step => step.op)).not.toContain('remove-bg');
  // A character drawn to the cell border is clipped when the sheet is sliced.
  expect(recipe.prompt).toContain('clear empty space between the cell edges and every part of the character');
});

it('adopts the bundled VFX recipe as one continuous non-looping engine animation', async () => {
  await writeFile(path.join(project, 'project.godot'), 'config_version=5\n');
  const detail = discoverRecipes(path.resolve(import.meta.dirname, '../../../plugins/_official')).find(recipe => recipe.id === 'vfx-sequence')!;
  const executor = new RecipeExecutor({ runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db),
    generate: args => generateMedia({ ...args, output: 'primary.svg' }) });
  const started = await executor.start(detail, 'p', project, { recipeId: detail.id, count: 1,
    inputs: { effect: 'test spark', palette: 'red and yellow', name: 'spark', grid: '3x3' } }, model);
  const ready = await executor.wait('p', started.id);
  expect(ready.status, JSON.stringify(ready)).toBe('ready');
  expect(ready.candidates[0]!.checks).toContainEqual(expect.objectContaining({ check: 'grid-divisible', ok: true }));
  const adopted = await executor.adopt('p', started.id, [ready.candidates[0]!.id], { projectId: 'p', root: project });
  const paths = adopted.candidates[0]!.adoptedPaths!;
  const tres = await readFile(path.join(project, paths.find(file => file.endsWith('.tres'))!), 'utf8');
  expect(tres).toContain('"loop": false');
  expect(tres).toContain('"name": &"effect"');
  expect(tres.match(/\[sub_resource type="AtlasTexture"/g)).toHaveLength(9);
});

it('starts the pixel grid at each frame origin when a pixel unit does not divide the frame size', async () => {
  const style: ArtStyle = { id: 'pixel-three', title: 'Pixel', description: '', dimension: ['2d'], medium: ['pixel'], prompt: 'Pixel', negativePrompt: '',
    constraints: { pixelSize: 3 }, previews: [], license: 'Apache-2.0' };
  const pixels = Buffer.from(Array.from({ length: 50 }, (_, i) => [i % 10 * 20, Math.floor(i / 10) * 30, 0, 255]).flat());
  const generate: typeof generateMedia = async args => {
    const meta = await generateMedia(args);
    await writeFile(path.join(args.projectsRoot, args.projectId, meta.name), await sharp(pixels, { raw: { width: 10, height: 5, channels: 4 } }).png().toBuffer());
    return meta;
  };
  const detail = recipeDetail();
  detail.manifest.pixo!.recipe!.postprocess = [{ op: 'resize', params: { width: 10, height: 5 } }, { op: 'slice', params: { grid: '2x1' } }];
  detail.manifest.pixo!.recipe!.checks = [];
  const executor = new RecipeExecutor({ runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db), generate });
  const started = await executor.start(detail, 'p', project, { recipeId: detail.id, count: 1, inputs: {} }, model, undefined, style);
  const ready = await executor.wait('p', started.id);
  expect(ready.status, JSON.stringify(ready)).toBe('ready');
  const frames = ready.candidates[0]!.stagedFiles.filter(file => file.ref.endsWith('.png')).slice(-2);
  expect(frames).toHaveLength(2);
  for (const frame of frames) {
    const { data: rgba, info } = await sharp(frame.ref).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([5, 5]);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const offset = (y * 5 + x) * 4, anchor = ((y - y % 3) * 5 + x - x % 3) * 4;
      expect(rgba.subarray(offset, offset + 4)).toEqual(rgba.subarray(anchor, anchor + 4));
    }
  }
});

it('checks the processed texture dimensions instead of the seamless-check preview dimensions', async () => {
  const detail = recipeDetail();
  detail.manifest.pixo!.recipe!.postprocess = [{ op: 'resize', params: { width: 8, height: 8 } }, { op: 'seamless-check', params: {} }];
  detail.manifest.pixo!.recipe!.checks = [{ check: 'dimensions', params: { width: 8, height: 8 } }];
  const executor = new RecipeExecutor({ runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db),
    generate: args => generateMedia({ ...args, output: 'primary.svg' }) });
  const started = await executor.start(detail, 'p', project, { recipeId: detail.id, count: 1, inputs: { style: 'hand-painted' } }, model);
  const ready = await executor.wait('p', started.id);
  expect(ready.status, JSON.stringify(ready)).toBe('ready');
  expect(ready.candidates[0]!.checks).toContainEqual({ check: 'dimensions', ok: true, detail: '8x8' });
});

it('preserves media reason codes on candidates, tasks and failed recipe runs', async () => {
  const mediaTasks = createMediaTaskStore(db);
  const generate: typeof generateMedia = async () => { throw Object.assign(new Error('Sign in to Codex'), { code: 'CODEX_CLI_AUTH_REQUIRED', reason: 'login_required' }); };
  const executor = new RecipeExecutor({ runtimeDataDir: data, projectRoot: root, db, mediaTasks, generate });
  const started = await executor.start(recipeDetail(), 'p', project, { recipeId: 'test-sprite', inputs: {}, count: 1 }, model);
  const failed = await executor.wait('p', started.id);
  expect(failed).toMatchObject({ status: 'failed', error: 'Sign in to Codex', errorCode: 'CODEX_CLI_AUTH_REQUIRED', errorReason: 'login_required' });
  expect(failed.candidates[0]).toMatchObject({ error: 'Sign in to Codex', errorCode: 'CODEX_CLI_AUTH_REQUIRED', errorReason: 'login_required' });
  expect(mediaTasks.getLiveMediaTask(failed.candidates[0]!.mediaTaskId!)?.error).toEqual({ message: 'Sign in to Codex', code: 'CODEX_CLI_AUTH_REQUIRED' });
});
it('runs a 3D recipe on its reference image and adopts the GLB into the project', async () => {
  const glb = Buffer.concat([Buffer.from('glTF', 'latin1'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(60, 1)]);
  const detail = recipeDetail();
  Object.assign(detail.manifest.pixo!.recipe!, { surface: 'model3d', postprocess: [], checks: [], models: { requires: ['image-to-3d'], recommended: [], fallback: [] },
    generation: { count: { default: 1, max: 2 } }, output: { dir: 'models/chest', name: 'chest' } });
  const calls: Array<{ surface: string; output?: string | undefined; images?: string[] | undefined }> = [];
  const generate = (async (args: Parameters<typeof generateMedia>[0]) => {
    calls.push({ surface: args.surface, output: args.output, images: args.images });
    const dir = path.join(args.projectsRoot, args.projectId);
    await writeFile(path.join(dir, args.output!), glb);
    return { name: args.output!, mime: 'model/gltf-binary', kind: 'model3d', providerId: 'media-gateway', providerError: null, usedStubFallback: false, intentionalStub: false };
  }) as unknown as typeof generateMedia;
  const executor = new RecipeExecutor({ runtimeDataDir: data, projectRoot: root, db, mediaTasks: createMediaTaskStore(db), generate });
  await writeFile(path.join(project, 'chest.png'), Buffer.alloc(8));
  const started = await executor.start(detail, 'p', project, { recipeId: 'test-sprite', inputs: { reference: 'chest.png' } },
    { id: 'tripo-v2.5-gateway', provider: 'media-gateway', caps: ['image-to-3d'], label: 'Tripo', hint: '' });
  const ready = await executor.wait('p', started.id);
  expect(ready.status, JSON.stringify(ready)).toBe('ready');
  expect(calls).toEqual([{ surface: 'model3d', output: 'primary.glb', images: ['references/0.png'] }]);
  const adopted = await executor.adopt('p', started.id, [ready.candidates[0]!.id], { projectId: 'p', root: project });
  expect(adopted.candidates[0]!.adoptedPaths).toEqual(['models/chest/chest.glb']);
  expect(await readFile(path.join(project, 'models/chest/chest.glb'))).toEqual(glb);
});
