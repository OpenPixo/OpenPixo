import { skillFitsEngine } from '../game/default-skills.js';
import type { Express, Request, Response } from 'express';
import { RecipeAdoptRequestSchema, RecipeRunRequestSchema, resolveLocalizedText, type CharacterUpdateRequest, type EngineProfile, type ProjectMetadata, type RecipeCodeRunResponse, type RecipeDetail, type RecipeRunRequest } from '@openpixo/contracts';
import { getProject } from '../db.js';
import { resolveProjectDir } from '../projects.js';
import { readMaskedConfig } from '../media/config.js';
import type { HttpDeps, PathDeps, ResourceDeps } from '../server-context.js';
import type { RecipeExecutorDeps } from './executor.js';
import type { AuthorizeProjectRequest, AuthorizeProjectToolRequest } from '../projects/project-access.js';
import { publicErrorMessage } from '../http/api-errors.js';
import { sendValidatedFile } from '../http/send-file.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { toolTokenRegistry, type ToolTokenGrant } from '../tool-tokens.js';
import type { ArtBudgetLedger } from '../game/art-budget.js';
import { prepareAgentHostedRequest } from '../game/art-budget-spend.js';
import type { OpenPixoHostedMedia } from '../media/openpixo-hosted.js';
import { resolveProjectExtensions } from '../services/project-extensions.js';
import { discoverRecipes, findRecipe, recipeSummaries } from './catalog.js';
import { RecipeExecutor, RecipeSpendRefused, prepareRecipe, type RecipeHostedSpending } from './executor.js';
import { configuredRecipeProviders, hostedRecipeModelIds, modelsForRecipe, RecipeNoModelError, selectRecipeModel } from './models.js';
import { createCharacter, deleteCharacter, getCharacter, listCharacters, updateCharacter } from './characters.js';
import { renderRecipeTemplate } from './template.js';
import { resolveArtStyleForGeneration } from '../styles/service.js';

export interface RecipeRoutesDeps {
  db: RecipeExecutorDeps['db'];
  paths: Pick<PathDeps, 'RUNTIME_DATA_DIR' | 'PROJECT_ROOT' | 'PROJECTS_DIR' | 'USER_SKILLS_DIR' | 'SKILLS_DIR'> & { BUNDLED_PLUGINS_DIR: string };
  http: HttpDeps;
  authorizeProjectRequest: AuthorizeProjectRequest;
  authorizeProjectToolRequest: AuthorizeProjectToolRequest;
  mediaTasks: RecipeExecutorDeps['mediaTasks'];
  resources: Pick<ResourceDeps, 'listAllSkills'>;
  /** What lets an agent's image recipe pay a hosted model from the art budget; without it recipes never spend. */
  artBudget?: { ledger: ArtBudgetLedger; openpixoHosted: OpenPixoHostedMedia; hasSession: () => Promise<boolean> } | undefined;
}

