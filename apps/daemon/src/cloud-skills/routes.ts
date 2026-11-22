import type { Express } from 'express';
import type { CloudSkillsResponse } from '@openpixo/contracts';
import { isAgentToken } from '../http/tool-request-auth.js';
import type { RouteDeps } from '../server-context.js';
import type { CloudSkillsService } from './service.js';

export interface RegisterCloudSkillsRoutesDeps extends RouteDeps<'http'> {
  cloudSkills: Pick<CloudSkillsService, 'status' | 'sync'>;
}

/**
 * `GET /api/cloud-skills`: the downloaded cloud skills and the cloud tools, for Settings and
 * `pixo cloud-skills list`. `POST /api/cloud-skills/sync` downloads what changed; only the user
 * asks for it (the daemon also syncs by itself), never an agent.
 */
export function registerCloudSkillsRoutes(app: Express, ctx: RegisterCloudSkillsRoutesDeps): void {
  const { requireLocalDaemonRequest, sendApiError } = ctx.http;
  app.get('/api/cloud-skills', requireLocalDaemonRequest, async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await ctx.cloudSkills.status() satisfies CloudSkillsResponse);
  });
  app.post('/api/cloud-skills/sync', requireLocalDaemonRequest, async (req, res) => {
    if (isAgentToken(req)) return sendApiError(res, 403, 'FORBIDDEN', 'Only the user can sync cloud skills.');
    res.set('Cache-Control', 'no-store').json(await ctx.cloudSkills.sync() satisfies CloudSkillsResponse);
  });
}
