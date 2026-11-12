import type { Express } from 'express';
import type { AssetOpRequest } from '@openpixo/contracts';
import { getProject } from '../db.js';
import { runAssetOp } from '../assets/ops/index.js';
import { assetPath, hashFile } from '../assets/ops/files.js';
import { recordAssetProvenance } from '../assets/provenance-store.js';
import { bearerTokenFromRequest, createToolRequestAuth } from '../http/tool-request-auth.js';
import { resolveProjectDir } from '../projects.js';
import { isSandboxModeEnabled } from '../sandbox-mode.js';
import type { RouteDeps } from '../server-context.js';
import { toolTokenRegistry } from '../tool-tokens.js';

export interface RegisterAssetOpRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {}

export function registerAssetOpRoutes(app: Express, ctx: RegisterAssetOpRoutesDeps): void {
  const { requireLocalDaemonRequest, sendApiError, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const { authorizeToolRequest } = createToolRequestAuth(toolTokenRegistry);
  app.post('/api/projects/:id/asset-ops', requireLocalDaemonRequest, async (req, res) => {
    try {
      const id = String(req.params.id), project = getProject(ctx.db, id);
      if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
      const mode = { mode: 'write' as const, capability: 'writeFiles' as const };
      const token = bearerTokenFromRequest(req);
      let runId: string | undefined;
      if (token?.startsWith('pixott_') || isSandboxModeEnabled(process.env)) {
        // Deterministic processing shares the existing media-write capability.
        const grant = authorizeToolRequest(req, res, 'media:generate', { endpoint: '/api/tools/media/generate' });
        if (!grant) return;
        if (grant.projectId !== id) { sendApiError(res, 403, 'FORBIDDEN', 'Tool token belongs to another project'); return; }
        if (!await ctx.authorizeProjectToolRequest(res, id, mode)) return;
        runId = grant.runId;
      } else {
        if (!isLocalSameOrigin(req, resolvedPortRef.current)) { sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return; }
        if (!await ctx.authorizeProjectRequest(req, res, id, mode)) return;
      }
      const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, id, project.metadata);
      // shortcut: synchronous bounded batches; long-task taskId/wait integration is deferred.
      const report = await runAssetOp({ projectRoot: root }, req.body as AssetOpRequest);
      if (!report.dryRun) {
        const recorded = new Set<string>();
        for (const result of report.results) {
          if (result.status !== 'succeeded' || !result.output) continue;
          for (const output of [result.output, ...result.extraOutputs ?? []]) {
            if (recorded.has(output)) continue;
            recorded.add(output);
            recordAssetProvenance(ctx.db, { projectId: id, relPath: output, contentHash: await hashFile(await assetPath(root, output)), origin: 'processed',
              params: { op: report.op, ...report.params }, parentHashes: result.parentHashes ?? (result.sourceSha256 ? [result.sourceSha256] : []), ...(runId ? { runId } : {}) });
          }
        }
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(report);
    } catch (error) { sendApiError(res, 400, 'BAD_REQUEST', error instanceof Error ? error.message : String(error)); }
  });
}
