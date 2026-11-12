import { mkdtemp, readFile, readdir, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { copyGameTemplate, listGameTemplates, resolveGameTemplateCover } from '../../src/game/templates.js';

const templatesRoot = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
const scratch: string[] = [];
async function parent() {
  const dir = await mkdtemp(path.join(tmpdir(), 'openpixo-template-'));
  scratch.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

it('lists the five shipped templates with English and Chinese metadata', async () => {
  const templates = await listGameTemplates(templatesRoot);
  expect(templates.map(({ id, engine }) => ({ id, engine }))).toEqual([
    { id: 'godot4-2d', engine: 'godot' },
    { id: 'godot4-3d', engine: 'godot' },
    { id: 'phaser3-sample-platformer', engine: 'phaser' },
    { id: 'phaser3-vite', engine: 'phaser' },
    { id: 'threejs-vite', engine: 'threejs' },
  ]);
  for (const template of templates) {
    for (const field of ['name', 'description', 'nameZhCN', 'descriptionZhCN'] as const) {
      expect(template[field]?.trim(), `${template.id}.${field}`).toBeTruthy();
    }
    expect(template.coverUrl, `${template.id}.coverUrl`).toBe(`/api/game-templates/${template.id}/cover`);
  }
  expect(templates.find(template => template.id === 'phaser3-sample-platformer')).toMatchObject({
    name: 'Sample: pixel platformer', nameZhCN: '示例：像素平台跳跃',
    description: 'A complete pixel platformer with coins, platforms, a goal flag, and original art and sound. No generation key needed.',
    descriptionZhCN: '完整的像素平台跳跃小游戏，包含金币、平台、终点旗帜及原创图像和音效，无需配置生成密钥。',
  });
});

it('lists coverUrl only for a template that ships a cover beside files/', async () => {
  const root = await parent();
  for (const id of ['with-png', 'with-webp', 'plain']) {
    await mkdir(path.join(root, id, 'files'), { recursive: true });
    await writeFile(path.join(root, id, 'template.json'), JSON.stringify({ id, name: id, engine: 'phaser', description: id }));
  }
  await writeFile(path.join(root, 'with-png', 'cover.png'), 'png');
  await writeFile(path.join(root, 'with-webp', 'cover.webp'), 'webp');
  await writeFile(path.join(root, 'plain', 'files', 'cover.webp'), 'not a catalog cover');
  expect((await listGameTemplates(root)).map(({ id, coverUrl }) => ({ id, coverUrl }))).toEqual([
    { id: 'plain', coverUrl: undefined },
    { id: 'with-png', coverUrl: '/api/game-templates/with-png/cover' },
    { id: 'with-webp', coverUrl: '/api/game-templates/with-webp/cover' },
  ]);
  expect(await resolveGameTemplateCover(root, 'with-webp')).toEqual({ file: path.join(root, 'with-webp', 'cover.webp'), contentType: 'image/webp' });
  expect(await resolveGameTemplateCover(root, '..')).toBeNull();
  expect(await resolveGameTemplateCover(root, 'plain')).toBeNull();
});

it('copies only project files into a new child directory', async () => {
  const dir = await parent();
  const target = await copyGameTemplate(templatesRoot, { parentDir: dir, name: 'my-game', templateId: 'phaser3-vite' });
  expect(target).toBe(path.join(await realpath(dir), 'my-game'));
  expect(JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')).dependencies.phaser).toBe('3.90.0');
  expect(await readdir(target)).not.toContain('template.json');
  expect(await readFile(path.join(target, 'src/main.ts'), 'utf8')).toContain('createCursorKeys');
});

it('refuses an existing directory without overwriting it', async () => {
  const dir = await parent();
  await mkdir(path.join(dir, 'existing'));
  await writeFile(path.join(dir, 'existing', 'keep.txt'), 'original');
  await expect(copyGameTemplate(templatesRoot, { parentDir: dir, name: 'existing', templateId: 'godot4-2d' })).rejects.toThrow('Target already exists');
  expect(await readdir(path.join(dir, 'existing'))).toEqual(['keep.txt']);
  expect(await readFile(path.join(dir, 'existing', 'keep.txt'), 'utf8')).toBe('original');
});

it('rejects traversal, separators and invalid Windows names before writing', async () => {
  const dir = await parent();
  for (const name of ['', '.', '..', '../escape', 'a/b', 'a\\b', 'a..b', 'C:escape', 'NUL', 'game.']) {
    await expect(copyGameTemplate(templatesRoot, { parentDir: dir, name, templateId: 'phaser3-vite' })).rejects.toThrow('name must');
  }
  await expect(copyGameTemplate(templatesRoot, { parentDir: dir, name: 'game', templateId: '../other' })).rejects.toThrow('Unknown game template');
  expect(await readdir(dir)).toEqual([]);
});

it('runs import policy before creating any files', async () => {
  const dir = await parent();
  await expect(copyGameTemplate(templatesRoot, { parentDir: dir, name: 'game', templateId: 'godot4-3d' },
    async () => { throw new Error('cannot import the data directory'); },
  )).rejects.toThrow('cannot import the data directory');
  expect(await readdir(dir)).toEqual([]);
});

/*
 * 2026-11-11 Sol roguelike run: once the agent added a vite.config, every build and
 * playtest inside Codex's Windows sandbox failed with `Cannot read directory
 * "../../../../../..": Access is denied`, because the default loader bundles the
 * config with esbuild, which walks every parent folder. Reproduced with
 * `codex sandbox -c sandbox_mode="workspace-write" -- node node_modules/vite/bin/vite.js build`;
 * `--configLoader native` built in the same sandbox.
 */
it('starts every Vite starter with the native config loader', async () => {
  for (const id of ['phaser3-vite', 'phaser3-sample-platformer', 'threejs-vite']) {
    const manifest = JSON.parse(await readFile(path.join(templatesRoot, id, 'files', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const name of ['dev', 'build', 'preview']) {
      expect(manifest.scripts[name], `${id} ${name}`).toMatch(/\bvite\b[^&]*--configLoader native/);
    }
  }
});
