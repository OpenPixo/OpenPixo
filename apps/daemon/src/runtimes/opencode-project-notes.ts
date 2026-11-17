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
 * OpenCode reads an instructions file again for every request and puts it at the
 * top of the system prompt, so any change to it makes the provider's prompt cache
 * miss for the whole conversation. The agent is asked to update the notes at the
 * end of a turn, so a copy refreshed every turn made the first request of the
 * next turn a full miss (124k-161k uncached tokens a turn in a real build). The
 * copy is therefore a snapshot per conversation: taken when the agent session
 * starts, kept while that session is resumed, and taken again only when a new
 * session starts (which re-sends the whole prompt anyway). A turn that resumes on
 * a snapshot older than the file learns it through `renderProjectNotesTurnNote`
 * in the per-turn slice, after the cached prefix.
 */

/** The names OpenCode looks for, in its order; the first one present wins. */
export const OPENCODE_PROJECT_NOTE_FILES = ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md'] as const;

/** Larger files are left out rather than sent on every request. */
export const OPENCODE_PROJECT_NOTES_MAX_BYTES = 64 * 1024;

/** Marks a snapshot taken when the project had no notes, so a resumed session keeps having none. */
const NO_NOTES_MARKER = '.none';

const PLAIN_ID = /^[A-Za-z0-9._-]+$/u;

export interface StageOpenCodeProjectNotesInput {
  /** The resolved daemon data root (`RUNTIME_DATA_DIR`). */
  dataDir: string;
  projectId: string;
  /** The project's own folder; null when the run has none. */
  projectDir: string | null;
  /** The conversation the run belongs to; null stages a fresh copy for this run only. */
  conversationId?: string | null | undefined;
  /** True when the run resumes an agent session that already holds the snapshot. */
  resumingSession?: boolean | undefined;
}

export interface StagedOpenCodeProjectNotes {
  /** The `instructions` entries for the run's config. */
  files: string[];
  /**
   * The notes file whose text differs from what the session's instructions show,
   * or null when they agree. Set only on a resumed session.
   */
  changedSinceSnapshot: string | null;
}

const NOTHING: StagedOpenCodeProjectNotes = { files: [], changedSinceSnapshot: null };

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
 * Give this run the project's notes as its session first saw them, and return
 * the `instructions` entries for its config. Empty when there are no notes or the
 * copy failed: the run then starts without them, as it did before.
 */
export async function stageOpenCodeProjectNotes(input: StageOpenCodeProjectNotesInput): Promise<StagedOpenCodeProjectNotes> {
  if (!input.projectDir || !PLAIN_ID.test(input.projectId)) return NOTHING;
  try {
    const current = await readOpenCodeProjectNotes(input.projectDir);
    const conversation = typeof input.conversationId === 'string' && PLAIN_ID.test(input.conversationId)
      ? input.conversationId
      : null;
    const projectRoot = path.join(input.dataDir, 'agent-runtime', 'opencode', 'project-notes', input.projectId);
    const dir = conversation ? path.join(projectRoot, conversation) : path.join(projectRoot, `run-${randomUUID()}`);
    if (conversation && input.resumingSession) {
      const kept = await readSnapshot(dir);
      if (kept === 'none') {
        return { files: [], changedSinceSnapshot: current ? current.name : null };
      }
      if (kept) {
        const changed = !current || current.name !== kept.name || current.content !== kept.content;
        return { files: [kept.file], changedSinceSnapshot: changed ? (current?.name ?? kept.name) : null };
      }
      // No snapshot for this session (taken by an older daemon): take one now.
    }
    return { files: await writeSnapshot(dir, current), changedSinceSnapshot: null };
  } catch {
    return NOTHING;
  }
}

async function readSnapshot(dir: string): Promise<{ file: string; name: string; content: string } | 'none' | null> {
  for (const name of OPENCODE_PROJECT_NOTE_FILES) {
    const file = path.join(dir, name);
    const content = await readFile(file, 'utf8').catch(() => null);
    if (content !== null) return { file, name, content };
  }
  if (await readFile(path.join(dir, NO_NOTES_MARKER)).then(() => true, () => false)) return 'none';
  return null;
}

async function writeSnapshot(dir: string, notes: { name: string; content: string } | null): Promise<string[]> {
  const keep = notes ? notes.name : NO_NOTES_MARKER;
  for (const name of [...OPENCODE_PROJECT_NOTE_FILES, NO_NOTES_MARKER]) {
    if (name !== keep) await rm(path.join(dir, name), { force: true });
  }
  const file = path.join(dir, keep);
  const content = notes ? notes.content : '';
  if (await readFile(file, 'utf8').catch(() => null) !== content) {
    await mkdir(dir, { recursive: true });
    // Atomic replacement: another run of this conversation may be reading it.
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { flag: 'wx' });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return notes ? [file] : [];
}
