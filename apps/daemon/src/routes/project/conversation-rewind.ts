import type { Express } from 'express';
import type Database from 'better-sqlite3';
import type {
  ListProjectCheckpointsResponse,
  RestoreProjectCheckpointResponse,
  RewindConversationFiles,
  RewindConversationRequest,
  RewindConversationResponse,
} from '@openpixo/contracts';
import { getProject } from '../../db.js';
import { isAgentToken } from '../../http/tool-request-auth.js';
import { resolveProjectDir } from '../../projects.js';
import { checkpointStore } from '../../projects/checkpoint-store.js';
import { CheckpointError, ProjectCheckpoints } from '../../projects/checkpoints.js';
import type { AuthorizeProjectRequest } from '../../projects/project-access.js';
import type { HttpDeps, PathDeps } from '../../server-context.js';

type SqliteDb = Database.Database;

/** The project's checkpoints, as far as a rewind needs them. */
export interface RewindCheckpoints {
  list(): Promise<ListProjectCheckpointsResponse>;
  restore(id: string): Promise<RestoreProjectCheckpointResponse>;
}

export interface RewindConversationDeps {
  db: SqliteDb;
  checkpoints: RewindCheckpoints;
}

export class RewindError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

interface MessageRow { id: string; role: string; runId: string | null }

/**
 * Takes a conversation back to just before one of the user's messages.
 *
 * What must hold afterwards:
 * - Files first, transcript second. A restore that fails leaves every message
 *   in place, so the user never loses the replies without getting the files
 *   back that they asked for.
 * - The message and everything after it are gone in one transaction.
 * - No agent session survives for the conversation. The resume guard would
 *   already refuse a session whose last reply was removed; clearing the rows
 *   says so outright, so the next turn is composed from the shortened
 *   transcript and the agent cannot remember the replies that were taken back.
 *
 * The caller has checked that no run in the project is active.
 */
export async function rewindConversation(
  deps: RewindConversationDeps,
  conversationId: string,
  input: RewindConversationRequest,
): Promise<RewindConversationResponse> {
  const rows = deps.db.prepare(
    `SELECT id, role, run_id AS runId FROM messages WHERE conversation_id = ? ORDER BY position ASC, created_at ASC`,
  ).all(conversationId) as MessageRow[];
  const index = rows.findIndex(row => row.id === input.fromMessageId);
  if (index < 0) throw new RewindError(404, 'MESSAGE_NOT_FOUND', 'No such message in this conversation');
  if (rows[index]!.role !== 'user') throw new RewindError(400, 'NOT_A_USER_MESSAGE', 'Only your own messages can be edited');
  const removed = rows.slice(index);

  const files = input.restoreFiles ? await restoreBefore(deps.checkpoints, removed) : { restored: false as const, reason: 'not_requested' as const };

  const ids = removed.map(row => row.id);
  deps.db.transaction(() => {
    const drop = deps.db.prepare(`DELETE FROM messages WHERE id = ? AND conversation_id = ?`);
    for (const id of ids) drop.run(id, conversationId);
    deps.db.prepare(`DELETE FROM agent_sessions WHERE conversation_id = ?`).run(conversationId);
    deps.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(Date.now(), conversationId);
  })();
  return { conversationId, removedMessageIds: ids, files };
}

/**
 * Restores the checkpoint taken when the first run after the message started:
 * the project as it was before the agent answered it. Later runs, in this
 * conversation or another, are undone with it, as the turn undo button does.
 */
async function restoreBefore(checkpoints: RewindCheckpoints, removed: readonly MessageRow[]): Promise<RewindConversationFiles> {
  const firstRunId = removed.find(row => row.role === 'assistant' && row.runId)?.runId;
  if (!firstRunId) return { restored: false, reason: 'nothing_to_undo' };
  const list = await checkpoints.list();
  if (list.status !== 'available') return { restored: false, reason: 'checkpoints_unavailable' };
  const checkpoint = list.checkpoints.find(item => item.kind === 'run' && item.runId === firstRunId);
  if (!checkpoint) return { restored: false, reason: 'no_checkpoint' };
  const result = await checkpoints.restore(checkpoint.id);
  return { restored: true, checkpointId: checkpoint.id, restoredFiles: result.restoredFiles };
}

