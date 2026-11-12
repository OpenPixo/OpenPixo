import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createCharacter, deleteCharacter, getCharacter, listCharacters, updateCharacter } from '../src/recipes/characters.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'recipe-characters-')); });
afterEach(async () => {
  if (!path.resolve(root).startsWith(path.join(tmpdir(), 'recipe-characters-'))) throw new Error('Unsafe cleanup target');
  await rm(root, { recursive: true, force: true });
});
it('creates, reads, updates, and deletes project-owned character cards without overwriting', async () => {
  const card = await createCharacter(root, { slug: 'fox-hero', name: 'Fox', description: 'Orange fox', references: ['art/fox.png'] });
  expect(await getCharacter(root, card.slug)).toEqual(card);
  await expect(createCharacter(root, card)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await updateCharacter(root, card.slug, { style: 'pixel-32' })).toMatchObject({ style: 'pixel-32' });
  expect(await listCharacters(root)).toHaveLength(1);
  await deleteCharacter(root, card.slug);
  expect(await listCharacters(root)).toEqual([]);
});
it('rejects traversal, absolute reference paths, and character directory symlink escapes', async () => {
  const card = { slug: 'fox', name: 'Fox', description: 'Orange fox' };
  for (const references of [['../secret.png'], ['C:\\secret.png'], ['/secret.png']]) await expect(createCharacter(root, { ...card, references })).rejects.toThrow();
  await expect(getCharacter(root, '../escape')).rejects.toThrow();
  const project = path.join(root, 'game'); const outside = path.join(root, 'outside');
  await mkdir(project); await mkdir(outside);
  await symlink(outside, path.join(project, '.openpixo'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(createCharacter(project, card)).rejects.toThrow('escapes');
});
