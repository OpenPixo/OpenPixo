import type { Express, Request, Response } from 'express';
import type { ProjectMetadata } from '@openpixo/contracts';
import { getProject, updateProject } from '../db.js';
import { publicErrorMessage } from '../http/api-errors.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { readProjectStarterFacts, type ProjectStarterFactDependencies } from '../project-start/facts.js';
import { deriveProjectNextSteps, type ProjectStarterFacts } from '../project-start/next-steps.js';
import type { HttpDeps, RouteDeps } from '../server-context.js';
import { PROJECT_NEXT_STEPS_TOOL_ENDPOINT, toolTokenRegistry } from '../tool-tokens.js';

export interface RegisterProjectNextStepsRoutesDeps extends ProjectStarterFactDependencies, RouteDeps<'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  http: Pick<HttpDeps, 'requireLocalDaemonRequest' | 'sendApiError' | 'isLocalSameOrigin' | 'resolvedPortRef'>;
  /** Stub project facts without probing the local machine in route tests. */
  facts?: (projectId: string, metadata?: ProjectMetadata) => Promise<ProjectStarterFacts>;
}

export function registerProjectNextStepsRoutes(app: Express, ctx: RegisterProjectNextStepsRoutesDeps): void {
  const { requireLocalDaemonRequest, sendApiError, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  async function respond(req: Request, res: Response, dismiss: boolean): Promise<void> {
    try {
      const token = bearerTokenFromRequest(req);
      const agent = token?.startsWith('pixott_') === true;
      if (dismiss && agent) {
        sendApiError(res, 403, 'FORBIDDEN', 'Project starter preferences require the local OpenPixo user session'); return;
      }
      if (dismiss && !isLocalSameOrigin(req, resolvedPortRef.current)) {
        sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return;
      }
      const id = String(req.params.id);
      const project = getProject(ctx.db, id);
      if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
      if (agent) {
        const validation = toolTokenRegistry.validate(token, { endpoint: req.route.path, operation: 'project:next-steps:read' });
        if (!validation.ok || validation.grant.projectId !== id) {
          sendApiError(res, 403, 'FORBIDDEN', 'A valid starter checklist read token for this project is required'); return;
        }
        if (!await ctx.authorizeProjectToolRequest(res, id, { mode: 'read' })) return;
      } else if (!await ctx.authorizeProjectRequest(req, res, id, dismiss ? { mode: 'write', capability: 'writeFiles' } : { mode: 'read' })) return;
      if (dismiss && req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
        throw new Error('Checklist dismissal does not accept progress or command arguments');
      }
      const facts = await (ctx.facts?.(id, project.metadata) ?? readProjectStarterFacts(ctx, id, project.metadata));
      // Facts can involve async reads; merge into the latest preferences rather than their earlier snapshot.
      const latest = getProject(ctx.db, id);
      if (!latest) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
      const metadata = dismiss ? { ...latest.metadata, starterChecklistDismissed: true } : latest.metadata;
      if (dismiss) updateProject(ctx.db, id, { metadata });
      res.setHeader('Cache-Control', 'no-store');
      res.json(deriveProjectNextSteps(id, metadata, facts));
    } catch (error) {
      sendApiError(res, 400, 'BAD_REQUEST', publicErrorMessage(error));
    }
  }
  app.get(PROJECT_NEXT_STEPS_TOOL_ENDPOINT, requireLocalDaemonRequest, (req, res) => respond(req, res, false));
  app.post('/api/projects/:id/next-steps/dismiss', requireLocalDaemonRequest, (req, res) => respond(req, res, true));
}
