import type { Express } from 'express';
import { PRODUCT_CLI_NAME, type PublishRequest, type PublishStartResponse } from '@openpixo/contracts';
import { authorizePublishCaller, sendPublishFailure } from '../publish/route-auth.js';
import { PublishService, type PublishServiceDeps } from '../publish/service.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterPublishRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  account?: PublishServiceDeps['account'];
  build?: PublishServiceDeps['build'];
  sleep?: PublishServiceDeps['sleep'];
}

/** What an agent is told when it tries to agree to the extra-game charge itself. */
export const EXTRA_GAME_AGENT_REFUSAL = `Publishing this game beyond the plan's game count spends the creator's credits, so the creator must confirm it. Ask them to press Publish in the Share dialog, or to run ${PRODUCT_CLI_NAME} publish --pay-extra-game in their own terminal.`;

/** The cloud keeps the first 80 characters of a title, so a longer one is refused here rather than silently cut. */
const TITLE_MAX = 80;

function parseRequest(body: unknown): PublishRequest | { problem: string } {
  const invalid = { problem: 'That publish request could not be read.' };
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) return invalid;
  const { title, acceptTerms, skipBuild, payExtraGame } = body as Record<string, unknown>;
  const trimmed = typeof title === 'string' ? title.trim() : undefined;
  if (title !== undefined && !trimmed) return { problem: 'Give the game a title.' };
  if (trimmed && trimmed.length > TITLE_MAX) return { problem: `The game title can be at most ${TITLE_MAX} characters.` };
  const flag = (value: unknown) => value === undefined || typeof value === 'boolean';
  if (!flag(acceptTerms) || !flag(skipBuild) || !flag(payExtraGame)) return invalid;
  return { ...(trimmed ? { title: trimmed } : {}), ...(acceptTerms === true ? { acceptTerms: true } : {}), ...(skipBuild === true ? { skipBuild: true } : {}),
    ...(payExtraGame === true ? { payExtraGame: true } : {}) };
}

export function registerPublishRoutes(app: Express, ctx: RegisterPublishRoutesDeps): PublishService {
  const { sendApiError, requireLocalDaemonRequest } = ctx.http;
  const service = new PublishService({ db: ctx.db, projectsDir: ctx.paths.PROJECTS_DIR, dataDir: ctx.paths.RUNTIME_DATA_DIR,
    account: ctx.account, ...(ctx.build ? { build: ctx.build } : {}), ...(ctx.sleep ? { sleep: ctx.sleep } : {}) });

  app.get('/api/projects/:id/publish', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorizePublishCaller(ctx, req, res, { write: false, operation: 'publish:read' })) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json(await service.status(String(req.params.id)));
    } catch (error) { sendPublishFailure(ctx, res, error); }
  });

  app.post('/api/projects/:id/publish', requireLocalDaemonRequest, async (req, res) => {
    try {
      const caller = await authorizePublishCaller(ctx, req, res, { write: true, operation: 'publish:write' });
      if (!caller) return;
      const request = parseRequest(req.body);
      if ('problem' in request) { sendApiError(res, 400, 'BAD_REQUEST', request.problem); return; }
      if (caller.agent) {
        // The daemon's build runs outside the agent's sandbox, so an agent builds in its own CLI process first.
        if (!request.skipBuild) { sendApiError(res, 403, 'FORBIDDEN', `Agent publishing must build inside the ${PRODUCT_CLI_NAME} CLI process; run ${PRODUCT_CLI_NAME} publish`); return; }
        // Agreeing to the sharing rules binds the creator, so it has to come from the creator.
        if (request.acceptTerms) { sendApiError(res, 403, 'FORBIDDEN', `The creator must accept the sharing rules themselves: the Share dialog, or ${PRODUCT_CLI_NAME} publish --accept-terms in their own terminal.`); return; }
        // The extra-game charge spends the creator's credits, so only the creator can agree to it.
        if (request.payExtraGame) { sendApiError(res, 403, 'FORBIDDEN', EXTRA_GAME_AGENT_REFUSAL); return; }
      }
      const job = await service.start(String(req.params.id), request);
      res.setHeader('Cache-Control', 'no-store');
      res.status(202).json({ job } satisfies PublishStartResponse);
    } catch (error) { sendPublishFailure(ctx, res, error); }
  });

  app.delete('/api/projects/:id/publish', requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!await authorizePublishCaller(ctx, req, res, { write: true, operation: 'publish:write' })) return;
      await service.remove(String(req.params.id));
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true });
    } catch (error) { sendPublishFailure(ctx, res, error); }
  });

  return service;
}
