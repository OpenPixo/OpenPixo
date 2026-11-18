import type { Express, Request, Response } from 'express';
import { PRODUCT_CLI_NAME, type RoomsLimitRequest } from '@openpixo/contracts';
import { SHARE_ID_PATTERN } from '../account/publish-cloud.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { sendPublishFailure } from '../publish/route-auth.js';
import type { PublishService } from '../publish/service.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterPublishedGamesRoutesDeps extends RouteDeps<'http'> {
  publish: PublishService;
}

/** The cloud refuses more, and would only say it is unavailable. Same bound as the per-project route. */
const MONTHLY_LIMIT_MAX = 10_000_000;

/**
 * The game hub page (`游戏管理`) and `pixo publish list`: every public link on the creator's account,
 * including links whose project was deleted or lives on another computer.
 *
 * These routes reach the whole account, not one project, so a run's tool token (scoped to one project)
 * is refused outright; an agent manages its own game through `/api/projects/:id/publish`.
 */
export function registerPublishedGamesRoutes(app: Express, ctx: RegisterPublishedGamesRoutesDeps): void {
  const { sendApiError, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } = ctx.http;

  /** The creator's own request, or the refusal is sent. */
  function creatorOnly(req: Request, res: Response, write: boolean): boolean {
    if (bearerTokenFromRequest(req)?.startsWith('pixott_')) {
      sendApiError(res, 403, 'FORBIDDEN', `Your account's published games are managed by the creator: the 游戏管理 page, or ${PRODUCT_CLI_NAME} publish list in their own terminal.`);
      return false;
    }
    if (write && !isLocalSameOrigin(req, resolvedPortRef.current)) { sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return false; }
    return true;
  }

  function shareIdOf(req: Request, res: Response): string | null {
    const shareId = String(req.params.shareId);
    if (SHARE_ID_PATTERN.test(shareId)) return shareId;
    sendApiError(res, 404, 'NOT_FOUND', 'This link is not on your account.');
    return null;
  }

  app.get('/api/published-games', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!creatorOnly(req, res, false)) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json(await ctx.publish.list());
    } catch (error) { sendPublishFailure(ctx, res, error); }
  });

  app.delete('/api/published-games/:shareId', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!creatorOnly(req, res, true)) return;
      const shareId = shareIdOf(req, res);
      if (!shareId) return;
      await ctx.publish.removeShare(shareId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true });
    } catch (error) { sendPublishFailure(ctx, res, error); }
  });

  app.patch('/api/published-games/:shareId/rooms', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!creatorOnly(req, res, true)) return;
      const shareId = shareIdOf(req, res);
      if (!shareId) return;
      const limit = (req.body as Partial<RoomsLimitRequest> | undefined)?.monthlyCreditLimit;
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0 || limit > MONTHLY_LIMIT_MAX) {
        sendApiError(res, 400, 'BAD_REQUEST', 'The limit must be a whole number of credits, from 0 to 10,000,000.'); return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ usage: await ctx.publish.setShareRoomsLimit(shareId, limit) });
    } catch (error) { sendPublishFailure(ctx, res, error); }
  });
}
