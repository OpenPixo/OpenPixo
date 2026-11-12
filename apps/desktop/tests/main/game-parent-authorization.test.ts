import { mkdtemp, mkdir, rm, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GameParentAuthorization } from '../../src/main/game-parent-authorization.js';
let root: string, documents: string, games: string, authorization: GameParentAuthorization;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pixo-t9-parent-'));
  documents = path.join(root, 'Documents'); await mkdir(documents);
  games = path.join(documents, 'OpenPixo Games'); authorization = new GameParentAuthorization(games);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
it('authorizes exactly the default games root after explicit creation intent without writing it', async () => {
  await expect(authorization.authorizeCreate({ baseDir: games, createParent: false })).rejects.toThrow();
  expect(await authorization.authorizeCreate({ baseDir: games, createParent: true })).toBe(games);
  await expect(stat(games)).rejects.toMatchObject({ code: 'ENOENT' });
  for (const baseDir of [documents, games + '-other', path.join(root, 'elsewhere'), path.join(games, 'nested', 'games')]) {
    await expect(authorization.authorizeCreate({ baseDir, createParent: true })).rejects.toThrow();
  }
  expect(await authorization.authorizeCreate({ baseDir: path.join(games, 'child'), createParent: true })).toBe(path.join(games, 'child'));
});
it('authorizes a direct child of a picked directory, without granting sibling or recursive access', async () => {
  const picked = path.join(root, 'chosen'); await mkdir(picked); await authorization.recordPickedParent(picked);
  expect(await authorization.authorizeCreate({ baseDir: path.join(picked, 'new'), createParent: true })).toBe(path.join(picked, 'new'));
  await expect(authorization.authorizeCreate({ baseDir: path.join(picked, 'new', 'nested'), createParent: true })).rejects.toThrow();
  await expect(authorization.authorizeCreate({ baseDir: path.join(root, 'sibling'), createParent: true })).rejects.toThrow();
});
it('keeps a picked folder authorized for a fresh token, and nothing beside it', async () => {
  const picked = path.join(root, 'RageGame'); await mkdir(picked);
  await expect(authorization.authorizeCreate({ baseDir: picked, createParent: true })).rejects.toThrow();
  await authorization.recordPickedParent(picked);
  expect(await authorization.authorizeCreate({ baseDir: picked, createParent: true })).toBe(picked);
  await expect(authorization.authorizeCreate({ baseDir: `${picked}-other`, createParent: true })).rejects.toThrow();
});
it('refuses junction or symlink escapes from the default and picked parents', async () => {
  const outside = path.join(root, 'outside'); await mkdir(outside);
  await symlink(outside, games, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(authorization.authorizeCreate({ baseDir: games, createParent: true })).rejects.toThrow();
  await expect(authorization.authorizeCreate({ baseDir: path.join(games, 'child'), createParent: true })).rejects.toThrow();
  const picked = path.join(root, 'picked'); await mkdir(picked); await authorization.recordPickedParent(picked);
  const child = path.join(picked, 'redirected'); await symlink(outside, child, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(authorization.authorizeCreate({ baseDir: child, createParent: true })).rejects.toThrow();
});
