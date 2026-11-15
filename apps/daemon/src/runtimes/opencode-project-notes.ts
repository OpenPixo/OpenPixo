import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * A game's project notes for OpenCode, the way OpenCode would load them itself.
 *
 * OpenCode reads the first of `AGENTS.md`, `CLAUDE.md` and `CONTEXT.md` it finds
 * into every request's instructions. The daemon sets
 * `OPENCODE_DISABLE_PROJECT_CONFIG` (see `env.ts`) to stop OpenCode running
 * `bun install` in a pnpm workspace, and in OpenCode 1.18 that flag also skips
 * this lookup. Without it every new conversation rediscovers the project from
 * nothing, which on a large game took 25+ requests of listing and searching.
 *
 * The notes come back through the run's config `instructions`, which OpenCode
 * adds to the user's own instead of replacing them. Only the project folder is
 * searched, never its parents: a project with no folder of its own runs in the
 * OpenPixo checkout, whose notes are not the game's.
 *
 * OpenCode reads an instructions file again for every request, and a change at
 * the top of the conversation makes the provider's prompt cache miss for the
 * rest of the turn. So the run gets a copy taken when it starts, kept at one
 * path per project under the daemon data root: a turn that edits the notes
 * changes what the next turn reads, never the requests of its own turn, and an
 * unchanged file reads the same on every turn.
 */

/** The names OpenCode looks for, in its order; the first one present wins. */
export const OPENCODE_PROJECT_NOTE_FILES = ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md'] as const;

/** Larger files are left out rather than sent on every request. */
export const OPENCODE_PROJECT_NOTES_MAX_BYTES = 64 * 1024;

export interface StageOpenCodeProjectNotesInput {
  /** The resolved daemon data root (`RUNTIME_DATA_DIR`). */
  dataDir: string;
  projectId: string;
  /** The project's own folder; null when the run has none. */
  projectDir: string | null;
}

/** The project's notes file, or null when it has none OpenCode would load. */
export async function readOpenCodeProjectNotes(projectDir: string): Promise<{ name: string; content: string } | null> {
  for (const name of OPENCODE_PROJECT_NOTE_FILES) {
    const content = await readFile(path.join(projectDir, name)).catch(() => null);
    if (content === null) continue;
    if (content.byteLength > OPENCODE_PROJECT_NOTES_MAX_BYTES) return null;
    return { name, content: content.toString('utf8') };
  }
  return null;
}

/**
 * Copy the project's notes to the path this run's OpenCode reads, and return the
 * `instructions` entries for its config. Empty when there are no notes or the
 * copy failed: the run then starts without them, as it did before.
 */
export async function stageOpenCodeProjectNotes(input: StageOpenCodeProjectNotesInput): Promise<string[]> {
  if (!input.projectDir || !/^[A-Za-z0-9._-]+$/u.test(input.projectId)) return [];
  try {
    const notes = await readOpenCodeProjectNotes(input.projectDir);
    if (!notes) return [];
    const dir = path.join(input.dataDir, 'agent-runtime', 'opencode', 'project-notes', input.projectId);
    const file = path.join(dir, notes.name);
    if (await readFile(file, 'utf8').catch(() => null) !== notes.content) {
      await mkdir(dir, { recursive: true });
      // Atomic replacement: another run of this project may be reading it.
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, notes.content, { flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    return [file];
  } catch {
    return [];
  }
}
