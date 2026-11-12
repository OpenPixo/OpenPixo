import { lstat } from 'node:fs/promises';
import path from 'node:path';
import {
  gameFolderNameProblem,
  parseGameProjectSetup,
  type CheckGameTargetRequest,
  type CheckGameTargetResponse,
  type CreateGameFromTemplateRequest,
  type GameEngineOption,
  type GameTemplatesResponse,
} from '@openpixo/contracts';
import type { Express } from 'express';
import { copyGameTemplate, defaultGameParentDir, GameTemplateError, gameTemplateErrorCode, initializeGameTemplateGit, listGameTemplates, resolveGameTemplateCover, resolveGameTemplateParent } from '../game/templates.js';
import { sendValidatedFile } from '../http/send-file.js';
import type { FolderImporter } from '../services/folder-import.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterGameTemplateRoutesDeps extends RouteDeps<'http'> {
  templatesRoot: string;
  folderImporter: FolderImporter;
  /** Whether a wizard-chosen art style is installed; required only when a setup names one. */
  artStyleExists?: (styleId: string) => boolean;
  /** What this machine can run, so the setup dialog can say so before the user commits to an engine. */
  engineOptions?: () => Promise<GameEngineOption[]>;
}

export function registerGameTemplateRoutes(app: Express, ctx: RegisterGameTemplateRoutesDeps): void {
  const { sendApiError } = ctx.http;
  let defaultParent: Promise<string> | undefined;
  app.get('/api/game-templates', async (_req, res) => {
    try {
      // A failed tool check must not take the template list down with it.
      const engines = await ctx.engineOptions?.().catch(() => undefined);
      const body: GameTemplatesResponse = {
        templates: await listGameTemplates(ctx.templatesRoot),
        ...(engines ? { engines } : {}),
        defaultParentDir: await (defaultParent ??= defaultGameParentDir()),
      };
      res.json(body);
    } catch (error) {
      sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });
  // Catalog cover for a listed template. The id must name a template in the
  // listing; anything else, including a listed template with no cover, is 404.
  app.get('/api/game-templates/:id/cover', async (req, res) => {
    try {
      const id = String(req.params.id);
      const listed = (await listGameTemplates(ctx.templatesRoot)).some(template => template.id === id);
      const cover = listed ? await resolveGameTemplateCover(ctx.templatesRoot, id) : null;
      if (!cover) return sendApiError(res, 404, 'NOT_FOUND', 'Template cover not found');
      res.setHeader('Content-Type', cover.contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return sendValidatedFile(res, cover.file);
    } catch (error) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });
  // Preflight for the create form. It applies the create route's own rules in
  // the same order, but never writes and never spends the picker token: the
  // authorization is inspected, so a parent the gate would refuse reports
  // `picker-required` before any filesystem fact about it is revealed.
  app.post('/api/projects/game-from-template/check', async (req, res) => {
    const input = req.body as CheckGameTargetRequest | undefined;
    if (!input || typeof input.parentDir !== 'string' || typeof input.name !== 'string' ||
      (input.createParent !== undefined && typeof input.createParent !== 'boolean')) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'parentDir and name required');
    }
    const send = (body: CheckGameTargetResponse) => res.json(body);
    const nameProblem = gameFolderNameProblem(input.name);
    if (nameProblem) return send({ status: 'invalid-name', nameProblem });
    const authorized = ctx.folderImporter.inspectAuthorization(req, input.parentDir);
    if (!authorized.ok) return send({ status: 'picker-required', message: authorized.reason });
    try {
      let parent: string;
      try {
        parent = await resolveGameTemplateParent(input.parentDir, input.createParent === true);
      } catch (error) {
        return send({ status: 'invalid-parent', reasonCode: gameTemplateErrorCode(error), message: error instanceof Error ? error.message : String(error) });
      }
      const target = path.join(parent, input.name);
      const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (existing) return send({ status: 'exists', target });
      const reason = await ctx.folderImporter.rootRejectionReason(target, authorized.trustedPickerImport);
      if (reason) return send({ status: 'rejected', target, reasonCode: 'TARGET_REJECTED', message: reason });
      return send({ status: 'available', target });
    } catch (error) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });
  app.post('/api/projects/game-from-template', async (req, res) => {
    try {
      const input = req.body as CreateGameFromTemplateRequest | undefined;
      if (!input || typeof input.templateId !== 'string' || typeof input.parentDir !== 'string' ||
          typeof input.name !== 'string' || (input.createParent !== undefined && typeof input.createParent !== 'boolean')) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'templateId, parentDir and name required');
      }
      // The setup is validated before authorization spends a picker token or anything is copied.
      const setup = input.setup === undefined ? undefined : parseGameProjectSetup(input.setup);
      if (setup && !setup.ok) return sendApiError(res, 400, 'BAD_REQUEST', setup.message, { details: { reasonCode: 'INVALID_REQUEST' } });
      const styleId = setup?.ok ? setup.setup.art?.styleId : undefined;
      if (styleId && !ctx.artStyleExists?.(styleId)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'Art style is not installed', { details: { reasonCode: 'INVALID_REQUEST' } });
      }
      const authorized = await ctx.folderImporter.authorize(req, res, input.parentDir);
      if (!authorized) return;
      const baseDir = await copyGameTemplate(ctx.templatesRoot, input, async target => {
        const reason = await ctx.folderImporter.rootRejectionReason(target, authorized.trustedPickerImport);
        if (reason) throw new GameTemplateError('TARGET_REJECTED', reason);
      });
      const git = await initializeGameTemplateGit(baseDir, input.templateId);
      // Folder registration owns its response; this creation route adds only its own result.
      const json = res.json;
      res.json = body => json.call(res, body && typeof body === 'object' && 'project' in body ? { ...body, git } : body);
      const extraMetadata = setup?.ok ? { gameSetup: setup.setup, ...(styleId ? { artStyleId: styleId } : {}) } : undefined;
      try { return await ctx.folderImporter.importFolder(req, res, { baseDir, name: setup?.ok && setup.setup.title ? setup.setup.title : input.name }, authorized, extraMetadata); }
      finally { res.json = json; }
    } catch (error) {
      return sendApiError(res, 400, 'BAD_REQUEST', error instanceof Error ? error.message : String(error), { details: { reasonCode: gameTemplateErrorCode(error) } });
    }
  });
}
