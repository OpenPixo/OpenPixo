import type Database from 'better-sqlite3';
import type { GameRunStatus } from '@openpixo/contracts';
import { getProject, updateProject } from '../db.js';

/** Persist observed readiness, never requested startup or saved checklist progress. */
export function recordProjectGameRun(db: Database.Database, projectId: string, state: GameRunStatus): void {
  if (state.status !== 'running') return;
  const project = getProject(db, projectId);
  if (!project || Number.isFinite(project.metadata?.gameRunSucceededAt)) return;
  updateProject(db, projectId, { metadata: { ...project.metadata,
    gameRunSucceededAt: typeof state.startedAt === 'number' && Number.isFinite(state.startedAt) ? state.startedAt : Date.now() } });
}
