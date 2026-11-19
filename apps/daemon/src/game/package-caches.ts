import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GamePackageManager } from '@openpixo/contracts';
import { envValue } from './npm-registry.js';

/**
 * The package-manager caches the installs OpenPixo starts use: in daemon data,
 * shared by all games, never in a game folder.
 *
 * An agent's `pixo game install-deps` runs in the agent's own CLI process, inside
 * its sandbox. Codex's Windows workspace-write sandbox cannot write the user
 * profile, so pnpm cannot reach its default store; it looks for the highest folder
 * it may hard-link from, finds only the game folder, and makes `.pnpm-store` there
 * (191 MB and ~2,900 files in one Phaser game, 2026-11-19). npm cannot write its
 * cache at all and fails with EPERM. `chatToolOutputDirs` grants this root to
 * every agent run of a project, so the sandbox can write it.
 *
 * pnpm hard-links from its store. When the data root and the game sit on
 * different drives, pnpm warns and copies packages from the store instead; the
 * install still works, it only costs the disk space npm would use.
 */
export function gamePackageCacheRoot(dataDir: string): string {
  return path.join(dataDir, 'package-caches');
}

/**
 * pnpm refuses to relink a node_modules made against another store when it has no
 * terminal (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). It reads this setting from
 * the environment as the string "false", which it treats as true, so it goes on
 * the command line.
 */
const PNPM_STORE_SWITCH_ARGV = ['--config.confirm-modules-purge=false'];

export interface GamePackageCacheSetup {
  /** Environment additions for the install process. */
  env: Record<string, string>;
  /** Arguments appended to the install command. */
  argv: string[];
  /** Lines for the install log. */
  notes: string[];
}

export interface GamePackageCacheOptions {
  /** The folder the install runs in. */
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Where `packageManager` keeps its caches for this install.
 *
 * A location the user set in the environment wins, as it does for the registry.
 * pnpm keeps the store an installed node_modules already links to, unless that
 * store sits in the game folder: relinking means deleting every hard link first,
 * and a sandbox may delete none of the links into a store it cannot write (pnpm
 * then stops halfway with EPERM and leaves node_modules broken). A store in the
 * game folder is writable from there, so that one is moved out of the way.
 *
 * When the daemon root cannot be written (a sandbox that was not granted it, a
 * broken data folder), the package manager keeps its own default and the
 * install still runs.
 */
export async function gamePackageCacheSetup(packageManager: GamePackageManager, dataDir: string,
  { cwd, env = process.env }: GamePackageCacheOptions): Promise<GamePackageCacheSetup> {
  const setup: GamePackageCacheSetup = { env: {}, argv: [], notes: [] };
  /** Config the package manager reads from `npm_config_<name>`, and its folder in the daemon root. */
  const wanted: Array<[config: string, folder: string]> = [];
  let movingFrom: string | null = null;
  if (packageManager === 'npm') {
    if (!envValue(env, 'npm_config_cache')) wanted.push(['npm_config_cache', 'npm']);
  } else if (packageManager === 'pnpm') {
    if (!envValue(env, 'npm_config_store_dir')) {
      const linked = await linkedPnpmStore(cwd);
      if (linked && !isInside(cwd, linked)) setup.env.npm_config_store_dir = linked;
      else {
        wanted.push(['npm_config_store_dir', 'pnpm-store']);
        movingFrom = linked;
      }
    }
    if (!envValue(env, 'npm_config_cache_dir')) wanted.push(['npm_config_cache_dir', 'pnpm-cache']);
  }
  const daemonDirs: Record<string, string> = {};
  try {
    for (const [config, folder] of wanted) {
      const dir = path.join(gamePackageCacheRoot(dataDir), folder);
      await assertWritableDirectory(dir);
      daemonDirs[config] = dir;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    setup.notes.push(`OpenPixo's shared package cache is unavailable (${reason}); ${packageManager} uses its own default location.`);
    return setup;
  }
  Object.assign(setup.env, daemonDirs);
  if (movingFrom && daemonDirs.npm_config_store_dir) {
    setup.argv.push(...PNPM_STORE_SWITCH_ARGV);
    const folder = path.relative(cwd, movingFrom).split(path.sep)[0] || movingFrom;
    setup.notes.push(`Moving this game's packages out of ${folder} in the game folder. ${folder} is no longer used and can be deleted.`);
  }
  return setup;
}

/** The store `node_modules/.modules.yaml` records, or null for no pnpm install yet. */
async function linkedPnpmStore(cwd: string): Promise<string | null> {
  let text: string;
  try { text = await readFile(path.join(cwd, 'node_modules', '.modules.yaml'), 'utf8'); } catch { return null; }
  let value: unknown;
  try { value = (JSON.parse(text) as { storeDir?: unknown }).storeDir; }
  catch { value = /^storeDir:\s*['"]?(.+?)['"]?\s*$/mu.exec(text)?.[1]; }
  return typeof value === 'string' && path.isAbsolute(value) ? path.normalize(value) : null;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** A sandbox can refuse writes to a folder that already exists, so try one. */
async function assertWritableDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const probe = path.join(dir, `.write-test-${randomUUID()}`);
  await writeFile(probe, '');
  await rm(probe, { force: true });
}
