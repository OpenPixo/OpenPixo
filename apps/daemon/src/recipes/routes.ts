import { randomUUID } from 'node:crypto';
import { skillFitsEngine } from '../game/default-skills.js';
import type { Express, Request, Response } from 'express';
import { PRODUCT_CLI_NAME, RecipeAdoptRequestSchema, RecipeQuoteRequestSchema, RecipeRunRequestSchema, resolveLocalizedText, type CharacterUpdateRequest, type EngineProfile, type ProjectMetadata, type RecipeCodeRunResponse, type RecipeDetail, type RecipeRun, type RecipeRunListResponse, type RecipeRunQuote, type RecipeRunRequest } from '@openpixo/contracts';
import { getProject } from '../db.js';
import { ensureProject, resolveProjectDir } from '../projects.js';
import { readMaskedConfig } from '../media/config.js';
import type { HttpDeps, PathDeps, ResourceDeps } from '../server-context.js';
import type { RecipeExecutorDeps } from './executor.js';
import type { AuthorizeProjectRequest, AuthorizeProjectToolRequest } from '../projects/project-access.js';
import { publicErrorMessage } from '../http/api-errors.js';
import { sendValidatedFile } from '../http/send-file.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import { toolTokenRegistry, type ToolTokenGrant } from '../tool-tokens.js';
import type { ArtBudgetLedger } from '../game/art-budget.js';
import { planHostedRequest, prepareAgentHostedRequest, type AgentHostedRequest } from '../game/art-budget-spend.js';
import { accountError } from '../account/errors.js';
import type { MediaModel } from '../media/models.js';
import type { OpenPixoHostedMedia } from '../media/openpixo-hosted.js';
import { resolveProjectExtensions } from '../services/project-extensions.js';
import { discoverRecipes, findRecipe, recipeSummaries } from './catalog.js';
import { RecipeExecutor, RecipeSpendRefused, prepareRecipe, type RecipeHostedSpending, type RecipePricingInput } from './executor.js';
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
  /** What lets a recipe pay a hosted model, from the art budget or at a price the user confirmed; without it recipes never spend. */
  artBudget?: { ledger: ArtBudgetLedger; openpixoHosted: OpenPixoHostedMedia; hasSession: () => Promise<boolean> } | undefined;
}

/** A price the user was shown for every candidate of one run, held until it is spent or expires. */
interface HeldRecipeQuote {
  projectId: string;
  /** The request it priced, in canonical form; a run must ask for exactly this. */
  key: string;
  model: MediaModel;
  requests: AgentHostedRequest[];
  expiresAt: number;
  /** The run this price paid for; asking again returns it instead of starting another. */
  started?: Promise<RecipeRun> | undefined;
}
/** How long a spent price still answers with its run, so a retried request finds it. */
const SPENT_QUOTE_KEPT_MS = 60 * 60 * 1000;

/** Same request, same string, whatever order its object keys came in. */
function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sort(entry)])) : item;
  return JSON.stringify(sort(value));
}
const quotedRequest = (request: RecipeRunRequest) => { const { quoteId: _quote, conversationId: _conversation, agentId: _agent, ...rest } = request; return canonical(rest); };

/** The request body a hosted candidate is shaped and priced from: only its shape is read. */
function hostedBody(pricing: RecipePricingInput) {
  return { images: pricing.references, ...(pricing.aspect ? { aspect: pricing.aspect } : {}), ...(pricing.background ? { background: pricing.background } : {}),
    ...(pricing.voice !== undefined ? { voice: pricing.voice } : {}), ...(pricing.duration !== undefined ? { duration: pricing.duration } : {}) };
}