export function registerRecipeRoutes(app: Express, ctx: RecipeRoutesDeps): RecipeExecutor {
  const executor = new RecipeExecutor({ runtimeDataDir: ctx.paths.RUNTIME_DATA_DIR, projectRoot: ctx.paths.PROJECT_ROOT, db: ctx.db, mediaTasks: ctx.mediaTasks });
  void executor.initialized.catch(error => console.error('[recipes] Initialization failed', error));
  const catalog = () => discoverRecipes(ctx.paths.BUNDLED_PLUGINS_DIR);
  const { requireLocalDaemonRequest, sendApiError, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  function fail(res: Response, error: unknown): void {
    if (error instanceof RecipeSpendRefused) { sendApiError(res, error.status, error.code, error.message); return; }
    const code = (error as NodeJS.ErrnoException).code;
    sendApiError(res, error instanceof RecipeNoModelError ? 409 : code === 'ENOENT' ? 404 : code === 'EEXIST' ? 409 : 400,
      error instanceof RecipeNoModelError ? error.code : 'RECIPE_INVALID', publicErrorMessage(error));
  }
  function mediaGrant(req: Request, res: Response): ToolTokenGrant | null | undefined {
    const token = bearerTokenFromRequest(req);
    if (!token?.startsWith('pixott_')) return undefined;
    // Recipes reuse the media generation capability, which already permits generation and project writes.
    const result = toolTokenRegistry.validate(token, { operation: 'media:generate', endpoint: '/api/tools/media/generate' });
    if (!result.ok) { sendApiError(res, 403, result.code, result.message); return null; }
    return result.grant;
  }
  async function project(req: Request, res: Response, write: boolean) {
    const id = String(req.params.id);
    const grant = mediaGrant(req, res); if (grant === null) return null;
    if (grant && grant.projectId !== id) { sendApiError(res, 403, 'FORBIDDEN', 'Project does not match tool token'); return null; }
    const value = getProject(ctx.db, id);
    if (!value) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return null; }
    const options = write ? { mode: 'write' as const, capability: 'writeFiles' as const } : { mode: 'read' as const };
    if (grant) { if (!await ctx.authorizeProjectToolRequest(res, id, options)) return null; }
    else {
      if (write && !isLocalSameOrigin(req, resolvedPortRef.current)) { sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return null; }
      if (!await ctx.authorizeProjectRequest(req, res, id, options)) return null;
    }
    return { id, value, grant: grant ?? null, root: resolveProjectDir(ctx.paths.PROJECTS_DIR, id, value.metadata) as string };
  }
  /**
   * The hosted models an agent's image recipe may fall back to, while the art budget
   * can pay, by the same test the run's prompt uses. A user's recipe run carries no
   * token and never spends.
   */
  async function hostedFallback(detail: RecipeDetail, target: { id: string; root: string; grant: ToolTokenGrant | null },
    request: RecipeRunRequest, engine: EngineProfile | null | undefined): Promise<string[]> {
    const recipe = detail.manifest.pixo!.recipe!;
    if (!ctx.artBudget || !target.grant || recipe.surface !== 'image') return [];
    const budget = ctx.artBudget.ledger.read(target.id);
    if (!budget || budget.limitCredits === 0 || budget.remainingCredits <= 0) return [];
    if (!await ctx.artBudget.hasSession().catch(() => false)) return [];
    const { references } = await prepareRecipe(detail, target.root, request, engine);
    return hostedRecipeModelIds(recipe, references.length > 0);
  }
  /** Prices and reserves each candidate as an agent's own hosted request would be. */
  function hostedSpending(target: { id: string; root: string; value: { metadata?: unknown } }, grant: ToolTokenGrant, service: string): RecipeHostedSpending {
    const { ledger, openpixoHosted } = ctx.artBudget!;
    return {
      media: openpixoHosted,
      prepare: input => prepareAgentHostedRequest({ ledger, hosted: openpixoHosted, grant, projectId: target.id,
        metadata: target.value.metadata as ProjectMetadata | undefined, projectDir: target.root, service, surface: 'image', prompt: input.prompt,
        // The executor resizes without pixel-art resampling, so it is priced that way too.
        pixelArt: false, body: { images: input.references, ...(input.aspect ? { aspect: input.aspect } : {}) }, variant: input.variant }),
      releaseIfNeverSubmitted: requestId => ledger.releaseIfNeverSubmitted(requestId),
    };
  }
  app.get('/api/recipes', requireLocalDaemonRequest, (req, res) => {
    try {
      if (mediaGrant(req, res) === null) return;
      res.json(recipeSummaries(catalog(), {
        ...(typeof req.query.surface === 'string' ? { surface: req.query.surface } : {}),
        ...(typeof req.query.category === 'string' ? { category: req.query.category } : {}),
        ...(typeof req.query.engine === 'string' ? { engine: req.query.engine } : {}),
      }));
    } catch (error) { fail(res, error); }
  });
  app.get('/api/recipes/:recipeId', requireLocalDaemonRequest, (req, res) => {
    try { if (mediaGrant(req, res) !== null) res.json(findRecipe(catalog(), String(req.params.recipeId))); }
    catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/recipe-runs', requireLocalDaemonRequest, async (req, res, next) => {
    try {
      const target = await project(req, res, true); if (!target) return;
      const request = RecipeRunRequestSchema.parse(req.body);
      const detail = findRecipe(catalog(), request.recipeId);
      const recipe = detail.manifest.pixo!.recipe!;
      const engine = target.value.metadata?.engineProfile;
      if (!recipe.engines.includes('any') && !recipe.engines.includes(engine?.engine ?? 'unknown')) throw new Error('Recipe does not support this project engine');
      if (recipe.surface === 'code') {
        const prepared = await prepareRecipe(detail, target.root, request, engine);
        const query = renderRecipeTemplate(resolveLocalizedText(detail.manifest.pixo!.useCase!.query, target.value.metadata?.locale), prepared.variables);
        const catalogSkills = await ctx.resources.listAllSkills();
        const enabled = await resolveProjectExtensions({ dataDir: ctx.paths.RUNTIME_DATA_DIR, projectId: target.id,
          skillsRoots: [ctx.paths.USER_SKILLS_DIR, ctx.paths.SKILLS_DIR], catalogSkills });
        const known = new Map([...catalogSkills, ...enabled.skills].map(skill => [skill.id, skill] as const));
        // A recipe for several engines names each engine's skill; only this project's ride along.
        const required = (detail.manifest.pixo!.context?.skills ?? []).map(ref => ref.ref ?? ref.path ?? '').filter(Boolean)
          .map(ref => ref.replace(/\/SKILL\.md$/, '').split('/').at(-1)!)
          .filter(id => { const skill = known.get(id); return !skill || skillFitsEngine(skill, engine?.engine); });
        // A recipe skill that exists in the catalog rides along as a per-turn skill (like an @-mention), in full;
        // only refs that resolve nowhere block the run. The project's enabled skills are not repeated here: the
        // run lists them in its skill index as on any turn, instead of inlining every one of them.
        const missingSkills = required.filter(ref => !known.has(ref));
        if (missingSkills.length) { const body: RecipeCodeRunResponse = { query, missingSkills, status: 'missing-skills' }; res.status(409).json(body); return; }
        // Continue through the existing /api/runs handler; it owns authorization, pins, and internalRunCreation.start.
        req.body = { projectId: target.id, message: query, skillIds: [...new Set(required)],
          ...(request.conversationId ? { conversationId: request.conversationId } : {}), ...(request.agentId ? { agentId: request.agentId } : {}),
          ...(request.model ? { model: request.model } : {}) };
        const json = res.json.bind(res);
        res.json = body => json(res.statusCode < 400 ? { ...body, query, missingSkills, status: 'started' } : body);
        req.url = '/api/runs'; next(); return;
      }
      const config = await readMaskedConfig(ctx.paths.PROJECT_ROOT);
      const hosted = await hostedFallback(detail, target, request, engine);
      const model = selectRecipeModel(recipe, modelsForRecipe(recipe), configuredRecipeProviders(config, process.env.NODE_ENV === 'test'), request.model, hosted);
      const artStyle = recipe.surface === 'image' ? await resolveArtStyleForGeneration(ctx.db, ctx.paths.PROJECT_ROOT, target.id, request.styleId) : null;
      const spending = hosted.includes(model.id) && target.grant ? hostedSpending(target, target.grant, model.id) : undefined;
      res.status(202).json(await executor.start(detail, target.id, target.root, request, model, engine, artStyle, spending));
    } catch (error) { fail(res, error); }
  });
  app.get('/api/projects/:id/recipe-runs/:runId', requireLocalDaemonRequest, async (req, res) => {
    try { const target = await project(req, res, false); if (target) { res.setHeader('Cache-Control', 'no-store'); res.json(await executor.get(target.id, String(req.params.runId))); } }
    catch (error) { fail(res, error); }
  });
  app.get('/api/projects/:id/recipe-runs/:runId/candidates/:candidateId/files/:index', requireLocalDaemonRequest, async (req, res) => {
    try {
      const target = await project(req, res, false); if (!target) return;
      const staged = await executor.stagedFile(target.id, String(req.params.runId), String(req.params.candidateId), Number(req.params.index));
      res.setHeader('Cache-Control', 'no-store');
      sendValidatedFile(res.type(staged.mime), staged.file);
    } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/recipe-runs/:runId/adopt', requireLocalDaemonRequest, async (req, res) => {
    try {
      const target = await project(req, res, true); if (!target) return;
      const request = RecipeAdoptRequestSchema.parse(req.body);
      res.json(await executor.adopt(target.id, String(req.params.runId), request.candidateIds, target.root));
    } catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/recipe-runs/:runId/cancel', requireLocalDaemonRequest, async (req, res) => {
    try { const target = await project(req, res, true); if (target) res.json(await executor.cancel(target.id, String(req.params.runId))); }
    catch (error) { fail(res, error); }
  });
  app.get('/api/projects/:id/characters', requireLocalDaemonRequest, async (req, res) => {
    try { const target = await project(req, res, false); if (target) res.json(await listCharacters(target.root)); }
    catch (error) { fail(res, error); }
  });
  app.get('/api/projects/:id/characters/:slug', requireLocalDaemonRequest, async (req, res) => {
    try { const target = await project(req, res, false); if (target) res.json(await getCharacter(target.root, String(req.params.slug))); }
    catch (error) { fail(res, error); }
  });
  app.post('/api/projects/:id/characters', requireLocalDaemonRequest, async (req, res) => {
    try { const target = await project(req, res, true); if (target) res.status(201).json(await createCharacter(target.root, req.body)); }
    catch (error) { fail(res, error); }
  });
  app.put('/api/projects/:id/characters/:slug', requireLocalDaemonRequest, async (req, res) => {
    try { const target = await project(req, res, true); if (target) res.json(await updateCharacter(target.root, String(req.params.slug), req.body as CharacterUpdateRequest)); }
    catch (error) { fail(res, error); }
  });
  app.delete('/api/projects/:id/characters/:slug', requireLocalDaemonRequest, async (req, res) => {
    try { const target = await project(req, res, true); if (target) { await deleteCharacter(target.root, String(req.params.slug)); res.json({ deleted: true }); } }
    catch (error) { fail(res, error); }
  });
  return executor;
}
