import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gameDependenciesInstalled, installGameDependencies } from '../../src/game/install-deps.js';
import { gameInstallState } from '../../src/game/install-state.js';
import { executeGameProcess } from '../../src/game/verify-process.js';

/*
 * An install the user does not wait for can be cut short at any time, and can run while
 * something else needs the packages. A killed `npm install` leaves every package's folder
 * behind, some half full, and the next `npm install` calls them "up to date" (measured
 * 2026-11-24), so what is on disk cannot tell a finished install from an unfinished one.
 */
let root: string, game: string, data: string;
const resolveTool = (id: string) => id === 'node' ? process.execPath : `/tools/${id}`;
const isFile = (file: string) => stat(file).then(value => value.isFile(), () => false);
const marker = () => path.join(game, 'node_modules', '.openpixo-install.json');
const addPackage = async (name: string, file = 'package.json') => {
  const dir = path.join(game, 'node_modules', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), '{}');
};
/** A process id that is certainly not running: far above any real one. */
const NO_SUCH_PROCESS = 2 ** 30;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pixo-install-state-'));
  game = path.join(root, 'game'); data = path.join(root, 'data');
  await mkdir(game);
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ dependencies: { phaser: '3.90.0' }, devDependencies: { vite: '7.1.12' } }));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

it('does not call a game installed while its packages are still being written', async () => {
  let finish!: () => void;
  const written = new Promise<void>(resolve => { finish = resolve; });
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  const install = installGameDependencies(game, data, resolveTool, { execute: async () => {
    for (const name of ['phaser', 'vite']) await addPackage(name);
    started();
    await written;
    return { exitCode: 0, timedOut: false };
  } });
  await running;
  expect(await gameInstallState(game)).toBe('running');
  expect(await gameDependenciesInstalled(game)).toBe(false);
  finish();
  expect(await install).toMatchObject({ status: 'installed' });
  expect(await gameInstallState(game)).toBe('idle');
  expect(await gameDependenciesInstalled(game)).toBe(true);
  expect((await readdir(path.join(game, 'node_modules'))).sort()).toEqual(['phaser', 'vite']);
});

it('starts over when the app closed in the middle of a first install', async () => {
  for (const name of ['phaser', 'vite']) await addPackage(name, 'half-written');
  await writeFile(marker(), JSON.stringify({ pid: NO_SUCH_PROCESS, startedAt: Date.now(), fresh: true }));
  expect(await gameInstallState(game)).toBe('unfinished');
  expect(await gameDependenciesInstalled(game)).toBe(false);
  const execute = vi.fn(async () => {
    expect(await isFile(path.join(game, 'node_modules', 'phaser', 'half-written'))).toBe(false);
    for (const name of ['phaser', 'vite']) await addPackage(name);
    return { exitCode: 0, timedOut: false };
  });
  expect(await installGameDependencies(game, data, resolveTool, { execute })).toMatchObject({ status: 'installed' });
  expect(execute).toHaveBeenCalledOnce();
  expect(await gameDependenciesInstalled(game)).toBe(true);
});

it.runIf(process.platform === 'win32')('finishes over a left-over file that is in use', async () => {
  await addPackage('phaser', 'in-use.node');
  await writeFile(marker(), JSON.stringify({ pid: NO_SUCH_PROCESS, startedAt: Date.now(), fresh: true }));
  // Windows will not remove the folder a process runs in.
  const holder = spawn(process.execPath, ['-e', 'console.log(1); setInterval(() => {}, 1000)'], { cwd: path.join(game, 'node_modules', 'phaser'), stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await once(holder.stdout!, 'data');
    await installGameDependencies(game, data, resolveTool, { execute: async () => {
      for (const name of ['phaser', 'vite']) await addPackage(name);
      return { exitCode: 0, timedOut: false };
    } });
    expect(await gameDependenciesInstalled(game)).toBe(true);
  } finally { holder.kill(); await once(holder, 'close'); }
});

it('keeps packages that were there before an interrupted install', async () => {
  await addPackage('phaser');
  await writeFile(marker(), JSON.stringify({ pid: NO_SUCH_PROCESS, startedAt: Date.now(), fresh: false }));
  await installGameDependencies(game, data, resolveTool, { execute: async () => {
    expect(await isFile(path.join(game, 'node_modules', 'phaser', 'package.json'))).toBe(true);
    await addPackage('vite');
    return { exitCode: 0, timedOut: false };
  } });
  expect(await gameDependenciesInstalled(game)).toBe(true);
});

it.each([
  ['stopped', { exitCode: null, timedOut: false, cancelled: true }],
  ['out of time', { exitCode: null, timedOut: true }],
] as const)('remembers an install that was %s as unfinished', async (_name, exit) => {
  await installGameDependencies(game, data, resolveTool, { execute: async () => {
    for (const name of ['phaser', 'vite']) await addPackage(name, 'half-written');
    return exit;
  } });
  expect(await gameInstallState(game)).toBe('unfinished');
  expect(await gameDependenciesInstalled(game)).toBe(false);
});

it('leaves nothing behind when the package manager reports a failure', async () => {
  const result = await installGameDependencies(game, data, resolveTool, { execute: async () => ({ exitCode: 1, timedOut: false }) });
  expect(result).toMatchObject({ status: 'failed', reasonCode: 'INSTALL_FAILED' });
  expect(await readdir(game)).toEqual(['package.json']);
});

it('reads a note it cannot understand as an unfinished install, and one left for too long', async () => {
  await addPackage('phaser');
  await writeFile(marker(), '{"pid":');
  expect(await gameInstallState(game)).toBe('unfinished');
  // This process is alive, but no install runs for a day.
  await writeFile(marker(), JSON.stringify({ pid: process.pid, startedAt: Date.now() - 24 * 60 * 60_000, fresh: false }));
  expect(await gameInstallState(game)).toBe('unfinished');
});

it('runs one install of a game at a time, whoever starts it', async () => {
  let active = 0, most = 0;
  const execute = async () => {
    most = Math.max(most, ++active);
    await new Promise(resolve => setTimeout(resolve, 50));
    active -= 1;
    return { exitCode: 0, timedOut: false };
  };
  const results = await Promise.all([1, 2, 3].map(() => installGameDependencies(game, data, resolveTool, { execute })));
  expect(results.map(result => result.status)).toEqual(['installed', 'installed', 'installed']);
  expect(most).toBe(1);
});

it('holds a check of the game until its packages are there', async () => {
  let finish!: () => void;
  const written = new Promise<void>(resolve => { finish = resolve; });
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  const order: string[] = [];
  const install = installGameDependencies(game, data, resolveTool, { execute: async () => {
    started(); await written; order.push('installed');
    return { exitCode: 0, timedOut: false };
  } });
  await running;
  const check = executeGameProcess({ projectDir: game, command: { argv: ['node', '-e', 'process.exit(3)'], cwd: '.', timeoutMs: 20_000 },
    executable: process.execPath, output: () => {} }).then(result => { order.push('checked'); return result; });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(order).toEqual([]);
  finish();
  await install;
  expect(await check).toMatchObject({ exitCode: 3 });
  expect(order).toEqual(['installed', 'checked']);
});

it('installs even where the note cannot be written', async () => {
  await writeFile(path.join(game, 'node_modules'), 'a file where the folder should be');
  const execute = vi.fn(async () => ({ exitCode: 0, timedOut: false }));
  expect(await installGameDependencies(game, data, resolveTool, { execute })).toMatchObject({ status: 'installed' });
  expect(execute).toHaveBeenCalledOnce();
  expect(await readFile(path.join(game, 'node_modules'), 'utf8')).toContain('a file');
});