export interface RegisterConversationRewindRoutesDeps {
  db: SqliteDb;
  http: Pick<HttpDeps, 'requireLocalDaemonRequest' | 'sendApiError' | 'isLocalSameOrigin' | 'resolvedPortRef'>;
  paths: Pick<PathDeps, 'PROJECTS_DIR' | 'RUNTIME_DATA_DIR'>;
  authorizeProjectRequest: AuthorizeProjectRequest;
  /** True while any run in the project is active; an agent's shell only exists during one. */
  isProjectBusy: (projectId: string) => boolean;
  /** Route tests replace the project's checkpoints. */
  checkpointsFor?: (projectId: string, folder: string) => RewindCheckpoints;
}

/**
 * `POST /api/projects/:id/conversations/:cid/rewind`, the one path behind
 * "Edit" on a sent message and `pixo conversation rewind`. Only the user takes
 * a conversation back: an agent's token is refused, and the route waits while
 * a run is active.
 */
export function registerConversationRewindRoutes(app: Express, ctx: RegisterConversationRewindRoutesDeps): void {
  const { http } = ctx;
  app.post('/api/projects/:id/conversations/:cid/rewind', http.requireLocalDaemonRequest, async (req, res) => {
    const projectId = String(req.params.id);
    const conversationId = String(req.params.cid);
    if (isAgentToken(req)) return http.sendApiError(res, 403, 'FORBIDDEN', 'Only the user can edit a sent message');
    if (!http.isLocalSameOrigin(req, http.resolvedPortRef.current)) return http.sendApiError(res, 403, 'FORBIDDEN', 'local origin required');
    if (!await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
    const project = getProject(ctx.db, projectId);
    if (!project) return http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    const conversation = ctx.db.prepare(`SELECT project_id AS projectId FROM conversations WHERE id = ?`).get(conversationId) as { projectId: string } | undefined;
    if (conversation?.projectId !== projectId) return http.sendApiError(res, 404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    const body = (req.body ?? {}) as Partial<RewindConversationRequest>;
    if (typeof body.fromMessageId !== 'string' || !body.fromMessageId) return http.sendApiError(res, 400, 'BAD_REQUEST', 'fromMessageId required');
    if (typeof body.restoreFiles !== 'boolean') return http.sendApiError(res, 400, 'BAD_REQUEST', 'restoreFiles must be true or false');
    if (ctx.isProjectBusy(projectId)) return http.sendApiError(res, 409, 'RUN_ACTIVE', 'Wait for the current run to finish');
    const folder = resolveProjectDir(ctx.paths.PROJECTS_DIR, projectId, project.metadata);
    const checkpoints = ctx.checkpointsFor?.(projectId, folder)
      ?? new ProjectCheckpoints(folder, undefined, checkpointStore(ctx.paths.RUNTIME_DATA_DIR, projectId));
    try {
      const result = await rewindConversation({ db: ctx.db, checkpoints }, conversationId, {
        fromMessageId: body.fromMessageId,
        restoreFiles: body.restoreFiles,
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(result);
    } catch (error) {
      if (error instanceof RewindError) return http.sendApiError(res, error.status, error.code, error.message);
      if (error instanceof CheckpointError) {
        return http.sendApiError(res, error.code === 'CHECKPOINT_NOT_FOUND' ? 404 : 409, error.code, error.message);
      }
      console.warn('[conversations] rewind failed', { projectId, conversationId, error });
      return http.sendApiError(res, 500, 'REWIND_FAILED', 'Could not take the conversation back');
    }
  });
}
