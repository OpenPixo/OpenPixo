import { mkdir } from 'node:fs/promises';
import type { Express, NextFunction, Request, Response } from 'express';
import {
  GAME_PLAN_CONCEPT_IMAGE_LIMIT,
  gamePlanIsPending,
  parseArtBudgetCredits,
  type ApproveGamePlanRequest,
  type ApproveGamePlanResponse,
  type GamePlanResponse,
  type GameScaffoldRequest,
  type GameScaffoldResponse,
  type Project,
} from '@openpixo/contracts';
import { readAppConfig } from '../app-config.js';
import { getProject, updateProject } from '../db.js';
import { detectEngineProfile } from '../game/engine-detect.js';
import { approvedPlanText, folderHoldsExistingWork } from '../game/plan.js';
import { copyGameTemplateInto, GameTemplateError, gameTemplateErrorCode } from '../game/templates.js';
import { bearerTokenFromRequest, isAgentToken } from '../http/tool-request-auth.js';
import { resolveProjectDir } from '../projects.js';
import type { RouteDeps } from '../server-context.js';
import { toolTokenRegistry } from '../tool-tokens.js';
import { setArtBudgetForUser, type ArtBudgetDeps } from './art-budget.js';

export const GAME_PLAN_NOT_APPROVED = 'GAME_PLAN_NOT_APPROVED';

interface ProjectStore {
  get(id: string): Project | null | undefined;
  update(id: string, patch: { metadata: NonNullable<Project['metadata']> }): Project | null | undefined;
  /**
   * The next turn starts a new agent session from the transcript. A runtime may
   * keep the sandbox a thread was opened with, and building must not inherit
   * the read-only one from planning.
   */
  forgetAgentSessions(projectId: string): void;
  /** The newest non-empty agent message in any of the project's conversations: the plan being approved. */
  latestAgentMessage(projectId: string): string | null;
}

export interface RegisterGamePlanRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  templatesRoot: string;
  /** True while the project has an active run; an agent's shell only exists during one. */
  isProjectBusy: (projectId: string) => boolean;
  /** Defaults to the project table; route tests stub it. */
  store?: ProjectStore;
  /** The user may approve an art budget together with the plan. */
  artBudget: ArtBudgetDeps;
}

/**
 * The approval gate for a new game. Reading and approving stay with the local
 * user (UI and `pixo game plan`): approval refuses an agent's token, and waits
 * while a run is active because that is the only time an agent has a shell.
 * Two more things wait for approval here: a starter copied into the project,
 * and what an agent may spend, guarded ahead of the media and recipe routes.
 */
