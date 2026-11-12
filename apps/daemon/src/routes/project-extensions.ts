import type { Express, Request, Response } from 'express';
import type { ImportProjectExtensionRequest, ProjectExtensionKind, ProjectExtensionsResponse } from '@openpixo/contracts';
import { readAppConfig } from '../app-config.js';
import { selectDefaultProjectSkills } from '../game/default-skills.js';
import type { RouteDeps, ResourceDeps } from '../server-context.js';
import {
  changeProjectExtension,
  importProjectExtension,
  listProjectExtensions,
  ProjectExtensionError,
  type ProjectExtensionOptions,
} from '../services/project-extensions.js';

export interface RegisterProjectExtensionRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  resources: Pick<ResourceDeps, 'listAllSkills'>;
}

export function registerProjectExtensionRoutes(app: Express, ctx: RegisterProjectExtensionRoutesDeps): void {
  const { sendApiError, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const { RUNTIME_DATA_DIR, USER_SKILLS_DIR, SKILLS_DIR } = ctx.paths;

  async function options(req: Request, res: Response, write: boolean): Promise<ProjectExtensionOptions | null> {
    const projectId = String(req.params.id ?? '');
    const project = ctx.projectStore.getProject(ctx.db, projectId);
    if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return null; }
    if (write && !isLocalSameOrigin(req, resolvedPortRef.current)) {
      sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return null;
    }
    if (!await ctx.authorizeProjectRequest(req, res, projectId, write ? { mode: 'write', capability: 'writeFiles' } : { mode: 'read' })) return null;
    return {
      dataDir: RUNTIME_DATA_DIR, projectId, skillsRoots: [USER_SKILLS_DIR, SKILLS_DIR],
      catalogSkills: await ctx.resources.listAllSkills(),
    };
  }

  /** The project's extensions plus the skills it gets without adding anything. */
  async function listing(req: Request, resolved: ProjectExtensionOptions): Promise<ProjectExtensionsResponse> {
    const extensions = await listProjectExtensions(resolved);
    const config = await readAppConfig(RUNTIME_DATA_DIR).catch(() => null);
    const defaults = selectDefaultProjectSkills({
      catalog: resolved.catalogSkills ?? [],
      engine: ctx.projectStore.getProject(ctx.db, String(req.params.id ?? ''))?.metadata?.engineProfile?.engine,
      disabledSkills: config?.disabledSkills,
      excludeIds: extensions.skills.map((skill) => skill.id),
    });
    return {
      ...extensions,
      defaultSkills: defaults.map((skill) => ({
        id: skill.id,
        name: skill.displayName?.en ?? skill.name,
        description: skill.description,
        ...(skill.displayName ? { displayName: skill.displayName } : {}),
      })),
    };
  }

  function fail(res: Response, error: unknown): void {
    sendApiError(res, error instanceof ProjectExtensionError ? error.status : 500,
      error instanceof ProjectExtensionError ? 'PROJECT_EXTENSION_INVALID' : 'PROJECT_EXTENSION_FAILED',
      error instanceof Error ? error.message : String(error));
  }

  app.get('/api/projects/:id/extensions', requireLocalDaemonRequest, async (req, res) => {
    try {
      const resolved = await options(req, res, false);
      if (resolved) res.json(await listing(req, resolved));
    } catch (error) { fail(res, error); }
  });

  app.post('/api/projects/:id/extensions', requireLocalDaemonRequest, async (req, res) => {
    try {
      const resolved = await options(req, res, true);
      if (!resolved) return;
      await importProjectExtension(resolved, req.body as ImportProjectExtensionRequest);
      res.status(201).json(await listing(req, resolved));
    } catch (error) { fail(res, error); }
  });

  app.post('/api/projects/:id/extensions/:kind/:extensionId', requireLocalDaemonRequest, async (req, res) => {
    try {
      const resolved = await options(req, res, true);
      if (!resolved) return;
      const kind = req.params.kind;
      const action = req.body?.action;
      if ((kind !== 'skill' && kind !== 'mcp') || !['enable', 'disable', 'update'].includes(action)) {
        throw new ProjectExtensionError(400, 'Select an extension kind and enable, disable or update');
      }
      await changeProjectExtension(resolved, kind, String(req.params.extensionId), action);
      res.json(await listing(req, resolved));
    } catch (error) { fail(res, error); }
  });

  app.delete('/api/projects/:id/extensions/:kind/:extensionId', requireLocalDaemonRequest, async (req, res) => {
    try {
      const resolved = await options(req, res, true);
      if (!resolved) return;
      const kind = req.params.kind;
      if (kind !== 'skill' && kind !== 'mcp') throw new ProjectExtensionError(400, 'Invalid extension kind');
      await changeProjectExtension(resolved, kind as ProjectExtensionKind, String(req.params.extensionId), 'remove');
      res.json(await listing(req, resolved));
    } catch (error) { fail(res, error); }
  });
}
