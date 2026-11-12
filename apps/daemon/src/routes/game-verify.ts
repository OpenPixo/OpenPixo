import { PRODUCT_CLI_NAME, GAME_SCREENSHOT_HOST_UNAVAILABLE } from '@openpixo/contracts';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import { GAME_VERIFY_STEPS, type GameVerifyContext, type GameVerifyRequest, type GameWebCaptureRequest } from '@openpixo/contracts';
import { readAppConfig } from '../app-config.js';
import { getProject } from '../db.js';
import { detectEngineProfile } from '../game/engine-detect.js';
import { gameLocalUrl, gameToolResolver, verifyGame, type GameWebCapture } from '../game/verify.js';
import { gameVerifyArtifact, gameVerifyArtifactDir, gameVerifyImage, registerGameVerifyResult } from '../game/verify-store.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { resolveProjectDir } from '../projects.js';
import type { RouteDeps } from '../server-context.js';
import { toolTokenRegistry, type ToolTokenGrant } from '../tool-tokens.js';

export interface RegisterGameVerifyRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  captureGameWeb?: GameWebCapture | null;
}

function parseRequest(body: unknown): GameVerifyRequest {
  const value = (body ?? {}) as GameVerifyRequest;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['steps', 'screenshot', 'runId'].includes(key))
    || (value.steps !== undefined && (!Array.isArray(value.steps) || value.steps.length > 3 || value.steps.some(step => !GAME_VERIFY_STEPS.includes(step))))
    || (value.screenshot !== undefined && typeof value.screenshot !== 'boolean')
    || (value.runId !== undefined && (typeof value.runId !== 'string' || value.runId.length > 200))) throw new Error('Invalid game verification request');
  return value;
}

export function registerGameVerifyRoutes(app: Express, ctx: RegisterGameVerifyRoutesDeps): void {
  const { sendApiError, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const error = (res: Response, caught: unknown) => sendApiError(res, 400, 'BAD_REQUEST', caught instanceof Error ? caught.message : String(caught));
  const agentToken = (req: Request) => bearerTokenFromRequest(req)?.startsWith('pixott_') === true;
  async function authorize(req: Request, res: Response, write: boolean): Promise<{ grant?: ToolTokenGrant } | null> {
    const id = String(req.params.id);
    if (!getProject(ctx.db, id)) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return null; }
    const mode = write ? { mode: 'write' as const, capability: 'writeFiles' as const } : { mode: 'read' as const };
    if (agentToken(req)) {
      const validation = toolTokenRegistry.validate(bearerTokenFromRequest(req), { operation: 'game:verify', endpoint: req.route.path });
      if (!validation.ok || validation.grant.projectId !== id) {
        sendApiError(res, 403, 'FORBIDDEN', 'A valid verification token for this project is required'); return null;
      }
      if (!await ctx.authorizeProjectToolRequest(res, id, mode)) return null;
      return { grant: validation.grant };
    }
    return await ctx.authorizeProjectRequest(req, res, id, mode) ? {} : null;
  }
  async function context(req: Request, grant?: ToolTokenGrant): Promise<GameVerifyContext> {
    const id = String(req.params.id);
    const project = getProject(ctx.db, id)!;
    const projectDir = resolveProjectDir(ctx.paths.PROJECTS_DIR, id, project.metadata);
    // A managed project's folder appears on first write; a brand-new game may not have one yet.
    await mkdir(projectDir, { recursive: true });
    const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
    const toolPaths = config.gameEnginePaths ?? {};
    return { profile: detectEngineProfile(projectDir, { enginePaths: toolPaths }), projectDir, runtimeDataDir: ctx.paths.RUNTIME_DATA_DIR,
      artifactDir: gameVerifyArtifactDir(ctx.paths.ARTIFACTS_DIR, id), toolPaths,
      webCaptureAvailable: typeof ctx.captureGameWeb === 'function', ...(grant ? { runId: grant.runId } : {}) };
  }

  app.get('/api/projects/:id/game/verify/context', requireLocalDaemonRequest, async (req, res) => {
    try {
      const auth = await authorize(req, res, true); if (!auth) return;
      const body = await context(req, auth.grant);
      await mkdir(body.artifactDir, { recursive: true });
      res.setHeader('Cache-Control', 'no-store'); res.json(body);
    } catch (caught) { error(res, caught); }
  });
  app.post('/api/projects/:id/game/verify', requireLocalDaemonRequest, async (req, res) => {
    // Reject even expired/revoked agent tokens. This route must never become a sandbox escape.
    if (agentToken(req)) { sendApiError(res, 403, 'FORBIDDEN', `Agent verification must execute inside the ${PRODUCT_CLI_NAME} CLI process`); return; }
    if (!isLocalSameOrigin(req, resolvedPortRef.current)) { sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return; }
    try {
      if (!await authorize(req, res, true)) return;
      const request = parseRequest(req.body);
      const prepared = await context(req);
      const result = await verifyGame({ ...prepared, request, resolveTool: gameToolResolver(prepared.toolPaths),
        ...(ctx.captureGameWeb ? { captureWeb: ctx.captureGameWeb } : {}) });
      res.json(await registerGameVerifyResult(prepared.artifactDir, result, request.runId));
    } catch (caught) { error(res, caught); }
  });
  app.post('/api/projects/:id/game/verify/register', requireLocalDaemonRequest, async (req, res) => {
    try {
      const auth = await authorize(req, res, true); if (!auth) return;
      const request = parseRequest({ runId: req.body?.runId });
      if (auth.grant && request.runId && request.runId !== auth.grant.runId) throw new Error('runId must match the tool token');
      const dir = gameVerifyArtifactDir(ctx.paths.ARTIFACTS_DIR, String(req.params.id));
      res.json(await registerGameVerifyResult(dir, req.body?.result, auth.grant?.runId ?? request.runId));
    } catch (caught) { error(res, caught); }
  });
  app.post('/api/projects/:id/game/verify/capture', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, true)) return;
      const input = req.body as GameWebCaptureRequest;
      if (!input || !gameLocalUrl(input.url) || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 120_000
        || !Number.isInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > 5000) throw new Error('Invalid local game capture request');
      res.json(ctx.captureGameWeb ? await ctx.captureGameWeb(input) : GAME_SCREENSHOT_HOST_UNAVAILABLE);
    } catch (caught) { error(res, caught); }
  });
  app.get('/api/projects/:id/game/verify/latest', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, false)) return;
      const dir = gameVerifyArtifactDir(ctx.paths.ARTIFACTS_DIR, String(req.params.id));
      res.setHeader('Cache-Control', 'no-store');
      try { res.json(JSON.parse(await readFile(path.join(dir, 'latest.json'), 'utf8'))); }
      catch (caught) { if ((caught as NodeJS.ErrnoException).code === 'ENOENT') res.json(null); else throw caught; }
    } catch (caught) { error(res, caught); }
  });
  app.get('/api/projects/:id/game/verify/:ref', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorize(req, res, false)) return;
      const dir = gameVerifyArtifactDir(ctx.paths.ARTIFACTS_DIR, String(req.params.id));
      const ref = String(req.params.ref);
      let file: string;
      try { file = await gameVerifyArtifact(dir, ref, 'log'); }
      catch { file = (await gameVerifyImage(dir, ref)).path!; }
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
      res.type(file.endsWith('.jpg') ? 'jpeg' : file.endsWith('.png') ? 'png' : 'text/plain').send(await readFile(file));
    } catch { sendApiError(res, 404, 'NOT_FOUND', 'Verification artifact not found'); }
  });
}
