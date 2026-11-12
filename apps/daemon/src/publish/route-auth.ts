import type { Request, Response } from 'express';
import { gamePlanIsPending, type Project } from '@openpixo/contracts';
import { AccountError, PublishCloudError } from '../account/errors.js';
import { getProject } from '../db.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { GAME_PLAN_NOT_APPROVED } from '../routes/game-plan.js';
import type { RouteDeps } from '../server-context.js';
import { toolTokenRegistry } from '../tool-tokens.js';
import { PublishRequestError } from './service.js';

export type PublishRouteAuthDeps = RouteDeps<'db' | 'http' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'>;

/** `agent` tells the route to apply the limits a run-scoped token lives under. */
export interface PublishCaller { agent: boolean }

/** The creator's session or a run token for this exact project and operation. Sends the refusal itself. */
export async function authorizePublishCaller(ctx: PublishRouteAuthDeps, req: Request, res: Response,
  access: { write: boolean; operation: string }): Promise<PublishCaller | null> {
  const { sendApiError, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const id = String(req.params.id);
  const project = getProject(ctx.db, id) as Project | null | undefined;
  if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return null; }
  const mode = access.write ? { mode: 'write' as const, capability: 'writeFiles' as const } : { mode: 'read' as const };
  const token = bearerTokenFromRequest(req);
  if (token?.startsWith('pixott_')) {
    const validation = toolTokenRegistry.validate(token, { operation: access.operation, endpoint: req.route.path });
    if (!validation.ok || validation.grant.projectId !== id) {
      sendApiError(res, 403, 'FORBIDDEN', 'A tool token for this project is required'); return null;
    }
    // These routes write from the daemon, outside the read-only turn a plan holds the agent in.
    if (access.write && gamePlanIsPending(project.metadata)) {
      sendApiError(res, 409, GAME_PLAN_NOT_APPROVED, 'Sharing waits until the user approves the plan'); return null;
    }
    return await ctx.authorizeProjectToolRequest(res, id, mode) ? { agent: true } : null;
  }
  if (access.write && !isLocalSameOrigin(req, resolvedPortRef.current)) {
    sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return null;
  }
  return await ctx.authorizeProjectRequest(req, res, id, mode) ? { agent: false } : null;
}

export function sendPublishFailure(ctx: Pick<PublishRouteAuthDeps, 'http'>, res: Response, error: unknown): void {
  if (error instanceof AccountError || error instanceof PublishCloudError) { res.status(error.status).json(error.response()); return; }
  if (error instanceof PublishRequestError) { ctx.http.sendApiError(res, error.status, error.code, error.message); return; }
  console.error('[publish] request failed:', error);
  ctx.http.sendApiError(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Try again.');
}
