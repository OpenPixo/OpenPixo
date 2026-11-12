import { getProject } from '../db.js';
import { ensureProject } from '../projects.js';
import type { RunAnalyticsFacts } from '../services/run-analytics-lifecycle.js';
import type { CheckpointStore } from './checkpoint-store.js';
import { markCheckpointRunActive, ProjectCheckpoints } from './checkpoints.js';

export interface CheckpointRun {
  id: string;
  projectId?: string | null;
  conversationId?: string | null;
  status: string;
  cancelRequested?: boolean;
}

/**
 * The folder a run works in. A managed project has no folder until its first
 * file, and the snapshot of its first run happens before that, so it is created
 * here. An imported folder is the user's own and is never created.
 */
export function checkpointProjectDirectoryResolver(ctx: { db: Parameters<typeof getProject>[0]; PROJECTS_DIR: string }) {
  return async (projectId: string): Promise<string | null> => {
    const project = getProject(ctx.db, projectId);
    return project ? ensureProject(ctx.PROJECTS_DIR, projectId, project.metadata) : null;
  };
}

/** The registry remains authoritative even if snapshot preparation failed. */
export function checkpointProjectBusyReader(runs: { list: (filter: { projectId: string; status: string }) => unknown[] }) {
  return (projectId: string): boolean => runs.list({ projectId, status: 'active' }).length > 0;
}

interface RunCheckpointDependencies {
  projectDirectory: (projectId: string) => string | null | Promise<string | null>;
  /** Where the checkpoints of a project without its own repository live. */
  store?: (projectId: string) => CheckpointStore;
  runs: { wait: (run: CheckpointRun) => Promise<unknown>; isTerminal: (status: string) => boolean };
  warn?: (message: string, detail: unknown) => void;
}

/**
 * Preparation finishes before cwd writes. Completion follows the registry's
 * physical terminal signal, since a starter may resolve immediately after spawn.
 * Snapshot failures are observers: they can never reject or suppress the run.
 */
export function createRunCheckpointHook(deps: RunCheckpointDependencies) {
  const warn = deps.warn ?? ((message, detail) => console.warn(message, detail));
  return async (run: CheckpointRun, facts: RunAnalyticsFacts, starter: () => Promise<unknown>): Promise<unknown> => {
    if (!run.projectId) return starter();
    let folder: string | null = null;
    let checkpointId: string | null = null;
    let release: (() => void) | undefined;
    const store = deps.store?.(run.projectId);
    try {
      folder = await deps.projectDirectory(run.projectId);
      if (folder) {
        release = await markCheckpointRunActive(folder);
        const body = facts.body;
        const summary = typeof body.currentPrompt === 'string' ? body.currentPrompt : typeof body.message === 'string' ? body.message : '';
        const checkpoint = await new ProjectCheckpoints(folder, AbortSignal.timeout(20_000), store).snapshot({
          runId: run.id, conversationId: run.conversationId ?? null, summary,
        });
        checkpointId = checkpoint?.id ?? null;
      }
    } catch (error) { warn('[checkpoints] automatic snapshot failed; continuing agent run', { runId: run.id, error }); }

    let completion: Promise<void> | undefined;
    const finish = (): Promise<void> => {
      completion ??= (async () => {
        try {
          if (folder && checkpointId) await new ProjectCheckpoints(folder, AbortSignal.timeout(20_000), store).finish(checkpointId);
        } catch (error) { warn('[checkpoints] could not record completed run changes', { runId: run.id, error }); }
        finally { release?.(); }
      })();
      return completion;
    };
    // Register before calling the starter, including synchronous first-tick failures.
    const terminal = deps.runs.wait(run);
    if (run.cancelRequested || deps.runs.isTerminal(run.status)) { await finish(); return; }
    let result: unknown;
    try { result = await starter(); }
    catch (error) { await finish(); throw error; }
    try { await terminal; }
    catch (error) { warn('[checkpoints] could not observe run completion', { runId: run.id, error }); }
    await finish();
    return result;
  };
}