export function registerRecipeRoutes(app: Express, ctx: RecipeRoutesDeps): RecipeExecutor {
  const quotes = new Map<string, HeldRecipeQuote>();
  const pruneQuotes = () => {
    const now = Date.now();
    for (const [key, held] of quotes) if (held.expiresAt + (held.started ? SPENT_QUOTE_KEPT_MS : 0) <= now) quotes.delete(key);
  };
  const heldQuote = (id: string): HeldRecipeQuote | undefined => { pruneQuotes(); return quotes.get(id); };
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
    // A managed project gets its folder on its first write; a run, a quote or an adopt may be that first write.
    const root = write ? await ensureProject(ctx.paths.PROJECTS_DIR, id, value.metadata) : resolveProjectDir(ctx.paths.PROJECTS_DIR, id, value.metadata);
    return { id, value, grant: grant ?? null, root: root as string };
  }
  /**
   * The hosted models a recipe may fall back to once every own tool is out. For an
   * agent, only while the art budget can pay, by the same test the run's prompt uses.
   * For the user, whenever they are signed in: the run then needs a price they
   * confirmed (`…/recipe-runs/quote`).
   */
  async function hostedFallback(detail: RecipeDetail, target: { id: string; root: string; grant: ToolTokenGrant | null },
    request: RecipeRunRequest, engine: EngineProfile | null | undefined): Promise<string[]> {
    const recipe = detail.manifest.pixo!.recipe!;
    if (!ctx.artBudget || recipe.surface === 'code' || recipe.surface === 'video') return [];
    if (target.grant) {
      const budget = ctx.artBudget.ledger.read(target.id);
      if (!budget || budget.limitCredits === 0 || budget.remainingCredits <= 0) return [];
    }
    if (!await ctx.artBudget.hasSession().catch(() => false)) return [];
    const { references } = await prepareRecipe(detail, target.root, request, engine);
    return hostedRecipeModelIds(recipe, references.length > 0);
  }
  /** Prices and reserves each candidate as an agent's own hosted request would be. */
  function hostedSpending(target: { id: string; root: string; value: { metadata?: unknown } }, grant: ToolTokenGrant, service: string, surface: string): RecipeHostedSpending {
    const { ledger, openpixoHosted } = ctx.artBudget!;
    return {
      kind: 'budget',
      media: openpixoHosted,
      prepare: input => prepareAgentHostedRequest({ ledger, hosted: openpixoHosted, grant, projectId: target.id,
        metadata: target.value.metadata as ProjectMetadata | undefined, projectDir: target.root, service, surface, prompt: input.prompt,
        // The executor resizes without pixel-art resampling, so it is priced that way too.
        pixelArt: false, body: hostedBody(input), variant: input.variant }),
      releaseIfNeverSubmitted: requestId => ledger.releaseIfNeverSubmitted(requestId),
    };
  }
  /** The model a media recipe run would use, by the same rule the run itself applies. */
  async function chooseModel(detail: RecipeDetail, target: { id: string; root: string; grant: ToolTokenGrant | null }, request: RecipeRunRequest, engine: EngineProfile | null | undefined) {
    const recipe = detail.manifest.pixo!.recipe!;
    const config = await readMaskedConfig(ctx.paths.PROJECT_ROOT);
    const hosted = await hostedFallback(detail, target, request, engine);
    return { model: selectRecipeModel(recipe, modelsForRecipe(recipe), configuredRecipeProviders(config, process.env.NODE_ENV === 'test'), request.model, hosted), hosted };
  }
  const artStyleFor = (detail: RecipeDetail, projectId: string, request: RecipeRunRequest) => detail.manifest.pixo!.recipe!.surface === 'image'
    ? resolveArtStyleForGeneration(ctx.db, ctx.paths.PROJECT_ROOT, projectId, request.styleId) : Promise.resolve(null);
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
  app.get('/api/projects/:id/recipe-runs', requireLocalDaemonRequest, async (req, res) => {
    try {
      const target = await project(req, res, false); if (!target) return;
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) throw new Error('limit must be an integer from 1 to 500');
      const body: RecipeRunListResponse = { runs: await executor.list(target.id, {
        ...(typeof req.query.surface === 'string' ? { surface: req.query.surface } : {}),
        ...(typeof req.query.origin === 'string' ? { origin: req.query.origin } : {}), ...(limit !== undefined ? { limit } : {}) }) };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (error) { fail(res, error); }
  });
  // Prices every candidate of a run for the user to confirm. Nothing is spent here. Only the
  // local UI or the user's own CLI may ask: an agent's recipes are paid from the art budget.
  app.post('/api/projects/:id/recipe-runs/quote', requireLocalDaemonRequest, async (req, res) => {
    try {
      const target = await project(req, res, true); if (!target) return;
      if (target.grant) { sendApiError(res, 403, 'GENERATION_CONFIRMATION_REQUIRED', 'An agent\'s recipes are paid from the art budget; only the user confirms a price.'); return; }
      const request = RecipeQuoteRequestSchema.parse(req.body);
      const detail = findRecipe(catalog(), request.recipeId);
      const recipe = detail.manifest.pixo!.recipe!;
      if (recipe.surface === 'code') throw new Error('A code recipe starts an agent run and has no price here');
      const engine = target.value.metadata?.engineProfile;
      if (!recipe.engines.includes('any') && !recipe.engines.includes(engine?.engine ?? 'unknown')) throw new Error('Recipe does not support this project engine');
      const { model } = await chooseModel(detail, target, request, engine);
      const plan = await executor.plan(detail, target.root, request, model, engine, await artStyleFor(detail, target.id, request));
      if (model.provider !== 'openpixo') { const body: RecipeRunQuote = { paid: false, model: { provider: model.provider, id: model.id }, count: plan.count }; res.json(body); return; }
      const { openpixoHosted } = ctx.artBudget!;
      const requests: AgentHostedRequest[] = [];
      const candidates: Array<{ credits: number }> = [];
      let available = 0;
      let expiresAt = Number.POSITIVE_INFINITY;
      for (let variant = 0; variant < plan.count; variant++) {
        const planned = await planHostedRequest({ hosted: openpixoHosted, service: model.id, surface: recipe.surface, prompt: plan.pricing.prompt,
          pixelArt: false, body: hostedBody(plan.pricing), projectDir: target.root });
        if (!planned.ok) { sendApiError(res, planned.status, planned.code, planned.message); return; }
        const { prompt, aspect, style, duration, references, warnings } = planned.plan;
        let quote;
        try {
          quote = await openpixoHosted.quote(model.id, { prompt, ...(aspect ? { aspect } : {}), ...(style !== undefined ? { style } : {}),
            ...(duration !== undefined ? { duration } : {}) }, references);
        } catch (error) { const failure = accountError(error); res.status(failure.status).json(failure.response()); return; }
        requests.push({ quoteId: quote.quoteId, cloudRequestId: `recipe-${randomUUID()}`, prompt, aspect,
          ...(style !== undefined ? { style } : {}), ...(duration !== undefined ? { duration } : {}), warnings });
        candidates.push({ credits: quote.credits });
        available = quote.available;
        expiresAt = Math.min(expiresAt, Date.parse(quote.expiresAt) || Date.now());
      }
      const quoteId = randomUUID();
      pruneQuotes();
      quotes.set(quoteId, { projectId: target.id, key: quotedRequest(request), model, requests, expiresAt });
      const body: RecipeRunQuote = { paid: true, quoteId, model: { provider: model.provider, id: model.id }, count: plan.count,
        credits: candidates.reduce((sum, candidate) => sum + candidate.credits, 0), available, candidates,
        expiresAt: new Date(expiresAt).toISOString(), warnings: [...new Set(requests.flatMap(entry => entry.warnings))] };
      res.json(body);
    } catch (error) { fail(res, error); }
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
      if (request.quoteId) {
        // The user confirmed this price; it pays for exactly the run it was given for, once.
        if (target.grant) { sendApiError(res, 403, 'GENERATION_CONFIRMATION_REQUIRED', 'A price the user confirmed cannot pay for an agent\'s run.'); return; }
        const held = heldQuote(request.quoteId);
        if (!held || held.projectId !== target.id) { sendApiError(res, 409, 'RECIPE_QUOTE_UNKNOWN', 'This price has expired or was never given. Ask for a new one.'); return; }
        if (held.key !== quotedRequest(request)) { sendApiError(res, 409, 'RECIPE_QUOTE_MISMATCH', 'This run asks for something other than what was priced. Ask for a new price.'); return; }
        if (!held.started) {
          const artStyle = await artStyleFor(detail, target.id, request);
          held.started = executor.start(detail, target.id, target.root, request, held.model, engine, artStyle,
            { kind: 'confirmed', media: ctx.artBudget!.openpixoHosted, requests: held.requests }, 'user');
          held.started.catch(() => { held.started = undefined; });
        }
        res.status(202).json(await held.started);
        return;
      }
      const { model, hosted } = await chooseModel(detail, target, request, engine);
      if (model.provider === 'openpixo' && !target.grant) {
        sendApiError(res, 403, 'GENERATION_CONFIRMATION_REQUIRED', `This run spends credits. Price it first (\`${PRODUCT_CLI_NAME} recipe quote\`) and run it with that quote.`);
        return;
      }
      const artStyle = await artStyleFor(detail, target.id, request);
      const spending = hosted.includes(model.id) && target.grant ? hostedSpending(target, target.grant, model.id, recipe.surface) : undefined;
      res.status(202).json(await executor.start(detail, target.id, target.root, request, model, engine, artStyle, spending, target.grant ? 'agent' : 'user'));
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
