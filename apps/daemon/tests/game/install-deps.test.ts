import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { detectGamePackageManager, prepareGameDependencyInstall, installGameDependencies } from '../../src/game/install-deps.js';
import { gamePackageCacheRoot } from '../../src/game/package-caches.js';
import { chatToolOutputDirs } from '../../src/runtimes/chat-prompt-inputs.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'pixo-install-')); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
const resolveTool = async (id: string) => `/tools/${id}`;

it('prefers the declared package manager over lockfiles and never treats it as a command', async () => {
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2' }));
  await writeFile(path.join(root, 'package-lock.json'), '{}');
  expect(await detectGamePackageManager(root)).toBe('pnpm');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'npm && evil' }));
  expect(await detectGamePackageManager(root)).toBe('npm');
});

it.each([['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['package-lock.json', 'npm']])(
  'detects %s when no packageManager is declared', async (lock, manager) => {
    await writeFile(path.join(root, lock), '');
    expect(await detectGamePackageManager(root)).toBe(manager);
  },
);

it('falls back to npm and explains which manager was unavailable', async () => {
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2' }));
  expect(await prepareGameDependencyInstall(root, id => id === 'pnpm' ? null : resolveTool(id))).toMatchObject({
    status: 'ready', packageManager: 'npm', requestedPackageManager: 'pnpm', fallback: true,
    installCommand: 'npm install', executable: '/tools/npm', argv: ['install'],
  });
});

it('reports Node missing before recommending any install command', async () => {
  expect(await prepareGameDependencyInstall(root, id => id === 'node' ? null : resolveTool(id)))
    .toMatchObject({ status: 'failed', reasonCode: 'NODE_MISSING' });
  expect(await prepareGameDependencyInstall(root, () => null)).not.toHaveProperty('installCommand');
});

it('captures failed install output and saves its bounded log under the supplied data root', async () => {
  const data = path.join(root, 'data');
  const project = path.join(root, 'project');
  await mkdir(project);
  const execute = vi.fn(async (_executable: string, argv: string[], cwd: string, output: (chunk: string) => void) => {
    expect(argv).toEqual(['install']); expect(cwd).toBe(project);
    output('registry connection failed\n'); return { exitCode: 1, timedOut: false };
  });
  const result = await installGameDependencies(project, data, resolveTool, { execute });
  expect(result).toMatchObject({ status: 'failed', reasonCode: 'INSTALL_FAILED', logTail: 'registry connection failed\n' });
  expect(execute).toHaveBeenCalledOnce();
  expect(await readFile(path.join(data, 'logs', 'game-installs', `${result.logRef}.log`), 'utf8')).toBe(result.logTail);
});

/*
 * 2026-11-11 Sol roguelike run: with an agent token the install runs in the agent's
 * own CLI process, inside Codex's sandbox, which may not write the daemon data root.
 * `mkdir <data>/logs` failed with EPERM before npm ever ran, and the agent had to
 * ask the user to approve the install outside the sandbox.
 */
it('still installs when the log cannot be saved under the data root', async () => {
  const data = path.join(root, 'data-is-a-file');
  await writeFile(data, 'not a folder');
  const project = path.join(root, 'project');
  await mkdir(project);
  const execute = vi.fn(async (_executable: string, _argv: string[], _cwd: string, output: (chunk: string) => void) => {
    output('added 12 packages\n'); return { exitCode: 0, timedOut: false };
  });
  const result = await installGameDependencies(project, data, resolveTool, { execute });
  expect(execute).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ status: 'installed', exitCode: 0, logTail: 'added 12 packages\n' });
  expect(result).not.toHaveProperty('logRef');
});

it('reads the declared package manager from a package.json with a byte-order mark', async () => {
  await writeFile(path.join(root, 'package.json'), `﻿${JSON.stringify({ packageManager: 'pnpm@10.33.2' })}`);
  expect(await detectGamePackageManager(root)).toBe('pnpm');
});

