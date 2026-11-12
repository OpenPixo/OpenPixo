import type { Express, Request, Response } from 'express';
import { SetProjectArtStyleRequestSchema, SetProjectStyleReferenceRequestSchema, type ProjectArtStyleResponse, type StyleResponse, type StylesResponse } from '@openpixo/contracts';
import { getProject } from '../db.js';
import { resolveProjectDir } from '../projects.js';
import type { RouteDeps } from '../server-context.js';
import { sendApiError } from '../http/api-errors.js';
import { sendValidatedFile } from '../http/send-file.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { toolTokenRegistry } from '../tool-tokens.js';
import { ArtStyleError, catalogLocale, getArtStyle, getProjectArtStyle, listArtStyles, resolveArtStylePreview, setProjectArtStyle, setProjectStyleReference } from '../styles/service.js';

export interface RegisterStyleRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {}

export function registerStyleRoutes(app: Express, ctx: RegisterStyleRoutesDeps): void {
  const { db, http, paths } = ctx;
  function styleGrant(req: Request, res: Response, operation: 'style:read' | 'style:write') {
    const token = bearerTokenFromRequest(req);
    if (!token?.startsWith('pixott_')) return undefined;
    const result = toolTokenRegistry.validate(token, { operation, endpoint: req.route.path });
    if (!result.ok) { sendApiError(res, 403, result.code, result.message); return null; }
    return result.grant;
  }
  async function authorizeProject(req: Request, res: Response, id: string, write: boolean): Promise<boolean> {
    const grant = styleGrant(req, res, write ? 'style:write' : 'style:read');
    if (grant === null) return false;
    const options = write ? { mode: 'write' as const, capability: 'writeFiles' as const } : { mode: 'read' as const };
    if (grant) {
      if (grant.projectId !== id) { sendApiError(res, 403, 'FORBIDDEN', 'Project does not match tool token'); return false; }
      return Boolean(await ctx.authorizeProjectToolRequest(res, id, options));
    }
    if (write && !http.isLocalSameOrigin(req, http.resolvedPortRef.current)) { sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return false; }
    return ctx.authorizeProjectRequest(req, res, id, options);
  }
  app.get('/api/styles', http.requireLocalDaemonRequest, (req, res) => {
    if (styleGrant(req, res, 'style:read') === null) return;
    res.json({ styles: listArtStyles(db, catalogLocale(req.query.locale ?? req.headers['accept-language'])) } satisfies StylesResponse);
  });
  app.get('/api/styles/:id', http.requireLocalDaemonRequest, (req, res) => {
    if (styleGrant(req, res, 'style:read') === null) return;
    const style = getArtStyle(db, String(req.params.id), catalogLocale(req.query.locale ?? req.headers['accept-language']));
    if (!style) return sendApiError(res, 404, 'STYLE_NOT_FOUND', 'Art style is not installed');
    return res.json({ style } satisfies StyleResponse);
  });
  app.get('/api/styles/:id/previews/:index', http.requireLocalDaemonRequest, async (req, res) => {
    if (styleGrant(req, res, 'style:read') === null) return;
    const index = /^\d+$/.test(String(req.params.index)) ? Number(req.params.index) : -1;
    const file = await resolveArtStylePreview(db, String(req.params.id), index);
    if (!file) return sendApiError(res, 404, 'NOT_FOUND', 'Style preview not found');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sendValidatedFile(res, file);
  });
  app.get('/api/projects/:id/art-style', http.requireLocalDaemonRequest, async (req, res) => {
    const id = String(req.params.id);
    if (!await authorizeProject(req, res, id, false)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      return res.json(getProjectArtStyle(db, paths.PROJECT_ROOT, id, catalogLocale(req.query.locale ?? req.headers['accept-language'])) satisfies ProjectArtStyleResponse);
    } catch (error) {
      return sendApiError(res, error instanceof ArtStyleError ? error.status : 500,
        error instanceof ArtStyleError ? error.code : 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });
  app.put('/api/projects/:id/art-style', http.requireLocalDaemonRequest, async (req, res) => {
    const body = SetProjectArtStyleRequestSchema.safeParse(req.body);
    if (!body.success) return sendApiError(res, 400, 'BAD_REQUEST', 'styleId must be a style id or null');
    const id = String(req.params.id);
    if (!await authorizeProject(req, res, id, true)) return;
    try {
      return res.json(setProjectArtStyle(db, paths.PROJECT_ROOT, id, body.data.styleId, catalogLocale(req.query.locale ?? req.headers['accept-language'])) satisfies ProjectArtStyleResponse);
    } catch (error) {
      return sendApiError(res, error instanceof ArtStyleError ? error.status : 500,
        error instanceof ArtStyleError ? error.code : 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });
  // The user picks it in the app or with `pixo style reference`; an agent records the
  // sample the user picked while planning. It only advises, so an agent may set it.
  app.put('/api/projects/:id/style-reference', http.requireLocalDaemonRequest, async (req, res) => {
    const body = SetProjectStyleReferenceRequestSchema.safeParse(req.body);
    if (!body.success) return sendApiError(res, 400, 'BAD_REQUEST', 'path must be a project-relative image path or null');
    const id = String(req.params.id);
    if (!await authorizeProject(req, res, id, true)) return;
    try {
      const projectDir = (projectId: string) => resolveProjectDir(paths.PROJECTS_DIR, projectId, getProject(db, projectId)?.metadata);
      return res.json(await setProjectStyleReference(db, projectDir, id, body.data.path,
        catalogLocale(req.query.locale ?? req.headers['accept-language'])) satisfies ProjectArtStyleResponse);
    } catch (error) {
      return sendApiError(res, error instanceof ArtStyleError ? error.status : 500,
        error instanceof ArtStyleError ? error.code : 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });
}
