import type { Express, Request, Response } from 'express';
import {
  ART_APPROVAL_OVER_BUDGET,
  ART_BUDGET_OVER_BALANCE,
  parseArtApprovalCredits,
  parseArtBudgetCredits,
  parseArtSpendingMode,
  suggestedArtBudgetCredits,
  type ArtBudgetAccountFacts,
  type ArtBudgetResponse,
  type OpenPixoCreditsSummary,
  type OpenPixoGenerationServicesResponse,
} from '@openpixo/contracts';
import { accountError } from '../account/errors.js';
import { getProject } from '../db.js';
import type { ArtBudgetLedger } from '../game/art-budget.js';
import { bearerTokenFromRequest, isAgentToken } from '../http/tool-request-auth.js';
import type { RouteDeps } from '../server-context.js';
import { toolTokenRegistry } from '../tool-tokens.js';

const IMAGE_SERVICE = 'openpixo-image';
/** The UI re-reads this while a run makes art; a hint on a page need not hit the cloud each time. */
const BALANCE_TTL_MS = 30_000;
const SERVICES_TTL_MS = 5 * 60_000;

/** What setting a budget needs, shared by this route and plan approval. */
export interface ArtBudgetDeps {
  ledger: ArtBudgetLedger;
  account: {
    hasSession(): Promise<boolean>;
    balance(): Promise<OpenPixoCreditsSummary>;
    generationServices(): Promise<OpenPixoGenerationServicesResponse>;
  };
  /** True while the project has an active run; an agent's shell only exists during one. */
  isProjectBusy: (projectId: string) => boolean;
}

const RUN_ACTIVE_MESSAGE = 'The art budget can be changed when the current run has ended';

export type ArtBudgetSetOutcome =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

/**
 * Sets a budget for the user. Waits while a run is active, because that is the only
 * time an agent has a shell, so a token-less call from one cannot raise its own limit.
 * Only a raise asks the cloud: lowering or clearing must work signed out and offline.
 * The balance read is awaited, so a run that started meanwhile is checked for again.
 */
export async function setArtBudgetForUser(deps: ArtBudgetDeps, projectId: string, credits: number): Promise<ArtBudgetSetOutcome> {
  const runActive: ArtBudgetSetOutcome = { ok: false, status: 409, code: 'RUN_ACTIVE', message: RUN_ACTIVE_MESSAGE };
  if (deps.isProjectBusy(projectId)) return runActive;
  const current = deps.ledger.read(projectId);
  if (credits > (current?.limitCredits ?? 0)) {
    let summary: OpenPixoCreditsSummary;
    try {
      summary = await deps.account.balance();
    } catch (error) {
      const failure = accountError(error);
      return { ok: false, status: failure.status, code: failure.code, message: failure.message };
    }
    const ceiling = (deps.ledger.read(projectId)?.usedCredits ?? 0) + summary.available;
    if (credits > ceiling) {
      return { ok: false, status: 400, code: ART_BUDGET_OVER_BALANCE, message: `The art budget cannot be more than your balance allows (${ceiling} credits).` };
    }
    if (deps.isProjectBusy(projectId)) return runActive;
  }
  deps.ledger.setLimit(projectId, credits);
  return { ok: true };
}

/**
 * Records the art card the user approved. The user's alone, on the same terms as the
 * budget: an agent's shell exists only during a run, so this waits for it to end.
 * It is at most what the budget has left, which stays the hard limit.
 */
export function approveArtForUser(deps: Pick<ArtBudgetDeps, 'ledger' | 'isProjectBusy'>, projectId: string, credits: number): ArtBudgetSetOutcome {
  if (deps.isProjectBusy(projectId)) return { ok: false, status: 409, code: 'RUN_ACTIVE', message: RUN_ACTIVE_MESSAGE };
  const budget = deps.ledger.read(projectId);
  const left = budget?.remainingCredits ?? 0;
  if (credits > left) {
    return { ok: false, status: 409, code: ART_APPROVAL_OVER_BUDGET,
      message: `This art card asks for ${credits} credits and the art budget has ${left} left. Raise the budget or approve less.` };
  }
  deps.ledger.approve(projectId, credits);
  return { ok: true };
}

export interface RegisterArtBudgetRoutesDeps extends RouteDeps<'db' | 'http' | 'authorizeProjectRequest'>, ArtBudgetDeps {
  /** Own image tools connected on this machine. */
  readImageTools: () => Promise<readonly string[]>;
}

/**
 * `GET` and `POST /api/projects/:id/art-budget`, and `POST .../art-budget/approve` for
 * an art card. Reading is open to the user and to an agent's token for its own
 * project; changing the budget or the spending mode and approving art are the
 * user's alone, see `setArtBudgetForUser` and `approveArtForUser`.
 */