it('executes a local package-manager shim with fixed argv and captures its real output', async () => {
  const project = path.join(root, 'game with spaces'); await mkdir(project);
  const script = path.join(root, 'fake-install.cts');
  await writeFile(script, `const fs = require('node:fs'); fs.mkdirSync('node_modules'); fs.writeFileSync('args.json', JSON.stringify(process.argv.slice(2))); console.log('dependencies installed');`);
  const tool = path.join(root, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  await writeFile(tool, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  const result = await installGameDependencies(project, path.join(root, 'data'), id => id === 'node' ? process.execPath : tool);
  expect(result).toMatchObject({ status: 'installed', exitCode: 0, logTail: expect.stringContaining('dependencies installed') });
  expect(JSON.parse(await readFile(path.join(project, 'args.json'), 'utf8'))).toEqual(['install']);
});

it('keeps a pnpm install inside a game folder that sits under an unrelated pnpm workspace', async () => {
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  const game = path.join(root, 'scratch', 'my-game');
  await mkdir(game, { recursive: true });
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2', dependencies: { phaser: '3.90.0' } }));
  expect(await prepareGameDependencyInstall(game, resolveTool)).toMatchObject({
    argv: ['install', '--ignore-workspace'], installCommand: 'pnpm install --ignore-workspace',
  });
});

/**
 * A fake package manager that records what it was given. Like pnpm in Codex's Windows
 * sandbox, it makes its store in the game folder when no store is configured.
 */
async function fakePackageManager(name: 'pnpm' | 'npm'): Promise<string> {
  const script = path.join(root, `fake-${name}.cts`);
  await writeFile(script, `const fs = require('node:fs');
const seen = { argv: process.argv.slice(2), storeDir: process.env.npm_config_store_dir ?? null,
  cacheDir: process.env.npm_config_cache_dir ?? null, cache: process.env.npm_config_cache ?? null };
fs.writeFileSync('seen.json', JSON.stringify(seen));
if (${JSON.stringify(name)} === 'pnpm' && !seen.storeDir) fs.mkdirSync('.pnpm-store/v10/files/00', { recursive: true });
fs.mkdirSync('node_modules', { recursive: true });
console.log('dependencies installed');`);
  const tool = path.join(root, process.platform === 'win32' ? `${name}.cmd` : name);
  await writeFile(tool, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return tool;
}

type Seen = { argv: string[]; storeDir: string | null; cacheDir: string | null; cache: string | null };
const seen = async (game: string): Promise<Seen> => JSON.parse(await readFile(path.join(game, 'seen.json'), 'utf8'));
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const unsetPackageCacheEnv = () => {
  for (const name of ['npm_config_store_dir', 'npm_config_cache_dir', 'npm_config_cache']) vi.stubEnv(name, undefined);
};

/*
 * B7, 2026-11-19, Codex in a Phaser game from phaser3-vite: `pixo game install-deps`
 * runs in the agent's own CLI process, inside Codex's Windows workspace-write sandbox.
 * pnpm cannot write its store under the user profile there, so it made `.pnpm-store`
 * in the game folder: 191 MB, and 2,861 files in the turn's changes list. Reproduced
 * with `codex sandbox -c sandbox_mode="workspace-write" -- pnpm install`.
 */
it('gives pnpm a store in daemon data, never in the game folder', async () => {
  unsetPackageCacheEnv();
  const data = path.join(root, 'data');
  const game = path.join(root, 'game'); await mkdir(game);
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2' }));
  const pnpm = await fakePackageManager('pnpm');
  const result = await installGameDependencies(game, data, id => id === 'node' ? process.execPath : pnpm);
  expect(result).toMatchObject({ status: 'installed', packageManager: 'pnpm', installCommand: 'pnpm install' });
  const { argv, storeDir, cacheDir } = await seen(game);
  expect(storeDir && inside(gamePackageCacheRoot(data), storeDir), String(storeDir)).toBe(true);
  expect(cacheDir && inside(gamePackageCacheRoot(data), cacheDir), String(cacheDir)).toBe(true);
  expect(await readdir(game)).not.toContain('.pnpm-store');
  expect(argv).toEqual(['install']);
});

/** node_modules as pnpm 10 leaves it: `.modules.yaml` is JSON and names the store it links to. */
async function linkedTo(game: string, storeDir: string): Promise<void> {
  await mkdir(path.join(game, 'node_modules'), { recursive: true });
  await writeFile(path.join(game, 'node_modules', '.modules.yaml'), JSON.stringify({ layoutVersion: 5, storeDir }, null, 2));
}

it('moves a game off a store that an earlier install left in its folder', async () => {
  unsetPackageCacheEnv();
  const data = path.join(root, 'data');
  const game = path.join(root, 'game'); await mkdir(game);
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2' }));
  await linkedTo(game, path.join(game, '.pnpm-store', 'v10'));
  const pnpm = await fakePackageManager('pnpm');
  const result = await installGameDependencies(game, data, id => id === 'node' ? process.execPath : pnpm);
  const { argv, storeDir } = await seen(game);
  expect(storeDir && inside(gamePackageCacheRoot(data), storeDir), String(storeDir)).toBe(true);
  // pnpm aborts a relink to another store when it has no terminal.
  expect(argv).toEqual(['install', '--config.confirm-modules-purge=false']);
  expect(result.logTail).toContain('.pnpm-store is no longer used');
});

/*
 * Relinking deletes every hard link first. Inside Codex's sandbox pnpm could delete none
 * of the links into the user's own store, stopped with EPERM halfway, and left
 * node_modules without its `.modules.yaml` (codex sandbox, 2026-11-19).
 */
it('keeps the store outside the game that an installed game already links to', async () => {
  unsetPackageCacheEnv();
  const data = path.join(root, 'data');
  const own = path.join(root, 'AppData', 'Local', 'pnpm', 'store', 'v10');
  const game = path.join(root, 'game'); await mkdir(game);
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2' }));
  await linkedTo(game, own);
  const pnpm = await fakePackageManager('pnpm');
  await installGameDependencies(game, data, id => id === 'node' ? process.execPath : pnpm);
  const { argv, storeDir, cacheDir } = await seen(game);
  expect(storeDir).toBe(own);
  expect(cacheDir && inside(gamePackageCacheRoot(data), cacheDir), String(cacheDir)).toBe(true);
  expect(argv).toEqual(['install']);
});

/* The same sandbox refuses npm's cache under the user profile: npm fails with EPERM. */
it('gives npm a cache in daemon data', async () => {
  unsetPackageCacheEnv();
  const data = path.join(root, 'data');
  const game = path.join(root, 'game'); await mkdir(game);
  const npm = await fakePackageManager('npm');
  expect(await installGameDependencies(game, data, id => id === 'node' ? process.execPath : npm)).toMatchObject({ status: 'installed', packageManager: 'npm' });
  const { argv, cache, storeDir } = await seen(game);
  expect(cache && inside(gamePackageCacheRoot(data), cache), String(cache)).toBe(true);
  expect(storeDir).toBeNull();
  expect(argv).toEqual(['install']);
});

it('keeps a cache location the user already set', async () => {
  unsetPackageCacheEnv();
  const own = path.join(root, 'my-store');
  vi.stubEnv('npm_config_store_dir', own);
  const game = path.join(root, 'game'); await mkdir(game);
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2' }));
  const pnpm = await fakePackageManager('pnpm');
  await installGameDependencies(game, path.join(root, 'data'), id => id === 'node' ? process.execPath : pnpm);
  const { argv, storeDir } = await seen(game);
  expect(storeDir).toBe(own);
  expect(argv).toEqual(['install']);
});

it('still installs, with the package manager\'s own default, when the daemon cache cannot be written', async () => {
  unsetPackageCacheEnv();
  const data = path.join(root, 'data-is-a-file');
  await writeFile(data, 'not a folder');
  const game = path.join(root, 'game'); await mkdir(game);
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2' }));
  const pnpm = await fakePackageManager('pnpm');
  await linkedTo(game, path.join(game, '.pnpm-store', 'v10'));
  const result = await installGameDependencies(game, data, id => id === 'node' ? process.execPath : pnpm);
  expect(result).toMatchObject({ status: 'installed', logTail: expect.stringContaining('package cache') });
  // No relink either: pnpm picks the store this game already uses.
  expect(await seen(game)).toMatchObject({ argv: ['install'], storeDir: null, cacheDir: null });
});

it('grants every agent run of a project write access to the package cache it installs with', async () => {
  const data = path.join(root, 'data');
  const dirs = await chatToolOutputDirs({ artifactsDir: path.join(data, 'artifacts'), runtimeDataDir: data }, 'project-1');
  expect(dirs).toContain(gamePackageCacheRoot(data));
  // A sandbox can only grant a folder that exists.
  expect((await stat(gamePackageCacheRoot(data))).isDirectory()).toBe(true);
  expect(await chatToolOutputDirs({ artifactsDir: path.join(data, 'artifacts'), runtimeDataDir: data }, null)).toEqual([]);
});

it('installs a game that is a real member of its pnpm workspace through the workspace', async () => {
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'games/*'\n");
  const game = path.join(root, 'games', 'my-game');
  await mkdir(game, { recursive: true });
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2', dependencies: { shared: 'workspace:*' } }));
  expect(await prepareGameDependencyInstall(game, resolveTool)).toMatchObject({ argv: ['install'], installCommand: 'pnpm install' });
});
