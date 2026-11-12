import type { Express } from 'express';
import { RUNTIME_CAPABILITY_MATRIX } from '@openpixo/contracts';
import { readAppConfig } from '../app-config.js';
import { ensureDetectedRuntimeVersions } from '../runtimes/detection.js';
import { overlayRuntimeCapabilityVersions } from '../runtimes/capability-matrix.js';
import type { RouteDeps } from '../server-context.js';

export type RegisterAgentCapabilityRoutesDeps = RouteDeps<'http' | 'paths'>;

export function registerAgentCapabilityRoutes(app: Express, ctx: RegisterAgentCapabilityRoutesDeps): void {
  app.get('/api/agents/capabilities', async (_req, res) => {
    try {
      const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
      const versions = await Promise.all(Object.keys(RUNTIME_CAPABILITY_MATRIX).map(async (id) => {
        const detected = await ensureDetectedRuntimeVersions(id, config.agentCliEnv?.[id] ?? {});
        return [id, detected?.agentCliVersion] as const;
      }));
      res.json(overlayRuntimeCapabilityVersions(RUNTIME_CAPABILITY_MATRIX, Object.fromEntries(versions)));
    } catch (error) {
      ctx.http.sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });
}
