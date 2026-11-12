import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { copyGameTemplate, initializeGameTemplateGit, resolveGameTemplateParent } from '../../src/game/templates.js';

const templates = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'pixo-first-game-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('creates missing parents only with explicit intent, after import policy approval', async () => {
  const parentDir = path.join(root, 'new', 'games');
  const input = { parentDir, name: 'game', templateId: 'godot4-2d' };
  await expect(copyGameTemplate(templates, input)).rejects.toMatchObject({ reasonCode: 'PARENT_NOT_FOUND' });
  const approve = vi.fn(async () => { expect(await readdir(root)).toEqual([]); });
  const target = await copyGameTemplate(templates, { ...input, createParent: true }, approve);
  expect(approve).toHaveBeenCalled();
  expect(await readFile(path.join(target, 'project.godot'), 'utf8')).toContain('config_version');
});

it('does not create even the missing parent when the import policy refuses it', async () => {
  await expect(copyGameTemplate(templates, { parentDir: path.join(root, 'no', 'games'), name: 'game', templateId: 'godot4-2d', createParent: true },
    async () => { throw new Error('blocked'); })).rejects.toThrow('blocked');
  expect(await readdir(root)).toEqual([]);
});

it('resolves an existing Windows-length scratchpad path without truncating it', async () => {
  const longParent = path.join(root, ...Array.from({ length: 12 }, (_, i) => `scratchpad-${i}-long-folder`), 'games');
  await mkdir(longParent, { recursive: true });
  expect(longParent.length).toBeGreaterThan(260);
  expect(await resolveGameTemplateParent(longParent)).toBe(await realpath(longParent));
});

it('distinguishes a relative parent and a non-directory parent with reason codes', async () => {
  await expect(resolveGameTemplateParent('relative')).rejects.toMatchObject({ reasonCode: 'PARENT_NOT_ABSOLUTE' });
  const file = path.join(root, 'file'); await writeFile(file, '');
  await expect(resolveGameTemplateParent(file)).rejects.toMatchObject({ reasonCode: 'PARENT_NOT_DIRECTORY' });
});

it('initializes one commit with the local OpenPixo identity, without user git configuration', async () => {
  const runGit = vi.fn(async (argv: string[], _input?: string) => argv[0] === 'write-tree' ? 'tree' : argv[0] === 'commit-tree' ? 'commit' : '');
  expect(await initializeGameTemplateGit(root, 'phaser3-vite', runGit)).toEqual({ status: 'initialized' });
  expect(runGit.mock.calls.map(call => call[0])).toEqual([
    ['init', '--quiet'], ['add', '-A', '--', '.'], ['write-tree'], ['commit-tree', 'tree'], ['update-ref', 'HEAD', 'commit', ''],
  ]);
  expect(runGit.mock.calls[3]?.[1]).toBe('Initial project from phaser3-vite\n');
});

it('skips git without failing creation when git is absent', async () => {
  const runGit = vi.fn(async () => { throw Object.assign(new Error('missing git'), { code: 'ENOENT' }); });
  expect(await initializeGameTemplateGit(root, 'godot4-2d', runGit)).toEqual({ status: 'skipped', reasonCode: 'GIT_MISSING' });
  expect(runGit).toHaveBeenCalledOnce();
});
