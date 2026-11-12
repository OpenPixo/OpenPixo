import type { Express } from 'express';
import { PRODUCT_CLI_NAME, parseGamePlaytestRequest } from '@openpixo/contracts';
import { readAppConfig } from '../app-config.js';
import { getProject } from '../db.js';
import { resolveProjectDir } from '../projects.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import type { RegisterGameVerifyRoutesDeps } from '../routes/game-verify.js';
import { detectEngineProfile } from './engine-detect.js';
import { gameToolResolver } from './verify.js';
import { gameVerifyArtifactDir, registerGameVerifyResult } from './verify-store.js';
import { playtestGame } from './playtest.js';

/** UI execution only. Agent callers use verify context/capture/register and execute in their CLI sandbox. */
export function registerGamePlaytestRoutes(app: Express, ctx: RegisterGameVerifyRoutesDeps): void {
  const { requireLocalDaemonRequest, sendApiError, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  app.post('/api/projects/:id/game/playtest', requireLocalDaemonRequest, async (req, res) => {
    if (bearerTokenFromRequest(req)?.startsWith('pixott_')) {
      sendApiError(res, 403, 'FORBIDDEN', 'Agent playtesting must execute inside the ' + PRODUCT_CLI_NAME + ' CLI process'); return;
    }
    if (!isLocalSameOrigin(req, resolvedPortRef.current)) { sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return; }
    try {
      const id = String(req.params.id), project = getProject(ctx.db, id);
      if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
      if (!await ctx.authorizeProjectRequest(req, res, id, { mode: 'write', capability: 'writeFiles' })) return;
      const request = parseGamePlaytestRequest(req.body ?? {});
      const projectDir = resolveProjectDir(ctx.paths.PROJECTS_DIR, id, project.metadata);
      const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
      const artifactDir = gameVerifyArtifactDir(ctx.paths.ARTIFACTS_DIR, id);
      const result = await playtestGame({ projectDir, artifactDir, request,
        profile: detectEngineProfile(projectDir, config.gameEnginePaths ? { enginePaths: config.gameEnginePaths } : {}),
        resolveTool: gameToolResolver({ ...config.gameEnginePaths }), ...(ctx.captureGameWeb ? { captureWeb: ctx.captureGameWeb } : {}) });
      res.json(await registerGameVerifyResult(artifactDir, result));
    } catch (error) { sendApiError(res, 400, 'BAD_REQUEST', error instanceof Error ? error.message : String(error)); }
  });
}