export function registerGamePlanRoutes(app: Express, ctx: RegisterGamePlanRoutesDeps): void {
  const { http } = ctx;
  const store: ProjectStore = ctx.store ?? {
    get: id => getProject(ctx.db, id) as Project | null | undefined,
    update: (id, patch) => updateProject(ctx.db, id, patch) as Project | null | undefined,
    forgetAgentSessions: (projectId) => {
      ctx.db.prepare(`DELETE FROM agent_sessions WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)`).run(projectId);
    },
    latestAgentMessage: (projectId) => {
      const row = ctx.db.prepare(`SELECT m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.project_id = ? AND m.role = 'assistant' AND TRIM(m.content) != ''
        ORDER BY m.created_at DESC, m.position DESC LIMIT 1`).get(projectId) as { content?: unknown } | undefined;
      return typeof row?.content === 'string' ? row.content : null;
    },
  };

  app.get('/api/projects/:id/game-plan', http.requireLocalDaemonRequest, async (req, res) => {
    const id = String(req.params.id);
    const project = store.get(id);
    if (!project) return http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    if (!await ctx.authorizeProjectRequest(req, res, id, { mode: 'read' })) return;
    res.setHeader('Cache-Control', 'no-store');
    const body: GamePlanResponse = { plan: project.metadata?.gamePlan ?? null };
    return res.json(body);
  });

  app.post('/api/projects/:id/game-plan/approve', http.requireLocalDaemonRequest, async (req, res) => {
    const id = String(req.params.id);
    const project = store.get(id);
    if (!project) return http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    if (isAgentToken(req)) return http.sendApiError(res, 403, 'FORBIDDEN', 'Only the user can approve the plan');
    if (!http.isLocalSameOrigin(req, http.resolvedPortRef.current)) return http.sendApiError(res, 403, 'FORBIDDEN', 'local origin required');
    if (!await ctx.authorizeProjectRequest(req, res, id, { mode: 'write', capability: 'writeFiles' })) return;
    const plan = project.metadata?.gamePlan;
    if (!plan) return http.sendApiError(res, 400, 'BAD_REQUEST', 'This project has no plan to approve');
    const requested = (req.body as ApproveGamePlanRequest | undefined)?.artBudgetCredits;
    const credits = requested === undefined ? undefined : parseArtBudgetCredits(requested);
    if (credits === null) return http.sendApiError(res, 400, 'BAD_REQUEST', 'artBudgetCredits must be a whole number');
    if (plan.status === 'approved' && credits === undefined) {
      const body: ApproveGamePlanResponse = { plan, project };
      return res.json(body);
    }
    if (ctx.isProjectBusy(id)) return http.sendApiError(res, 409, 'RUN_ACTIVE', 'The plan can be approved when the current run has ended');
    if (credits !== undefined) {
      const outcome = await setArtBudgetForUser(ctx.artBudget, id, credits);
      if (!outcome.ok) return http.sendApiError(res, outcome.status, outcome.code, outcome.message);
    }
    if (plan.status === 'approved') {
      const body: ApproveGamePlanResponse = { plan, project };
      return res.json(body);
    }
    // Approval waits for the run to end, so the newest agent message is the one the user just read.
    const recorded = approvedPlanText(store.latestAgentMessage(id));
    const approved = { ...plan, status: 'approved' as const, approvedAt: Date.now(), ...(recorded ? { approvedPlan: recorded } : {}) };
    const updated = store.update(id, { metadata: { ...project.metadata!, gamePlan: approved } });
    if (!updated) return http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    store.forgetAgentSessions(id);
    const body: ApproveGamePlanResponse = { plan: approved, project: updated };
    return res.json(body);
  });

  app.post('/api/projects/:id/game/scaffold', http.requireLocalDaemonRequest, async (req, res) => {
    const id = String(req.params.id);
    const project = store.get(id);
    if (!project) return http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    const write = { mode: 'write' as const, capability: 'writeFiles' as const };
    if (isAgentToken(req)) {
      const validation = toolTokenRegistry.validate(bearerTokenFromRequest(req), { operation: 'game:scaffold', endpoint: '/api/projects/:id/game/scaffold' });
      if (!validation.ok || validation.grant.projectId !== id) {
        return http.sendApiError(res, 403, 'FORBIDDEN', 'A valid token for this project is required');
      }
      if (!await ctx.authorizeProjectToolRequest(res, id, write)) return;
    } else {
      if (!http.isLocalSameOrigin(req, http.resolvedPortRef.current)) return http.sendApiError(res, 403, 'FORBIDDEN', 'local origin required');
      if (!await ctx.authorizeProjectRequest(req, res, id, write)) return;
    }
    const { templateId } = (req.body ?? {}) as Partial<GameScaffoldRequest>;
    if (typeof templateId !== 'string' || !templateId) return http.sendApiError(res, 400, 'BAD_REQUEST', 'templateId required');
    if (gamePlanIsPending(project.metadata)) {
      return http.sendApiError(res, 409, GAME_PLAN_NOT_APPROVED, 'The user has not approved the plan yet');
    }
    try {
      const projectDir = resolveProjectDir(ctx.paths.PROJECTS_DIR, id, project.metadata);
      await mkdir(projectDir, { recursive: true });
      if (await folderHoldsExistingWork(projectDir)) {
        return http.sendApiError(res, 409, 'PROJECT_NOT_EMPTY', 'This project already holds files, so a starter would overwrite them');
      }
      const files = await copyGameTemplateInto(ctx.templatesRoot, templateId, projectDir);
      const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
      const profile = detectEngineProfile(projectDir, { enginePaths: config.gameEnginePaths ?? {} });
      const latest = store.get(id);
      if (latest?.metadata) store.update(id, { metadata: { ...latest.metadata, engineProfile: profile } });
      const body: GameScaffoldResponse = { templateId, engine: profile.engine, projectDir, files };
      return res.json(body);
    } catch (error) {
      const status = error instanceof GameTemplateError && error.reasonCode === 'TEMPLATE_NOT_FOUND' ? 404 : 400;
      return http.sendApiError(res, status, gameTemplateErrorCode(error), error instanceof Error ? error.message : String(error));
    }
  });

  function hold(res: Response, message: string) {
    return http.sendApiError(res, 409, GAME_PLAN_NOT_APPROVED, message);
  }

  /** The project an agent's token acts on, when it is still being planned. */
  function plannedProjectOfAgent(req: Request): Project | null {
    if (!isAgentToken(req)) return null;
    const validation = toolTokenRegistry.validate(bearerTokenFromRequest(req), { operation: 'media:generate' });
    if (!validation.ok) return null;
    const project = store.get(validation.grant.projectId);
    return project && gamePlanIsPending(project.metadata) ? project : null;
  }

  // Registered ahead of the media routes, which then answer as usual. Each
  // attempt counts, so a failing provider cannot retry without limit either.
  const conceptImageGuard = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') { next(); return; }
    const project = plannedProjectOfAgent(req);
    if (!project?.metadata?.gamePlan) { next(); return; }
    if (req.body?.surface !== 'image') { hold(res, 'Only concept images can be generated before the user approves the plan'); return; }
    const plan = project.metadata.gamePlan;
    const used = plan.conceptImages ?? 0;
    if (used >= GAME_PLAN_CONCEPT_IMAGE_LIMIT) {
      hold(res, `The ${GAME_PLAN_CONCEPT_IMAGE_LIMIT} concept images allowed before approval are used. Ask the user to choose from what they have, or to approve the plan`);
      return;
    }
    store.update(project.id, { metadata: { ...project.metadata, gamePlan: { ...plan, conceptImages: used + 1 } } });
    next();
  };
  // `use`, because each of these paths has one owner route that does the work.
  app.use('/api/tools/media/generate', conceptImageGuard);
  app.use('/api/projects/:id/media/generate', conceptImageGuard);
  app.use('/api/projects/:id/recipe-runs', (req, res, next) => {
    if (req.method === 'POST' && plannedProjectOfAgent(req)) { hold(res, 'Asset recipes wait until the user approves the plan'); return; }
    next();
  });
}
