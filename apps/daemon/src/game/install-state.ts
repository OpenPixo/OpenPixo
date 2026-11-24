import { mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * `idle`: no install OpenPixo started is under way or was left half done.
 * `running`: one is under way, in this process or in another (an agent's CLI).
 * `unfinished`: one was cut short, so what is in `node_modules` cannot be trusted.
 */
export type GameInstallState = 'idle' | 'running' | 'unfinished';

interface InstallNote {
  /** The process that installs; 0 once its install was stopped. */
  pid: number;
  startedAt: number;
  /** There was no `node_modules` before, so all of it is this install's. */
  fresh: boolean;
}

/** Longer than any install may take; a note older than this belongs to a process that is gone. */
const NOTE_LIFETIME_MS = 10 * 60_000;
const POLL_MS = 250;

/**
 * The note lies in `node_modules` from the start of an install to its end, so it goes
 * wherever the packages go and an agent's sandbox can read and write it. npm and pnpm
 * leave it alone. A package's folder exists long before its files do, and npm takes a
 * half-written one for an installed one, so nothing else on disk tells them apart.
 */
const notePath = (cwd: string) => path.join(cwd, 'node_modules', '.openpixo-install.json');

async function readNote(cwd: string): Promise<InstallNote | null> {
  let text: string;
  try { text = await readFile(notePath(cwd), 'utf8'); } catch { return null; }
  try {
    const { pid, startedAt, fresh } = JSON.parse(text) as Partial<InstallNote>;
    if (Number.isInteger(pid) && Number.isFinite(startedAt)) return { pid: pid!, startedAt: startedAt!, fresh: fresh === true };
  } catch { /* cut off while it was written */ }
  return { pid: 0, startedAt: 0, fresh: false };
}

function alive(pid: number): boolean {
  if (pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  // A process that may not be signalled (another user, a sandbox) is still a process.
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function stateOf(note: InstallNote | null): GameInstallState {
  if (!note) return 'idle';
  return alive(note.pid) && Date.now() - note.startedAt < NOTE_LIFETIME_MS ? 'running' : 'unfinished';
}

export async function gameInstallState(cwd: string): Promise<GameInstallState> {
  return stateOf(await readNote(cwd));
}

/** Resolves once no install is under way in this folder; at once when none is. */
export async function waitForGameInstall(cwd: string, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted && await gameInstallState(cwd) === 'running') await delay(POLL_MS);
}

/**
 * Waits for an install already under way, then notes a new one. Packages that an
 * unfinished first install left are removed, so the new one writes every file.
 * Call the result with how it ended; `cut-short` is an install that did not end by itself.
 */
export async function beginGameInstall(cwd: string, signal?: AbortSignal): Promise<(end: 'installed' | 'failed' | 'cut-short') => Promise<void>> {
  const modules = path.join(cwd, 'node_modules');
  for (;;) {
    await waitForGameInstall(cwd, signal);
    try {
      const left = await readNote(cwd);
      if (stateOf(left) === 'running') { if (signal?.aborted) return async () => {}; continue; }
      // A file that is in use stays, and the install writes the rest around it.
      if (left?.fresh) await rm(modules, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
      if (left) await rm(notePath(cwd), { force: true });
      const fresh = left?.fresh === true || !await stat(modules).then(() => true, () => false);
      await mkdir(modules, { recursive: true });
      const note: InstallNote = { pid: process.pid, startedAt: Date.now(), fresh };
      // Two installs may get here together; only one of them can create the note.
      await writeFile(notePath(cwd), JSON.stringify(note), { flag: 'wx' });
      return async end => {
        try {
          if (end === 'cut-short') { await writeFile(notePath(cwd), JSON.stringify({ ...note, pid: 0 })); return; }
          await rm(notePath(cwd), { force: true });
          if (end === 'failed' && fresh) await rmdir(modules); // only when nothing was put there
        } catch { /* the note is gone with the folder, or the folder is in use */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST' && await readNote(cwd)) continue;
      // A folder the note cannot be written to (read-only, odd permissions) must not stop an install.
      return async () => {};
    }
  }
}
