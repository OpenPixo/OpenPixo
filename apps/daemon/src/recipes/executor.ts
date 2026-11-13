import { constants, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { isRecipeRelativePath, type ArtStyle, type AssetOpRequest, type EngineProfile, type Recipe, type RecipeDetail, type RecipeRun, type RecipeRunOrigin, type RecipeRunRequest } from '@openpixo/contracts';
import { recordAssetProvenance } from '../assets/provenance-store.js';
import { runAssetOp } from '../assets/ops/index.js';
import { generateMedia } from '../media/index.js';
import type { createMediaTaskStore } from '../media/task-store.js';
import { mimeFor } from '../projects.js';
import type { MediaModel } from '../media/models.js';
import type { OpenPixoHostedMedia } from '../media/openpixo-hosted.js';
import type { AgentHostedDecision, AgentHostedRequest } from '../game/art-budget-spend.js';
import { getCharacter } from './characters.js';
import { checkRecipeFile } from './checks.js';
import { recipeFileName, recipePath } from './paths.js';
import { recipeVariables, renderRecipeParams, renderRecipeTemplate, validateRecipeInputs } from './template.js';
import { mergeImageArtStyle } from '../media/art-style.js';
import { applyRecipePostprocessStyle } from './postprocess-style.js';
import { spriteExportFormat } from '../assets/ops/export-spritesheet.js';
import { detectEngineProfile } from '../game/engine-detect.js';

export const RECIPE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const terminal = (run: RecipeRun) => ['ready', 'failed', 'cancelled'].includes(run.status);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function recipeFailure(error: unknown): { error: string; errorCode?: string; errorReason?: string } {
  const failure = error as { code?: unknown; reason?: unknown; reasonCode?: unknown } | null;
  const code = failure?.code ?? failure?.reasonCode;
  return { error: message(error), ...(typeof code === 'string' ? { errorCode: code } : {}),
    ...(typeof failure?.reason === 'string' ? { errorReason: failure.reason } : {}) };
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
interface StoredRun { run: RecipeRun; prompt: string; resolution?: string | undefined; background?: 'transparent' | undefined; output: { dir: string; name: string }; referenceHashes: string[] }
export interface RecipeExecutorDeps {
  runtimeDataDir: string;
  projectRoot: string;
  db: Database.Database;
  mediaTasks: ReturnType<typeof createMediaTaskStore>;
  generate?: typeof generateMedia;
  postprocess?: typeof runAssetOp;
}
export interface PreparedRecipe { inputs: Record<string, unknown>; variables: Record<string, unknown>; references: string[] }

/** What one hosted candidate is priced on, the same for the art budget and for the user's own quote. */
export interface RecipePricingInput {
  prompt: string;
  /** Project-relative reference images. */
  references: string[];
  aspect?: string | undefined;
  background?: 'transparent' | undefined;
  voice?: string | undefined;
  duration?: number | undefined;
}

/**
 * How a recipe pays a hosted model. Every candidate is paid for before the run
 * starts, so a refusal is the request's answer rather than a failed run.
 *
 * - `budget`: an agent's run, each candidate priced and reserved against the
 *   project's art budget as the agent's own hosted request would be.
 * - `confirmed`: a run the user started, carrying the price the user confirmed for
 *   every candidate (`POST …/recipe-runs/quote`). It is sent exactly as priced.
 */
export type RecipeHostedSpending =
  | { kind: 'budget'; media: OpenPixoHostedMedia;
      /** Prices and reserves one candidate; `variant` keeps identical candidates apart. */
      prepare(input: RecipePricingInput & { variant: number }): Promise<AgentHostedDecision>;
      /** Gives back a reservation that never reached the cloud. */
      releaseIfNeverSubmitted(requestId: string): void }
  | { kind: 'confirmed'; media: OpenPixoHostedMedia; requests: readonly AgentHostedRequest[] };

/** Everything a run will do, worked out before anything is spent or written. */
export interface RecipePlan {
  recipe: Recipe;
  prepared: PreparedRecipe;
  prompt: string;
  resolution?: string | undefined;
  background?: 'transparent' | undefined;
  output: { dir: string; name: string };
  count: number;
  steps: Array<{ op: AssetOpRequest['op']; params: Record<string, unknown>; optional?: boolean | undefined }>;
  aspect?: string | undefined;
  /** What each hosted candidate is priced on. */
  pricing: RecipePricingInput;
}

/** The art budget would not pay for this recipe; nothing was spent. */
export class RecipeSpendRefused extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export async function prepareRecipe(detail: RecipeDetail, projectRoot: string, request: RecipeRunRequest, engine?: EngineProfile | null): Promise<PreparedRecipe> {
  const recipe = detail.manifest.pixo!.recipe!;
  const supplied = { ...request.inputs };
  if (request.prompt !== undefined) {
    const slot = recipe.inputs.find(input => input.name === 'prompt') ?? recipe.inputs.find(input => input.type === 'text');
    if (!slot) throw new Error('Recipe has no free-text prompt slot');
    supplied[slot.name] = request.prompt;
  }
  const inputs = validateRecipeInputs(recipe, supplied);
  const characters = await Promise.all(recipe.inputs.filter(field => field.type === 'character-ref' && inputs[field.name])
    .map(field => getCharacter(projectRoot, String(inputs[field.name]))));
  if (characters.length > 1) throw new Error('Only one character-ref input is supported per recipe');
  const references = [...new Set([...recipe.inputs.filter(field => field.type === 'image-ref' && inputs[field.name]).map(field => String(inputs[field.name])), ...characters.flatMap(card => card.references)])];
  if (references.length > 5) throw new Error('At most five reference images are supported');
  for (const field of recipe.inputs.filter(field => ['image-ref', 'asset-ref', 'file'].includes(field.type ?? '') && inputs[field.name])) {
    const file = await recipePath(projectRoot, String(inputs[field.name]));
    if (!(await stat(file)).isFile()) throw new Error(`Reference is not a file: ${inputs[field.name]}`);
  }
  for (const ref of references) {
    const file = await recipePath(projectRoot, ref);
    if (!(await stat(file)).isFile() || !String(mimeFor(file)).startsWith('image/')) throw new Error(`Image reference required: ${ref}`);
  }
  return { inputs, variables: recipeVariables(inputs, engine, characters[0]), references };
}

export class RecipeExecutor {
  readonly root: string;
  private records = new Map<string, StoredRun>();
  private controllers = new Map<string, AbortController>();
  private jobs = new Map<string, Promise<void>>();
  private writes = new Map<string, Promise<void>>();
  private adopting = new Set<string>();
  readonly initialized: Promise<void>;
  constructor(private readonly deps: RecipeExecutorDeps) {
    this.root = path.join(deps.runtimeDataDir, 'recipe-runs');
    this.initialized = this.load();
  }
  private async load(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
      try {
        const record = JSON.parse(await readFile(await recipePath(this.root, `${entry.name}/record.json`), 'utf8')) as StoredRun;
        if (record.run.id !== entry.name || !Array.isArray(record.run.candidates) || !isRecipeRelativePath(record.output.dir)) throw new Error('Invalid run record');
        this.records.set(record.run.id, record);
        if (!terminal(record.run)) { record.run.status = 'failed'; record.run.error = 'Recipe interrupted by daemon restart'; await this.save(record); }
      } catch (error) { console.warn(`[recipes] Cannot restore ${entry.name}: ${message(error)}`); }
    }
    await this.cleanup();
  }
  private save(record: StoredRun): Promise<void> {
    record.run.updatedAt = Date.now();
    const json = JSON.stringify(record);
    const pending = (this.writes.get(record.run.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const dir = await recipePath(this.root, record.run.id);
      await mkdir(dir, { recursive: true });
      const temporary = path.join(dir, 'record.tmp');
      await writeFile(temporary, json);
      await rename(temporary, path.join(dir, 'record.json'));
    });
    this.writes.set(record.run.id, pending);
    return pending;
  }
  async cleanup(now = Date.now()): Promise<void> {
    for (const [id, record] of this.records) {
      if (terminal(record.run) && !this.adopting.has(id) && !this.jobs.has(id) && now - record.run.updatedAt > RECIPE_RETENTION_MS) {
        const dir = await recipePath(this.root, id);
        await rm(dir, { recursive: true, force: true });
        this.records.delete(id); this.writes.delete(id);
      }
    }
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name) || this.records.has(entry.name)) continue;
      const dir = await recipePath(this.root, entry.name);
      if (now - (await stat(dir)).mtimeMs > RECIPE_RETENTION_MS) await rm(dir, { recursive: true, force: true });
    }
  }
  async get(projectId: string, id: string): Promise<RecipeRun> {
    await this.initialized;
    const record = this.records.get(id);
    if (!record || record.run.projectId !== projectId) throw new Error('Recipe run not found');
    return structuredClone(record.run);
  }
  /** Absolute path of one staged candidate file, re-resolved inside the run's staging dir. */
  async stagedFile(projectId: string, id: string, candidateId: string, index: number): Promise<{ file: string; mime: string }> {
    const run = await this.get(projectId, id);
    const candidate = run.candidates.find(item => item.id === candidateId);
    const staged = candidate?.stagedFiles[index];
    if (!candidate || !staged) throw Object.assign(new Error('Staged file not found'), { code: 'ENOENT' });
    const candidateRoot = await recipePath(this.root, `${id}/${candidate.id}`);
    return { file: await recipePath(candidateRoot, path.relative(candidateRoot, staged.ref)), mime: staged.mime };
  }
  /** This project's runs on this machine, newest first. Nothing about them is kept anywhere else. */
  async list(projectId: string, filter: { surface?: string | undefined; origin?: string | undefined; limit?: number | undefined } = {}): Promise<RecipeRun[]> {
    await this.initialized;
    return [...this.records.values()].map(record => record.run)
      .filter(run => run.projectId === projectId && (!filter.surface || run.surface === filter.surface) && (!filter.origin || run.origin === filter.origin))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, filter.limit ?? 100).map(run => structuredClone(run));
  }
  async wait(projectId: string, id: string): Promise<RecipeRun> { await this.jobs.get(id); return this.get(projectId, id); }
  /**
   * Renders the run without starting it: prompt, output, count, post-processing and
   * the pricing input. A quote and the run it pays for both come from here, so the
   * run sends what was priced. A paid run makes one candidate unless asked for more.
   */
  async plan(detail: RecipeDetail, projectRoot: string, request: RecipeRunRequest, model: MediaModel, engine?: EngineProfile | null, artStyle: ArtStyle | null = null): Promise<RecipePlan> {
    const recipe = detail.manifest.pixo!.recipe!;
    if (recipe.surface === 'code') throw new Error(`No media backend for surface: ${recipe.surface}`);
    const paid = model.provider === 'openpixo';
    const prepared = await prepareRecipe(detail, projectRoot, request, engine);
    const basePrompt = renderRecipeTemplate(recipe.prompt!, prepared.variables);
    const negativePrompt = recipe.negative ? renderRecipeTemplate(recipe.negative, prepared.variables) : undefined;
    const imageRequest = recipe.surface === 'image' ? mergeImageArtStyle({ prompt: basePrompt, negativePrompt }, artStyle) : null;
    const prompt = imageRequest?.prompt ?? basePrompt + (negativePrompt ? `\nAvoid: ${negativePrompt}` : '');
    const output = { dir: renderRecipeTemplate(recipe.output!.dir, prepared.variables), name: recipeFileName(renderRecipeTemplate(recipe.output!.name, prepared.variables)) };
    if (!isRecipeRelativePath(output.dir)) throw new Error('Rendered output.dir must be relative and contain no ..');
    await recipePath(projectRoot, `${output.dir}/${output.name}`);
    const countInput = recipe.inputs.find(input => input.type === 'count');
    // Each paid candidate costs credits, so a paid run makes one unless asked for more.
    const askedCount = countInput && request.inputs?.[countInput.name] !== undefined ? Number(prepared.inputs[countInput.name]) || undefined : undefined;
    const count = paid ? request.count ?? askedCount ?? 1
      : request.count ?? (countInput ? Number(prepared.inputs[countInput.name]) || undefined : undefined) ?? recipe.generation?.count.default ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > (recipe.generation?.count.max ?? 4)) throw new Error('Count exceeds recipe limit');
    // Render the entire pipeline before submitting paid tasks.
    const steps = applyRecipePostprocessStyle((recipe.postprocess ?? []).map(step => ({ ...step, params: renderRecipeParams(step.params, prepared.variables) })),
      recipe.surface === 'image' ? artStyle : null, recipe.surface === 'image' ? prepared.inputs : {});
    for (const step of steps) {
      if (step.op === 'export-spritesheet' && (step.params.format === undefined || step.params.format === 'auto')) {
        step.params.format = spriteExportFormat(engine?.engine ?? detectEngineProfile(projectRoot, { resolveOnPath: () => null }).engine);
      }
    }
    for (const check of recipe.checks ?? []) renderRecipeParams(check.params, prepared.variables);
    const aspectField = recipe.inputs.find(input => input.type === 'aspect');
    const aspect = aspectField && prepared.inputs[aspectField.name] ? String(prepared.inputs[aspectField.name]) : recipe.generation?.aspect ? renderRecipeTemplate(recipe.generation.aspect, prepared.variables) : undefined;
    // A recipe that always wants a cutout says so; the plain image recipe lets the user choose.
    const background = recipe.surface === 'image' && (recipe.generation?.background === 'transparent' || prepared.inputs.transparent === true) ? 'transparent' as const : undefined;
    const duration = Number(prepared.variables.duration ?? prepared.variables.lengthSec);
    const voice = prepared.variables.voice;
    const pricing: RecipePricingInput = { prompt, references: prepared.references, ...(aspect ? { aspect } : {}), ...(background ? { background } : {}),
      ...(recipe.surface === 'audio' && typeof voice === 'string' && voice ? { voice } : {}),
      ...(recipe.surface === 'audio' && Number.isFinite(duration) ? { duration } : {}) };
    return { recipe, prepared, prompt, ...(imageRequest?.resolution ? { resolution: imageRequest.resolution } : {}), ...(background ? { background } : {}),
      output, count, steps, ...(aspect ? { aspect } : {}), pricing };
  }
  async start(detail: RecipeDetail, projectId: string, projectRoot: string, request: RecipeRunRequest, model: MediaModel, engine?: EngineProfile | null, artStyle: ArtStyle | null = null, hosted?: RecipeHostedSpending, origin: RecipeRunOrigin = 'user'): Promise<RecipeRun> {
    await this.initialized;
    const recipe = detail.manifest.pixo!.recipe!;
    if (recipe.surface === 'code') throw new Error(`No media backend for surface: ${recipe.surface}`);
    if (model.provider === 'stub' && process.env.NODE_ENV !== 'test') throw new Error('Stub provider is only allowed in tests');
    const paid = model.provider === 'openpixo';
    if (paid && (!hosted || recipe.surface === 'video')) throw new RecipeSpendRefused(403, 'GENERATION_CONFIRMATION_REQUIRED', 'This recipe would spend credits: the user confirms a price first, or an agent pays from the art budget.');
    const plan = await this.plan(detail, projectRoot, request, model, engine, artStyle);
    const { prepared, prompt, output, steps, aspect } = plan;
    let count = plan.count;
    if (paid && hosted!.kind === 'confirmed') {
      // What the user confirmed is what runs: as many candidates as were priced.
      count = hosted!.requests.length;
      if (count < 1 || count > (recipe.generation?.count.max ?? 4)) throw new Error('Count exceeds recipe limit');
    }
    const id = randomUUID();
    const referenceBytes = await Promise.all(prepared.references.map(async ref => ({ bytes: await readFile(await recipePath(projectRoot, ref)), ext: path.extname(ref) })));
    // In order, so each reservation sees the ones before it; one refusal gives the others back.
    const paidRequests: AgentHostedRequest[] = [];
    const budget = paid && hosted!.kind === 'budget' ? hosted! : null;
    const releasePaid = () => { if (budget) for (const reserved of paidRequests) budget.releaseIfNeverSubmitted(reserved.cloudRequestId); };
    if (budget) {
      for (let variant = 0; variant < count; variant++) {
        const decision = await budget.prepare({ ...plan.pricing, variant }).catch((error: unknown) => { releasePaid(); throw error; });
        if (!decision.ok) { releasePaid(); throw new RecipeSpendRefused(decision.status, decision.code, decision.message); }
        paidRequests.push(decision.hosted);
      }
    } else if (paid && hosted!.kind === 'confirmed') paidRequests.push(...hosted!.requests);
    const surface = recipe.surface as Exclude<Recipe['surface'], 'code'>;
    const record: StoredRun = { run: { id, projectId, recipeId: detail.id, recipeVersion: detail.version, surface, origin, inputs: prepared.inputs, ...(recipe.surface === 'image' ? { styleId: artStyle?.id ?? null } : {}),
      model: { provider: model.provider, id: model.id }, status: 'queued', candidates: Array.from({ length: count }, (_, index) => ({ id: randomUUID(), index, stagedFiles: [], checks: [] })), createdAt: Date.now(), updatedAt: Date.now() },
      prompt, ...(plan.resolution ? { resolution: plan.resolution } : {}),
      ...(plan.background ? { background: plan.background } : {}), output, referenceHashes: referenceBytes.map(ref => hash(ref.bytes)) };
    this.records.set(id, record);
    try { await this.save(record); }
    catch (error) { releasePaid(); throw error; }
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const paidFor = paid ? { media: hosted!.media, requests: paidRequests } : undefined;
    const job = this.execute(record, surface, model, referenceBytes, steps, recipe.checks ?? [], prepared.variables, controller.signal, aspect, paidFor)
      .catch(async error => { if (record.run.status !== 'cancelled') { record.run.status = 'failed'; Object.assign(record.run, recipeFailure(error)); await this.save(record); } })
      // A candidate cancelled or failed before its submit leaves its reservation unused.
      .finally(() => { releasePaid(); this.jobs.delete(id); this.controllers.delete(id); });
    this.jobs.set(id, job);
    return structuredClone(record.run);
  }
  private async execute(record: StoredRun, surface: 'image' | 'audio' | 'video' | 'model3d', model: MediaModel,
    refs: Array<{ bytes: Buffer; ext: string }>, steps: Array<{ op: AssetOpRequest['op']; params: Record<string, unknown>; optional?: boolean | undefined }>,
    checks: NonNullable<Recipe['checks']>,
    variables: Record<string, unknown>, signal: AbortSignal, aspect?: string,
    paidFor?: { media: OpenPixoHostedMedia; requests: readonly AgentHostedRequest[] }): Promise<void> {
    const run = record.run;
    const cancelled = () => signal.aborted || run.status === 'cancelled';
    if (cancelled()) return;
    run.status = 'generating'; await this.save(record);
    await Promise.all(run.candidates.map(async candidate => {
      if (cancelled()) return;
      const candidateRoot = await recipePath(this.root, `${run.id}/${candidate.id}`);
      await mkdir(candidateRoot, { recursive: true });
      const images: string[] = [];
      for (const [index, ref] of refs.entries()) {
        const name = `references/${index}${ref.ext}`;
        const file = await recipePath(candidateRoot, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, ref.bytes); images.push(name);
      }
      if (cancelled()) return;
      const task = this.deps.mediaTasks.createMediaTask(randomUUID(), run.projectId, { surface, model: model.id });
      candidate.mediaTaskId = task.id; task.status = 'running'; this.deps.mediaTasks.persistMediaTask(task);
      try {
        const audioKind = model.caps.includes('tts') ? 'speech' : model.caps.includes('sfx') ? 'sfx' : 'music';
        const paidRequest = paidFor?.requests[candidate.index];
        const meta = await (this.deps.generate ?? generateMedia)({ projectRoot: this.deps.projectRoot, runtimeDataDir: this.deps.runtimeDataDir, signal,
          // What was priced is sent as priced; the job counts against the project, the file lands in staging.
          ...(paidFor && paidRequest ? { openpixoHosted: paidFor.media, hosted: { ...paidRequest, taskId: task.id, projectId: run.projectId } } : {}),
          projectsRoot: path.dirname(candidateRoot), projectId: path.basename(candidateRoot), surface, model: model.id,
          prompt: record.prompt, output: `primary.${surface === 'image' ? 'png' : surface === 'audio' ? 'wav' : surface === 'model3d' ? 'glb' : 'mp4'}`,
          images, ...(record.resolution ? { resolution: record.resolution } : {}), ...(aspect ? { aspect } : {}), ...(surface === 'audio' ? { audioKind } : {}),
          ...(surface === 'image' && record.background ? { background: record.background } : {}),
          ...(Number.isFinite(Number(variables.duration ?? variables.lengthSec)) ? { duration: Number(variables.duration ?? variables.lengthSec) } : {}),
          ...(typeof variables.voice === 'string' ? { voice: variables.voice } : {}),
          ...(typeof variables.language === 'string' ? { language: variables.language } : {}),
          onProgress: line => this.deps.mediaTasks.appendTaskProgress(task, line),
        });
        if (meta.providerError || ((meta.providerId === 'stub' || model.provider === 'stub' || meta.intentionalStub || meta.usedStubFallback) && process.env.NODE_ENV !== 'test')) throw new Error(meta.providerError || 'Stub provider output rejected');
        task.status = 'done';
        if (cancelled()) return;
        const primary = await recipePath(candidateRoot, meta.name);
        if (cancelled()) return;
        // A staged file has no project filename yet; legacy media cards must not resolve it against game files.
        task.file = { ref: primary, mime: meta.mime, recipeRunId: run.id, candidateId: candidate.id };
        candidate.stagedFiles.push({ role: 'primary', ref: primary, mime: meta.mime });
        let current = [meta.name];
        let gridSources = current;
        run.status = 'postprocessing'; await this.save(record);
        for (const [index, step] of steps.entries()) {
          if (cancelled()) return;
          try {
            if (step.op === 'slice') gridSources = current;
            const report = await (this.deps.postprocess ?? runAssetOp)({ projectRoot: candidateRoot }, { op: step.op, inputs: current, params: step.params, out: `derived/${index}-${step.op}` });
            if (report.counts.failed) throw new Error(report.results.find(result => result.error)?.error ?? `${step.op} failed`);
            const outputs = [...new Set(report.results.flatMap(result => [result.output, ...result.extraOutputs ?? []]))].filter((file): file is string => Boolean(file));
            for (const file of outputs) {
              const ref = await recipePath(candidateRoot, file);
              candidate.stagedFiles.push({ role: 'derived', ref, mime: String(mimeFor(file)) });
            }
            const mediaOutputs = outputs.filter(file => /\.(png|jpe?g|webp|wav|mp3|ogg|flac|mp4)$/i.test(file));
            if (mediaOutputs.length && step.op !== 'seamless-check') current = mediaOutputs;
          } catch (error) {
            if (!step.optional) throw error;
            candidate.checks.push({ check: `postprocess:${step.op}`, ok: false, detail: message(error) });
          }
        }
        for (const check of checks) {
          if (cancelled()) return;
          const files = check.check === 'grid-divisible' ? gridSources : current;
          for (const file of files) candidate.checks.push(await checkRecipeFile(await recipePath(candidateRoot, file), check, variables));
        }
      } catch (error) {
        const failure = recipeFailure(error);
        if (!cancelled()) Object.assign(candidate, failure);
        if (task.status !== 'done') { task.status = 'failed'; task.error = { message: failure.error, ...(failure.errorCode ? { code: failure.errorCode } : {}) }; }
      } finally {
        task.endedAt = Date.now(); this.deps.mediaTasks.persistMediaTask(task); this.deps.mediaTasks.notifyTaskWaiters(task);
        if (cancelled()) { candidate.stagedFiles = []; candidate.checks = []; }
        await this.save(record);
      }
    }));
    if (cancelled()) return;
    run.status = run.candidates.some(candidate => candidate.stagedFiles.length && !candidate.error) ? 'ready' : 'failed';
    if (run.status === 'failed') {
      const failure = run.candidates.find(candidate => candidate.errorCode) ?? run.candidates.find(candidate => candidate.error);
      run.error = failure?.error ?? 'All candidates failed';
      if (failure?.errorCode) run.errorCode = failure.errorCode;
      if (failure?.errorReason) run.errorReason = failure.errorReason;
    }
    await this.save(record);
  }
  async cancel(projectId: string, id: string): Promise<RecipeRun> {
    await this.get(projectId, id);
    const record = this.records.get(id)!;
    if (!terminal(record.run)) {
      record.run.status = 'cancelled'; this.controllers.get(id)?.abort(); await this.save(record);
    }
    // Providers that finish after abort still leave their results quarantined.
    return this.get(projectId, id);
  }
  async adopt(projectId: string, id: string, candidateIds: string[], projectRoot: string): Promise<RecipeRun> {
    await this.get(projectId, id);
    const record = this.records.get(id)!;
    if (record.run.status !== 'ready') throw new Error('Recipe run is not ready for adoption');
    if (this.adopting.has(id)) throw new Error('Adoption already in progress');
    const candidates = [...new Set(candidateIds)].map(candidateId => {
      const candidate = record.run.candidates.find(candidate => candidate.id === candidateId);
      if (!candidate || candidate.error || !candidate.stagedFiles.length) throw new Error('Candidate is unavailable');
      return candidate;
    });
    this.adopting.add(id);
    try {
      for (const candidate of candidates) {
        if (candidate.adoptedPaths?.length) continue;
        const written: string[] = [];
        try {
          const candidateRoot = await recipePath(this.root, `${id}/${candidate.id}`);
          for (const [index, file] of candidate.stagedFiles.entries()) {
            const source = await recipePath(candidateRoot, path.relative(candidateRoot, file.ref));
            const stem = recipeFileName(index === 0 ? record.output.name : `${record.output.name}_${path.basename(file.ref, path.extname(file.ref))}`);
            let rel = '';
            for (let suffix = 0; ; suffix++) {
              rel = path.posix.join(record.output.dir.replaceAll('\\', '/'), `${stem}${suffix ? `_${suffix}` : ''}${path.extname(file.ref)}`);
              const destination = await recipePath(projectRoot, rel); await mkdir(path.dirname(destination), { recursive: true });
              await recipePath(projectRoot, rel);
              try { await copyFile(source, destination, constants.COPYFILE_EXCL); written.push(rel); break; }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
            }
          }
          // Slice/atlas descriptors refer to staged files; suffixes and adoption must move those references too.
          const adopted = new Map(candidate.stagedFiles.map((file, index) => [path.relative(candidateRoot, file.ref).replaceAll('\\', '/'), written[index]!]));
          for (const [index, file] of candidate.stagedFiles.entries()) {
            if (path.extname(file.ref).toLowerCase() === '.tres') {
              const destination = written[index]!;
              const sourceDir = path.posix.dirname(path.relative(candidateRoot, file.ref).replaceAll('\\', '/'));
              const target = await recipePath(projectRoot, destination);
              const source = await readFile(target, 'utf8');
              const rewritten = source.replace(/\bpath=("(?:[^"\\]|\\.)*")/g, (field, quoted: string) => {
                const value = JSON.parse(quoted) as string;
                const reference = value.startsWith('res://') ? value.slice(6) : path.posix.join(sourceDir, value);
                const mapped = adopted.get(reference);
                return mapped ? `path=${JSON.stringify(`res://${mapped}`)}` : field;
              });
              await writeFile(target, rewritten);
              continue;
            }
            if (path.extname(file.ref).toLowerCase() !== '.json') continue;
            const sourceDir = path.posix.dirname(path.relative(candidateRoot, file.ref).replaceAll('\\', '/'));
            const destination = written[index]!;
            const rewrite = (value: unknown): unknown => {
              if (typeof value === 'string') {
                const direct = adopted.get(value); if (direct) return direct;
                const sibling = adopted.get(path.posix.join(sourceDir, value));
                return sibling ? path.posix.relative(path.posix.dirname(destination), sibling) : value;
              }
              if (Array.isArray(value)) return value.map(rewrite);
              if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, rewrite(val)]));
              return value;
            };
            const target = await recipePath(projectRoot, destination);
            const descriptor: unknown = JSON.parse(await readFile(target, 'utf8'));
            await writeFile(target, `${JSON.stringify(rewrite(descriptor), null, 2)}\n`);
          }
          this.deps.db.transaction(() => {
            for (const rel of written) {
              const contentHash = hashFileSync(projectRoot, rel);
              recordAssetProvenance(this.deps.db, { projectId, relPath: rel, contentHash, origin: 'generated', recipeRunId: id,
                ...(candidate.mediaTaskId ? { mediaTaskId: candidate.mediaTaskId } : {}), provider: record.run.model.provider, model: record.run.model.id,
                promptText: record.prompt, referenceHashes: record.referenceHashes, params: { recipeId: record.run.recipeId, recipeVersion: record.run.recipeVersion, inputs: record.run.inputs, ...(record.run.styleId !== undefined ? { styleId: record.run.styleId } : {}) } });
            }
          })();
          candidate.adoptedPaths = written;
          await this.save(record);
        } catch (error) {
          if (!candidate.adoptedPaths) for (const rel of written) await rm(await recipePath(projectRoot, rel), { force: true });
          throw error;
        }
      }
      return this.get(projectId, id);
    } finally { this.adopting.delete(id); }
  }
}

function hashFileSync(root: string, relative: string): string { return hash(readFileSync(path.join(root, relative))); }
