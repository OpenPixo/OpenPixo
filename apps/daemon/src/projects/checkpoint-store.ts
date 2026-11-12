import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { RESERVED_PROJECT_FILE_SEGMENTS } from '../project-reserved-paths.js';

/**
 * A project that is not its own Git repository keeps its checkpoints in a
 * private Git directory under the daemon data root, with the project folder as
 * the work tree. Nothing is written into the user's folder, so this needs no
 * opt-in: an empty new project, an imported folder and a folder inside someone
 * else's repository all get a change record from their first run.
 *
 * Automatic means it must stay cheap. Dependency and engine output never enter
 * the store, and a project too large to hash on every run reports
 * `project_too_large` instead of stalling each run's start.
 */
export interface CheckpointStore {
  dir: string;
  limits?: CheckpointStoreLimits;
}

export interface CheckpointStoreLimits {
  maxFiles: number;
  maxBytes: number;
}

const DEFAULT_LIMITS: CheckpointStoreLimits = { maxFiles: 30_000, maxBytes: 2 * 1024 ** 3 };
const MEASURE_TTL_MS = 30_000;

/** Skipped at any depth: dependencies, tool caches and OpenPixo's own staging. */
const EXCLUDED_ANYWHERE = [
  '.git', 'node_modules', '__pycache__', '.venv', 'venv', '.next', '.cache', '.tmp', '.gradle',
  '.godot', '.import', '.pixo', '.pixo-skills', ...RESERVED_PROJECT_FILE_SEGMENTS,
];
/** Skipped only at the project root: engine and build output whose names are common elsewhere. */
const EXCLUDED_AT_ROOT = [
  'Library', 'Temp', 'Obj', 'Logs', 'UserSettings', 'Build', 'Builds',
  'Binaries', 'Intermediate', 'Saved', 'DerivedDataCache', 'dist', 'target', 'coverage',
];

export function checkpointStoreDir(dataRoot: string, projectId: string): string {
  return path.join(dataRoot, 'checkpoint-stores', projectId);
}

export function checkpointStore(dataRoot: string, projectId: string): CheckpointStore {
  return { dir: checkpointStoreDir(dataRoot, projectId) };
}

export async function removeCheckpointStore(dataRoot: string, projectId: string): Promise<void> {
  await rm(checkpointStoreDir(dataRoot, projectId), { recursive: true, force: true });
}

/** The store's `info/exclude`. A project's own `.gitignore` still applies on top. */
export function checkpointStoreExcludes(): string {
  return `${[...EXCLUDED_ANYWHERE.map(name => `${name}/`), ...EXCLUDED_AT_ROOT.map(name => `/${name}/`)].join('\n')}\n`;
}

const measured = new Map<string, { at: number; over: boolean }>();

/** Whether the files a store would record exceed its limits. Stops at the first excess. */
export async function exceedsCheckpointStoreLimits(folder: string, limits: CheckpointStoreLimits = DEFAULT_LIMITS): Promise<boolean> {
  const key = `${folder}\0${limits.maxFiles}\0${limits.maxBytes}`;
  const cached = measured.get(key);
  if (cached && Date.now() - cached.at < MEASURE_TTL_MS) return cached.over;
  const over = await measure(folder, limits);
  measured.set(key, { at: Date.now(), over });
  return over;
}

async function measure(root: string, limits: CheckpointStoreLimits): Promise<boolean> {
  const anywhere = new Set(EXCLUDED_ANYWHERE.map(name => name.toLowerCase()));
  const atRoot = new Set(EXCLUDED_AT_ROOT.map(name => name.toLowerCase()));
  let files = 0;
  let bytes = 0;
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const name = entry.name.toLowerCase();
      if (entry.isDirectory()) {
        if (anywhere.has(name) || (directory === root && atRoot.has(name))) continue;
        pending.push(path.join(directory, entry.name));
      } else if (entry.isFile()) {
        files += 1;
        if (files > limits.maxFiles) return true;
        try { bytes += (await stat(path.join(directory, entry.name))).size; }
        catch { continue; }
        if (bytes > limits.maxBytes) return true;
      }
    }
  }
  return false;
}
