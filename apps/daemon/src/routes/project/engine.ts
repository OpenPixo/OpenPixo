import type { Express, Request, Response } from 'express';
import type { EngineProfileResponse } from '@openpixo/contracts';
import { readAppConfig } from '../../app-config.js';
import { getProject, updateProject } from '../../db.js';
import { detectEngineProfile, ENGINE_DETECTOR_VERSION } from '../../game/engine-detect.js';
import { publicErrorMessage } from '../../http/api-errors.js';
import { resolveProjectDir } from '../../projects.js';
import type { RouteDeps } from '../../server-context.js';

export interface RegisterProjectEngineRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest'> {}

export function registerProjectEngineRoutes(app: Express, ctx: RegisterProjectEngineRoutesDeps): void {
  const { sendApiError, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  async function respond(req: Request, res: Response, refresh: boolean): Promise<void> {
    try {
      const id = String(req.params.id);
      const project = getProject(ctx.db, id);
      if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
      if (!await ctx.authorizeProjectRequest(req, res, id, { mode: 'read' })) return;
      if (refresh && !isLocalSameOrigin(req, resolvedPortRef.current)) {
        sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return;
      }
      let profile = project.metadata?.engineProfile;
      // An unknown engine is not an answer to keep: a new game gets one when it is built.
      if (refresh || !profile || profile.engine === 'unknown' || profile.detectorVersion !== ENGINE_DETECTOR_VERSION) {
        const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
        // resolveProjectDir applies the same sandbox/import-root guard as project file reads.
        const dir = resolveProjectDir(ctx.paths.PROJECTS_DIR, id, project.metadata);
        profile = detectEngineProfile(dir, { enginePaths: config.gameEnginePaths ?? {} });
        // Config loading is asynchronous: preserve any metadata written while it was read.
        const latest = getProject(ctx.db, id);
        if (!latest) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
        updateProject(ctx.db, id, { metadata: { kind: 'other', ...latest.metadata, engineProfile: profile } });
      }
      const body: EngineProfileResponse = { profile };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (error) {
      sendApiError(res, 400, 'BAD_REQUEST', publicErrorMessage(error));
    }
  }
  app.get('/api/projects/:id/engine', requireLocalDaemonRequest, (req, res) => respond(req, res, false));
  app.post('/api/projects/:id/engine/refresh', requireLocalDaemonRequest, (req, res) => respond(req, res, true));
}