export function registerArtBudgetRoutes(app: Express, ctx: RegisterArtBudgetRoutesDeps): void {
  const { http } = ctx;
  let balanceCache: { at: number; value: number } | null = null;
  let servicesCache: { at: number; value: number | null } | null = null;

  async function accountFacts(projectId: string): Promise<ArtBudgetAccountFacts> {
    const signedIn = await ctx.account.hasSession().catch(() => false);
    if (!signedIn) balanceCache = null;
    const now = Date.now();
    if (signedIn && (!balanceCache || now - balanceCache.at > BALANCE_TTL_MS)) {
      const value = await ctx.account.balance().then(summary => summary.available).catch(() => null);
      balanceCache = value === null ? null : { at: now, value };
    }
    if (!servicesCache || now - servicesCache.at > SERVICES_TTL_MS) {
      const value = await ctx.account.generationServices()
        .then(catalogue => catalogue.services.find(service => service.id === IMAGE_SERVICE)?.credits ?? null)
        .catch(() => null);
      servicesCache = value === null ? null : { at: now, value };
    }
    const availableCredits = signedIn && balanceCache ? balanceCache.value : null;
    return { signedIn, availableCredits, imageCredits: servicesCache?.value ?? null,
      maxCredits: availableCredits === null ? null : (ctx.ledger.read(projectId)?.usedCredits ?? 0) + availableCredits };
  }

  /** Everything the user's own surfaces show. */
  async function userState(id: string): Promise<ArtBudgetResponse> {
    const account = await accountFacts(id);
    const ownImageTool = (await ctx.readImageTools().catch(() => [])).length > 0;
    return { ...ledgerState(id), account, ownImageTool,
      suggestedCredits: suggestedArtBudgetCredits(account.availableCredits, ownImageTool) };
  }

  /** What an agent's token may read too: nothing about the account. */
  function ledgerState(id: string): ArtBudgetResponse {
    return { budget: ctx.ledger.read(id), mode: ctx.ledger.readMode(id), approval: ctx.ledger.readApproval(id), runActive: ctx.isProjectBusy(id) };
  }

  /** The guards every change shares: the user's alone, from this machine's own page or CLI. */
  async function userMayChange(req: Request, res: Response, id: string, refusal: string): Promise<boolean> {
    if (!getProject(ctx.db, id)) { http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return false; }
    if (isAgentToken(req)) { http.sendApiError(res, 403, 'FORBIDDEN', refusal); return false; }
    if (!http.isLocalSameOrigin(req, http.resolvedPortRef.current)) { http.sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return false; }
    return ctx.authorizeProjectRequest(req, res, id, { mode: 'write', capability: 'writeFiles' });
  }

  /** A valid agent token, granted for this project. */
  function agentMayRead(req: Request, projectId: string): boolean {
    const validation = toolTokenRegistry.validate(bearerTokenFromRequest(req), { operation: 'media:generate' });
    return validation.ok && validation.grant.projectId === projectId;
  }

  app.get('/api/projects/:id/art-budget', http.requireLocalDaemonRequest, async (req, res) => {
    const id = String(req.params.id);
    if (!getProject(ctx.db, id)) return http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    res.setHeader('Cache-Control', 'no-store');
    if (isAgentToken(req)) {
      if (!agentMayRead(req, id)) return http.sendApiError(res, 403, 'FORBIDDEN', 'A valid token for this project is required');
      return res.json(ledgerState(id));
    }
    if (!await ctx.authorizeProjectRequest(req, res, id, { mode: 'read' })) return;
    return res.json(await userState(id));
  });

  app.post('/api/projects/:id/art-budget', http.requireLocalDaemonRequest, async (req, res) => {
    const id = String(req.params.id);
    if (!await userMayChange(req, res, id, 'Only the user can set the art budget')) return;
    const { credits: rawCredits, mode: rawMode } = (req.body ?? {}) as { credits?: unknown; mode?: unknown };
    if (rawCredits === undefined && rawMode === undefined) return http.sendApiError(res, 400, 'BAD_REQUEST', 'credits or mode is required');
    const credits = rawCredits === undefined ? undefined : parseArtBudgetCredits(rawCredits);
    if (credits === null) return http.sendApiError(res, 400, 'BAD_REQUEST', 'credits must be a whole number');
    const mode = rawMode === undefined ? undefined : parseArtSpendingMode(rawMode);
    if (mode === null) return http.sendApiError(res, 400, 'BAD_REQUEST', 'mode must be ask or auto');
    // A mode change waits for the run like a budget change: letting a run switch to auto would let it spend unasked.
    if (ctx.isProjectBusy(id)) return http.sendApiError(res, 409, 'RUN_ACTIVE', RUN_ACTIVE_MESSAGE);
    if (credits !== undefined) {
      const outcome = await setArtBudgetForUser(ctx, id, credits);
      if (!outcome.ok) return http.sendApiError(res, outcome.status, outcome.code, outcome.message);
      balanceCache = null;
    }
    if (mode !== undefined) {
      // Checked again: setting a raise awaited the balance, and a run may have started meanwhile.
      if (ctx.isProjectBusy(id)) return http.sendApiError(res, 409, 'RUN_ACTIVE', RUN_ACTIVE_MESSAGE);
      ctx.ledger.setMode(id, mode);
    }
    return res.json(await userState(id));
  });

  app.post('/api/projects/:id/art-budget/approve', http.requireLocalDaemonRequest, async (req, res) => {
    const id = String(req.params.id);
    if (!await userMayChange(req, res, id, 'Only the user can approve art')) return;
    const credits = parseArtApprovalCredits((req.body ?? {}).credits);
    if (credits === null) return http.sendApiError(res, 400, 'BAD_REQUEST', 'credits must be a whole number above 0');
    const outcome = approveArtForUser(ctx, id, credits);
    if (!outcome.ok) return http.sendApiError(res, outcome.status, outcome.code, outcome.message);
    return res.json(await userState(id));
  });
}
