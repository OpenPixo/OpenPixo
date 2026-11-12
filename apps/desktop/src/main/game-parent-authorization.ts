import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;

/** Canonicalize existing ancestors without creating any directories. */
async function prospectiveDirectory(value: string): Promise<string> {
  try {
    const entry = await lstat(value);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) throw new Error('Game parent must be a directory');
    return await realpath(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(value);
    if (parent === value) throw error;
    return path.join(await prospectiveDirectory(parent), path.basename(value));
  }
}

/** A renderer may create exactly the default root or one child of an authorized parent. */
export class GameParentAuthorization {
  private readonly picked = new Set<string>();
  constructor(private readonly defaultGamesRoot: string) {}

  async recordPickedParent(value: string): Promise<void> {
    const canonical = await realpath(value);
    if (!(await lstat(canonical)).isDirectory()) throw new Error('Picked parent must be a directory');
    this.picked.add(key(canonical));
  }

  async authorizeCreate(input: unknown): Promise<string> {
    const value = input as { baseDir?: unknown; createParent?: unknown } | null;
    if (value?.createParent !== true || typeof value.baseDir !== 'string' || value.baseDir.includes('\0') || !path.isAbsolute(value.baseDir)) {
      throw new Error('Explicit creation of an absolute game parent is required');
    }
    const requested = path.resolve(value.baseDir);
    const defaultRoot = path.resolve(this.defaultGamesRoot);
    const defaultCanonical = path.join(await prospectiveDirectory(path.dirname(defaultRoot)), path.basename(defaultRoot));
    const parent = await prospectiveDirectory(path.dirname(requested));
    const expected = path.join(parent, path.basename(requested));
    // A folder the user picked in this run stays authorized: its token is
    // short-lived and single-use, and Home spends it only when the message is sent.
    const pickedItself = this.picked.has(key(expected));
    if (!pickedItself && key(requested) !== key(defaultRoot) && key(parent) !== key(defaultCanonical) && !this.picked.has(key(parent))) {
      throw new Error('Choose this parent with the folder picker first');
    }
    const canonical = await prospectiveDirectory(requested);
    if (key(canonical) !== key(expected) || (key(requested) === key(defaultRoot) && key(canonical) !== key(defaultCanonical))) {
      throw new Error('Game parent redirects outside the authorized path');
    }
    return canonical;
  }
}
