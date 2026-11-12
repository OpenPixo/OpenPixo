import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectWritePath } from '../../projects.js';
import { assetRelPath, hashAssetFile } from '../paths.js';

export const hashFile = hashAssetFile;

/** Same symlink-aware boundary as media dispatch, with an explicit root and no DB. */
export async function assetPath(root: string, relative: string): Promise<string> {
  return resolveProjectWritePath(root, 'asset-ops', assetRelPath(relative), { baseDir: root });
}

export async function occupied(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export class OccupiedOutputError extends Error {
  constructor(file: string) { super(`Output already exists: ${file}`); }
}

/** Validate every sibling before publishing; rollback only this batch's new files. */
export async function publishFiles(
  root: string,
  outputs: string[],
  produce: (temporaryPaths: string[]) => Promise<void>,
): Promise<Record<string, string>> {
  const targets = await Promise.all(outputs.map(file => assetPath(root, file)));
  if (new Set(targets).size !== targets.length) throw new Error('Outputs collide');
  for (let i = 0; i < targets.length; i++) {
    if (await occupied(targets[i]!)) throw new OccupiedOutputError(outputs[i]!);
  }
  const temporary = targets.map(file => `${file}.pixo-${randomUUID()}.tmp${path.extname(file)}`);
  // A pre-existing temporary name belongs to somebody else, including during cleanup.
  for (const file of temporary) if (await occupied(file)) throw new Error('Temporary output already exists');
  const published: string[] = [];
  try {
    for (const target of targets) await mkdir(path.dirname(target), { recursive: true });
    // Recheck after mkdir so existing or newly introduced symlink escapes fail closed.
    for (let i = 0; i < targets.length; i++) {
      if (await assetPath(root, outputs[i]!) !== targets[i]) throw new Error('Output path changed');
    }
    await produce(temporary);
    const hashes: Record<string, string> = {};
    for (let i = 0; i < temporary.length; i++) {
      const info = await stat(temporary[i]!);
      if (!info.isFile() || info.size === 0) throw new Error('Tool produced an empty or unreadable output');
      hashes[outputs[i]!] = await hashFile(temporary[i]!);
    }
    for (let i = 0; i < targets.length; i++) {
      if (await assetPath(root, outputs[i]!) !== targets[i]) throw new Error('Output path changed');
      try {
        // Node rename replaces destinations. link + unlink is a no-replace sibling move.
        await link(temporary[i]!, targets[i]!);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new OccupiedOutputError(outputs[i]!);
        throw error;
      }
      published.push(targets[i]!);
    }
    return hashes;
  } catch (error) {
    await Promise.all(published.map(file => unlink(file)));
    throw error;
  } finally {
    await Promise.all(temporary.map(file => unlink(file).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    })));
  }
}

export const writeNew = (file: string, body: Buffer | string): Promise<void> => writeFile(file, body, { flag: 'wx' });

export function numberParam(params: Record<string, unknown>, key: string, fallback?: number, min = 0, max = 8192): number {
  const value = params[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be a number from ${min} to ${max}`);
  return value;
}

export function integerParam(params: Record<string, unknown>, key: string, fallback?: number, min = 0, max = 8192): number {
  const value = numberParam(params, key, fallback, min, max);
  if (!Number.isInteger(value)) throw new Error(`${key} must be an integer`);
  return value;
}

export function choiceParam<T extends string>(params: Record<string, unknown>, key: string, choices: readonly T[], fallback?: T): T {
  const value = params[key] ?? fallback;
  if (!choices.includes(value as T)) throw new Error(`${key} must be ${choices.join(' or ')}`);
  return value as T;
}
