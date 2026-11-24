import { GAME_PACKAGE_LOCKS, gamePackageManager } from './package-manager.js';
import { npmRegistryEnv } from './npm-registry.js';
import { gamePackageCacheSetup } from './package-caches.js';
import { beginGameInstall, gameInstallState } from './install-state.js';
import { withoutDaemonMode } from '../daemon-mode-env.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCommandInvocation, forceStopWindowsProcessTree } from '@openpixo/platform';
import type { GameInstallDepsResult, GamePackageManager } from '@openpixo/contracts';

export const GAME_INSTALL_LOG_LIMIT = 64 * 1024;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
export type GameToolResolver = (id: string) => string | null | Promise<string | null>;

/** package.json as npm reads it: a byte-order mark (Windows PowerShell 5.1 writes one) is not content. */
async function readPackageManifest(cwd: string): Promise<Record<string, unknown>> {
  return JSON.parse((await readFile(path.join(cwd, 'package.json'), 'utf8')).replace(/^﻿/u, ''));
}

/** A manifest selects a known tool, never an executable or shell expression. */
export async function detectGamePackageManager(cwd: string): Promise<GamePackageManager> {
  let declared: unknown;
  try { declared = (await readPackageManifest(cwd)).packageManager; }
  catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const files = new Set<string>();
  for (const [file] of GAME_PACKAGE_LOCKS) {
    if (await stat(path.join(cwd, file)).then(value => value.isFile(), error => {
      if (error.code === 'ENOENT') return false; throw error;
    })) files.add(file);
  }
  return gamePackageManager(declared, file => files.has(file));
}

/**
 * Whether every package the game declares is installed, here or in a folder above
 * (a workspace hoists). A `node_modules` alone is not enough: an install that left
 * out the development dependencies looks installed and cannot start, and one that is
 * still at work, or was cut short, has folders without their files.
 */
export async function gameDependenciesInstalled(cwd: string): Promise<boolean> {
  if (await gameInstallState(cwd) !== 'idle') return false;
  const isDirectory = (dir: string) => stat(dir).then(value => value.isDirectory(), () => false);
  if (!await isDirectory(path.join(cwd, 'node_modules'))) return false;
  let manifest: Record<string, unknown> = {};
  try { manifest = await readPackageManifest(cwd); } catch { return true; /* nothing declared to check against */ }
  const declared = ['dependencies', 'devDependencies'].flatMap(key => {
    const group = manifest[key];
    return group && typeof group === 'object' ? Object.keys(group) : [];
  });
  const roots: string[] = [];
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    roots.push(path.join(dir, 'node_modules'));
    if (dir === path.dirname(dir)) break;
  }
  for (const name of declared) {
    let found = false;
    for (const root of roots) if (await isDirectory(path.join(root, ...name.split('/')))) { found = true; break; }
    if (!found) return false;
  }
  return true;
}

/** Canonicalize profile-owned cwd and refuse paths outside the project. */
export async function resolveGameCommandDirectory(projectDir: string, relativeCwd: string): Promise<string> {
  const root = await realpath(projectDir);
  const cwd = await realpath(path.resolve(root, relativeCwd));
  const relative = path.relative(root, cwd);
  if (path.isAbsolute(relativeCwd) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Engine command cwd is outside the project');
  }
  return cwd;
}

type InstallPlan = Omit<GameInstallDepsResult, 'status' | 'reasonCode'> & { status: 'ready' | 'failed';
  reasonCode?: 'NODE_MISSING' | 'PACKAGE_MANAGER_MISSING'; executable?: string; argv?: string[]; node?: string };
export async function prepareGameDependencyInstall(cwd: string, resolveTool: GameToolResolver): Promise<InstallPlan> {
  const requestedPackageManager = await detectGamePackageManager(cwd);
  const node = await resolveTool('node');
  if (!node) return { status: 'failed', reasonCode: 'NODE_MISSING', requestedPackageManager,
    message: 'Install Node.js, restart OpenPixo, and try again. https://nodejs.org/en/download' };
  let packageManager = requestedPackageManager;
  let executable = await resolveTool(packageManager);
  if (!executable && packageManager !== 'npm') { packageManager = 'npm'; executable = await resolveTool('npm'); }
  if (!executable) return { status: 'failed', reasonCode: 'PACKAGE_MANAGER_MISSING', requestedPackageManager,
    message: `Neither ${requestedPackageManager} nor npm is available on PATH` };
  const argv = packageManager === 'pnpm' && await belongsToForeignPnpmWorkspace(cwd) ? ['install', '--ignore-workspace'] : ['install'];
  return { status: 'ready', packageManager, requestedPackageManager, fallback: packageManager !== requestedPackageManager,
    installCommand: [packageManager, ...argv].join(' '), executable, argv, node };
}

/**
 * pnpm installs into the nearest ancestor workspace. A game folder that merely
 * sits below one (and is not a workspace root itself, nor uses `workspace:`
 * dependencies) must still get its own node_modules.
 */
