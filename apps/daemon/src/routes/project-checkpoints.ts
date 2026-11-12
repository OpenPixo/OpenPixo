import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import type { Express, Request, Response } from 'express';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { toolTokenRegistry } from '../tool-tokens.js';
import { getProject } from '../db.js';
import { recordRestoredProjectFileVersion } from '../project-file-versions.js';
import { resolveProjectDir } from '../projects.js';
import { checkpointStore } from '../projects/checkpoint-store.js';
import { CheckpointError, ProjectCheckpoints } from '../projects/checkpoints.js';
import type { HttpDeps, PathDeps, RouteDeps } from '../server-context.js';
import type { CheckpointFileChange, GetProjectCheckpointDiffResponse, GetProjectCheckpointFileDiffResponse } from '@openpixo/contracts';

export interface RegisterProjectCheckpointRoutesDeps extends RouteDeps<'db' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  http: Pick<HttpDeps, 'requireLocalDaemonRequest' | 'sendApiError' | 'isLocalSameOrigin' | 'resolvedPortRef'>;
  paths: Pick<PathDeps, 'PROJECTS_DIR' | 'RUNTIME_DATA_DIR'>;
  isProjectBusy: (projectId: string) => boolean;
}

/** The HTTP boundary authorizes the selected project before reading any Git data. */
export function registerProjectCheckpointRoutes(app: Express, ctx: RegisterProjectCheckpointRoutesDeps): void {
  const { requireLocalDaemonRequest, sendApiError, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  type Action = 'list' | 'show' | 'restore' | 'enable' | 'diff' | 'file';
  async function respond(req: Request, res: Response, action: Action): Promise<void> {
    const projectId = String(req.params.id);
    const writes = action === 'restore' || action === 'enable';
    try {
      const token = bearerTokenFromRequest(req);
      const mode = writes ? { mode: 'write' as const, capability: 'writeFiles' as const } : { mode: 'read' as const };
      if (token?.startsWith('pixott_')) {
        const validation = toolTokenRegistry.validate(token, { endpoint: req.route.path, operation: writes ? 'checkpoint:write' : 'checkpoint:read' });
        if (!validation.ok || validation.grant.projectId !== projectId) {
          sendApiError(res, 403, 'FORBIDDEN', 'A checkpoint token for this project is required'); return;
        }
        if (!await ctx.authorizeProjectToolRequest(res, projectId, mode)) return;
      } else {
        if (writes && !isLocalSameOrigin(req, resolvedPortRef.current)) {
          sendApiError(res, 403, 'FORBIDDEN', 'Local origin required'); return;
        }
        if (!await ctx.authorizeProjectRequest(req, res, projectId, mode)) return;
      }
      const project = getProject(ctx.db, projectId);
      if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found'); return; }
      if (writes && req.body?.confirmed !== true) {
        sendApiError(res, 400, 'CHECKPOINT_CONFIRM_REQUIRED', 'Confirm this project change first'); return;
      }
      const folder = resolveProjectDir(ctx.paths.PROJECTS_DIR, projectId, project.metadata);
      const checkpoints = new ProjectCheckpoints(folder, undefined, checkpointStore(ctx.paths.RUNTIME_DATA_DIR, projectId));
      if (writes && ctx.isProjectBusy(projectId)) {
        sendApiError(res, 409, 'CHECKPOINT_BUSY', 'Wait for the project agent runs to finish'); return;
      }
      res.setHeader('Cache-Control', 'no-store');
      if (action === 'list') {
        const result = await checkpoints.list();
        if (result.status === 'available' && typeof req.query.runId === 'string') {
          result.checkpoints = result.checkpoints.filter(checkpoint => checkpoint.runId === req.query.runId);
        }
        if (result.status === 'available') result.busy ||= ctx.isProjectBusy(projectId);
        res.json(result);
      } else if (action === 'show') {
        const result = await checkpoints.show(String(req.params.checkpointId));
        result.busy ||= ctx.isProjectBusy(projectId);
        res.json(result);
      }
      else if (action === 'diff') res.json(await checkpointDiff(checkpoints, String(req.params.checkpointId), req.query.path));
      else if (action === 'file') await sendCheckpointFile(res, checkpoints, String(req.params.checkpointId), req.query.path, req.query.side);
      else if (action === 'restore') {
        const restored = await checkpoints.restore(String(req.params.checkpointId));
        await recordRestoredVersions(ctx.paths.PROJECTS_DIR, projectId, project.metadata, folder, restored.restoredFiles);
        res.json(restored);
      }
      else res.json(await checkpoints.enable());
    } catch (error) {
      if (error instanceof CheckpointError) {
        sendApiError(res, checkpointErrorStatus(error.code), error.code, error.message);
      } else {
        console.warn('[checkpoints] project operation failed', { projectId, action, error });
        sendApiError(res, 500, 'CHECKPOINT_FAILED', 'Could not complete the checkpoint operation');
      }
    }
  }
  const base = '/api/projects/:id/checkpoints';
  app.get(base, requireLocalDaemonRequest, (req, res) => respond(req, res, 'list'));
  app.get(`${base}/:checkpointId`, requireLocalDaemonRequest, (req, res) => respond(req, res, 'show'));
  app.get(`${base}/:checkpointId/diff`, requireLocalDaemonRequest, (req, res) => respond(req, res, 'diff'));
  app.get(`${base}/:checkpointId/file`, requireLocalDaemonRequest, (req, res) => respond(req, res, 'file'));
  app.post(`${base}/:checkpointId/restore`, requireLocalDaemonRequest, (req, res) => respond(req, res, 'restore'));
  app.post(`${base}/enable`, requireLocalDaemonRequest, (req, res) => respond(req, res, 'enable'));
}

/** The files are already back by now, so a history that cannot be updated never fails the undo. */
async function recordRestoredVersions(projectsRoot: string, projectId: string, metadata: unknown, folder: string, restoredFiles: readonly CheckpointFileChange[]): Promise<void> {
  for (const change of restoredFiles) {
    if (change.status === 'deleted' || !/\.html?$/i.test(change.path)) continue;
    try {
      const content = await readFile(nodePath.join(folder, change.path), 'utf8');
      await recordRestoredProjectFileVersion(projectsRoot, projectId, change.path, content, metadata);
    } catch (error) {
      console.warn('[checkpoints] could not update version history after undo', { projectId, path: change.path, error });
    }
  }
}

function checkpointErrorStatus(code: CheckpointError['code']): number {
  switch (code) {
    case 'CHECKPOINT_NOT_FOUND': case 'CHECKPOINT_FILE_NOT_CHANGED': case 'CHECKPOINT_FILE_ABSENT': return 404;
    case 'CHECKPOINT_PATH_INVALID': return 400;
    case 'CHECKPOINT_FILE_TOO_LARGE': return 413;
    default: return 409;
  }
}

function invalidQuery(message: string): CheckpointError {
  return new CheckpointError('CHECKPOINT_PATH_INVALID', message);
}

/** With `?path=`, that one file's diff; without it, every file the run changed. */
async function checkpointDiff(checkpoints: ProjectCheckpoints, checkpointId: string, path: unknown): Promise<GetProjectCheckpointDiffResponse | GetProjectCheckpointFileDiffResponse> {
  if (path !== undefined && typeof path !== 'string') throw invalidQuery('Pass one path');
  const result = await checkpoints.diff(checkpointId, path);
  if (path === undefined) return { checkpointId, ...result };
  return { checkpointId, target: result.target, ...result.files[0]! };
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
};

/** One file version as raw bytes. Never rendered as a document on the daemon origin. */
async function sendCheckpointFile(res: Response, checkpoints: ProjectCheckpoints, checkpointId: string, path: unknown, side: unknown): Promise<void> {
  if (typeof path !== 'string') throw invalidQuery('Pass the file path');
  if (side !== 'before' && side !== 'after') throw invalidQuery('Pass side=before or side=after');
  const version = await checkpoints.fileVersion(checkpointId, path, side);
  const extension = version.path.split('.').pop()?.toLowerCase() ?? '';
  const type = IMAGE_TYPES[extension];
  res.setHeader('Content-Type', type ?? 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Checkpoint-Diff-Target', version.target);
  if (!type) res.setHeader('Content-Disposition', 'attachment');
  res.send(version.bytes);
}
