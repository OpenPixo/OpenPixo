import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { detectGamePackageManager, prepareGameDependencyInstall, installGameDependencies } from '../../src/game/install-deps.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'pixo-install-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
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

it('installs a game that is a real member of its pnpm workspace through the workspace', async () => {
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'games/*'\n");
  const game = path.join(root, 'games', 'my-game');
  await mkdir(game, { recursive: true });
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2', dependencies: { shared: 'workspace:*' } }));
  expect(await prepareGameDependencyInstall(game, resolveTool)).toMatchObject({ argv: ['install'], installCommand: 'pnpm install' });
});