async function belongsToForeignPnpmWorkspace(cwd: string): Promise<boolean> {
  const isFile = (file: string) => stat(file).then(value => value.isFile(), () => false);
  if (await isFile(path.join(cwd, 'pnpm-workspace.yaml'))) return false;
  let manifest: Record<string, unknown> = {};
  try { manifest = await readPackageManifest(cwd); } catch { /* no manifest */ }
  const usesWorkspaceProtocol = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .some(key => Object.values((manifest[key] ?? {}) as Record<string, unknown>).some(value => typeof value === 'string' && value.startsWith('workspace:')));
  if (usesWorkspaceProtocol) return false;
  for (let dir = path.dirname(cwd); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (await isFile(path.join(dir, 'pnpm-workspace.yaml'))) return true;
  }
  return false;
}

type InstallExit = { exitCode: number | null; timedOut: boolean; cancelled?: boolean };
type ExecuteInstall = (executable: string, argv: string[], cwd: string, output: (chunk: string | Buffer) => void) => Promise<InstallExit>;

/**
 * `installCommand` stays what a person would type in the game folder; the cache
 * locations (`gamePackageCacheSetup`) are added only to the process started here.
 */
async function executeInstall(packageManager: GamePackageManager, executable: string, argv: string[], cwd: string,
  output: (chunk: string | Buffer) => void, node: string, dataDir: string, signal?: AbortSignal): Promise<InstallExit> {
  const caches = await gamePackageCacheSetup(packageManager, dataDir, { cwd });
  for (const note of caches.notes) output(`${note}\n`);
  const invocation = createCommandInvocation({ command: executable, args: [...argv, ...caches.argv] });
  const registry = await npmRegistryEnv({ env: process.env, cwd });
  if (registry.npm_config_registry) output(`Using the npm mirror ${registry.npm_config_registry}
`);
  const spawnedAtMs = Date.now();
  const child = spawn(invocation.command, invocation.args, {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    env: { ...withoutDaemonMode(process.env), ...registry, ...caches.env, PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH ?? ''}`, PIXO_DATA_DIR: dataDir },
  });
  let timedOut = false;
  let cancelled = false;
  const kill = () => {
    if (!child.pid) return;
    if (process.platform === 'win32') void forceStopWindowsProcessTree(child.pid, { spawnedAtMs }).catch(error => output(String(error)));
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  };
  const abort = () => { cancelled = true; kill(); };
  const timer = setTimeout(() => { timedOut = true; kill(); }, INSTALL_TIMEOUT_MS);
  timer.unref();
  child.stdout!.on('data', output); child.stderr!.on('data', output);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) child.once('spawn', abort);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', exitCode => resolve({ exitCode, timedOut, cancelled }));
    });
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

/** Fixed install argv, bounded output, daemon-owned logs; callers supply the run authorization. */
export async function installGameDependencies(cwd: string, dataDir: string, resolveTool: GameToolResolver,
  options: { execute?: ExecuteInstall; signal?: AbortSignal; onOutput?: (log: string) => void } = {}): Promise<GameInstallDepsResult> {
  const { executable, argv, node, ...plan } = await prepareGameDependencyInstall(cwd, resolveTool);
  if (!executable || !argv || !node) return plan;
  let log = Buffer.alloc(0);
  const output = (chunk: string | Buffer) => {
    log = Buffer.concat([log, Buffer.from(chunk)]).subarray(-GAME_INSTALL_LOG_LIMIT);
    options.onOutput?.(log.toString('utf8'));
  };
  const ended = await beginGameInstall(cwd, options.signal);
  let end: 'installed' | 'failed' | 'cut-short' = 'failed';
  let result: GameInstallDepsResult;
  try {
    const exit = options.execute
      ? await options.execute(executable, argv, cwd, output)
      : await executeInstall(plan.packageManager!, executable, argv, cwd, output, node, dataDir, options.signal);
    end = exit.cancelled || exit.timedOut ? 'cut-short' : exit.exitCode === 0 ? 'installed' : 'failed';
    const reasonCode = exit.cancelled ? 'INSTALL_CANCELLED' : exit.timedOut ? 'INSTALL_TIMEOUT' : exit.exitCode !== 0 ? 'INSTALL_FAILED' : undefined;
    result = { ...plan, status: reasonCode ? 'failed' : 'installed', exitCode: exit.exitCode, ...(reasonCode ? { reasonCode } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output(message); result = { ...plan, status: 'failed', reasonCode: 'INSTALL_FAILED', message };
  } finally { await ended(end); }
  const logRef = await saveInstallLog(dataDir, log);
  return { ...result, ...(logRef ? { logRef } : {}), logTail: log.toString('utf8') };
}

/**
 * The saved log is a convenience; the bounded tail already travels in the result.
 * An agent's install runs in its own CLI process, and a sandbox such as Codex's
 * workspace-write may refuse the daemon data root, so a log that cannot be saved
 * must never fail or block the install itself.
 */
async function saveInstallLog(dataDir: string, log: Buffer): Promise<string | null> {
  const logRef = randomUUID();
  const logDir = path.join(dataDir, 'logs', 'game-installs');
  try {
    await mkdir(logDir, { recursive: true });
    await writeFile(path.join(logDir, `${logRef}.log`), log);
    return logRef;
  } catch {
    return null;
  }
}
