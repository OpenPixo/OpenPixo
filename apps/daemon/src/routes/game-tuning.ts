import type { Express, Request, Response } from 'express';
import type { GameTuningSetRequest } from '@openpixo/contracts';
import { getProject } from '../db.js';
import { discoverGameTuning, GameTuningError, setGameTuningValue } from '../game/tuning.js';
import { checkpointStore } from '../projects/checkpoint-store.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { resolveProjectDir } from '../projects.js';
import type { RouteDeps } from '../server-context.js';
import { toolTokenRegistry } from '../tool-tokens.js';

export type RegisterGameTuningRoutesDeps = RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'>;

export function registerGameTuningRoutes(app: Express, ctx: RegisterGameTuningRoutesDeps): void {
  const { sendApiError, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  function error(res: Response, caught: unknown): void {
    const code = caught instanceof GameTuningError ? caught.code : 'TUNING_READ_FAILED';
    const status = code === 'TUNING_CONFLICT' ? 409 : code === 'TUNING_NOT_FOUND' ? 404 : code === 'TUNING_UNSAFE_PATH' ? 403
      : code === 'TUNING_INVALID_VALUE' || code === 'TUNING_INVALID_REQUEST' ? 400 : 500;
    sendApiError(res, status, code, caught instanceof GameTuningError ? caught.message : 'Tuning source is unavailable');
  }
  async function authorize(req: Request, res: Response, write: boolean): Promise<string | null> {
    const id = String(req.params.id);
    const mode = write ? { mode: 'write' as const, capability: 'writeFiles' as const } : { mode: 'read' as const };
    const token = bearerTokenFromRequest(req);
    if (token?.startsWith('pixott_')) {
      const validation = toolTokenRegistry.validate(token, { operation: write ? 'game:tuning:write' : 'game:tuning:read', endpoint: req.route.path });
      if (!validation.ok || validation.grant.projectId !== id) {
        sendApiError(res, 403, 'FORBIDDEN', 'A tuning token for this project is required'); return null;
      }
      if (!await ctx.authorizeProjectToolRequest(res, id, mode)) return null;
    } else {
      if (write && !isLocalSameOrigin(req, resolvedPortRef.current)) {
        sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return null;
      }
      if (!await ctx.authorizeProjectRequest(req, res, id, mode)) return null;
    }
    const project = getProject(ctx.db, id);
    if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return null; }
    return resolveProjectDir(ctx.paths.PROJECTS_DIR, id, project.metadata);
  }
  app.get('/api/projects/:id/game/tuning', requireLocalDaemonRequest, async (req, res) => {
    try {
      const root = await authorize(req, res, false); if (!root) return;
      res.setHeader('Cache-Control', 'no-store'); res.json(await discoverGameTuning(root));
    } catch (caught) { error(res, caught); }
  });
  app.patch('/api/projects/:id/game/tuning', requireLocalDaemonRequest, async (req, res) => {
    try {
      const root = await authorize(req, res, true); if (!root) return;
      const body: unknown = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['id', 'value', 'fileHash'].includes(key))
        || !['number', 'boolean', 'string'].includes(typeof (body as GameTuningSetRequest).value)) {
        throw new GameTuningError('TUNING_INVALID_REQUEST', 'A literal value, parameter id and file hash are required');
      }
      res.setHeader('Cache-Control', 'no-store'); res.json(await setGameTuningValue(root, body as GameTuningSetRequest, { checkpointStore: checkpointStore(ctx.paths.RUNTIME_DATA_DIR, String(req.params.id)) }));
    } catch (caught) { error(res, caught); }
  });
}
