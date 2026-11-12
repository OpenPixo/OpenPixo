import type { Express, Request, Response } from 'express';
import {
  gameSetupMissingSteps,
  normalizeGameProjectSetup,
  SetGameProjectSetupRequestSchema,
  type GameProjectSetup,
  type GameProjectSetupResponse,
  type ProjectMetadata,
} from '@openpixo/contracts';
import { getProject, updateProject } from '../db.js';
import { getArtStyle } from '../styles/service.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterGameSetupRoutesDeps extends RouteDeps<'db' | 'http' | 'authorizeProjectRequest'> {
  /** Defaults to the installed style catalogue; route tests stub it. */
  artStyleExists?: (styleId: string) => boolean;
}

export function gameSetupResponse(setup: GameProjectSetup | undefined | null): GameProjectSetupResponse {
  return { setup: setup ?? null, missingSteps: gameSetupMissingSteps(setup) };
}

/**
 * The new-project wizard's answers on an existing project. Reading and writing
 * stay with the local user session (UI and `pixo project game-setup`); agents
 * already receive the setup as an explicit prompt input.
 */
export function registerGameSetupRoutes(app: Express, ctx: RegisterGameSetupRoutesDeps): void {
  const { db, http } = ctx;
  const artStyleExists = ctx.artStyleExists ?? (styleId => Boolean(getArtStyle(db, styleId)));

  async function authorize(req: Request, res: Response, write: boolean): Promise<string | null> {
    const id = String(req.params.id);
    if (!getProject(db, id)) { http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return null; }
    if (write && !http.isLocalSameOrigin(req, http.resolvedPortRef.current)) {
      http.sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return null;
    }
    const allowed = await ctx.authorizeProjectRequest(req, res, id, write ? { mode: 'write', capability: 'writeFiles' } : { mode: 'read' });
    return allowed ? id : null;
  }

  app.get('/api/projects/:id/game-setup', http.requireLocalDaemonRequest, async (req, res) => {
    const id = await authorize(req, res, false);
    if (!id) return;
    res.setHeader('Cache-Control', 'no-store');
    res.json(gameSetupResponse(getProject(db, id)?.metadata?.gameSetup));
  });

  app.put('/api/projects/:id/game-setup', http.requireLocalDaemonRequest, async (req, res) => {
    const body = SetGameProjectSetupRequestSchema.safeParse(req.body);
    if (!body.success) {
      const issue = body.error.issues[0];
      return http.sendApiError(res, 400, 'BAD_REQUEST', `Invalid game setup${issue ? ` at ${issue.path.join('.') || 'root'}: ${issue.message}` : ''}`);
    }
    const setup = body.data.setup ? normalizeGameProjectSetup(body.data.setup) : null;
    const styleId = setup?.art?.styleId;
    if (styleId && !artStyleExists(styleId)) return http.sendApiError(res, 404, 'STYLE_NOT_FOUND', 'Art style is not installed');
    const id = await authorize(req, res, true);
    if (!id) return;
    const latest = getProject(db, id);
    if (!latest) return http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    const { gameSetup: _previous, ...rest } = latest.metadata ?? {} as ProjectMetadata;
    // A chosen style becomes the project default; clearing the setup leaves the default alone.
    const metadata: ProjectMetadata = { ...rest, ...(setup ? { gameSetup: setup } : {}), ...(styleId ? { artStyleId: styleId } : {}) };
    updateProject(db, id, { metadata });
    res.json(gameSetupResponse(setup));
  });
}
