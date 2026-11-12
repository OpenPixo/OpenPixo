import express, { type Express, type Request, type Response } from 'express';
import type { OpenPixoAgentCatalogResponse, OpenPixoAgentRunUsageResponse } from '@openpixo/contracts';
import { AGENT_RUN_KEY } from '../account/agent-gateway.js';
import { accountError } from '../account/errors.js';
import type { OpenPixoAccountService } from '../account/service.js';
import { sendApiError } from '../http/api-errors.js';
import { MAX_AGENT_REQUEST_BYTES, OPENPIXO_AGENT_PROXY_PATH, type OpenPixoAgentGateway } from '../openpixo-agent/gateway.js';

export interface RegisterOpenPixoAgentRoutesDeps { account: OpenPixoAccountService; gateway: OpenPixoAgentGateway }

/** The agent-facing relay. Register before the global JSON parser: it forwards raw bytes. */
export function registerOpenPixoAgentProxy(app: Express, { gateway }: Pick<RegisterOpenPixoAgentRoutesDeps, 'gateway'>): void {
  // A body may hold the agent's pictures at full size, so only a running agent's own request is read.
  app.post(OPENPIXO_AGENT_PROXY_PATH, (req, res, next) => {
    if (gateway.admits(req)) next();
    else void gateway.handle(req, res);
  }, express.raw({ type: () => true, limit: MAX_AGENT_REQUEST_BYTES }), (req, res) => {
    void gateway.handle(req, res).catch(() => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
  });
}

/** UI and `pixo agent` CLI: catalogue with prices, and credits used by one run. */
export function registerOpenPixoAgentRoutes(app: Express, { account, gateway }: RegisterOpenPixoAgentRoutesDeps): void {
  const endpoint = (handler: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await handler(req)); }
    catch (error) { const failure = accountError(error); res.status(failure.status).json(failure.response()); }
  };
  app.get('/api/openpixo/agent/models', endpoint(async (): Promise<OpenPixoAgentCatalogResponse> => {
    const [catalog, signedIn] = await Promise.all([account.agentModels(), account.hasSession()]);
    return { ...catalog, signedIn };
  }));
  app.get('/api/openpixo/agent/runs/:runId/usage', async (req, res) => {
    const runId = String(req.params.runId);
    if (!AGENT_RUN_KEY.test(runId)) return sendApiError(res, 400, 'BAD_REQUEST', 'Use a valid run id.');
    return endpoint(async (): Promise<OpenPixoAgentRunUsageResponse> => ({
      runId,
      local: gateway.runUsage(runId) ?? { runKey: runId, requests: 0, openRequests: 0, inputTokens: 0, cachedInputTokens: 0,
        outputTokens: 0, costMicrocredits: 0, creditsCharged: 0 },
      // The cloud's settled totals; null when signed out or unreachable.
      cloud: await account.agentRunUsage(runId).catch(() => null),
    }))(req, res);
  });
}
