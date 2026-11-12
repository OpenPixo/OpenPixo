/**
 * An agent's image recipe paid from the art budget: real recipe routes, executor,
 * ledger, SQLite and hosted-media module, over a fake cloud that keeps the cloud's
 * money rules. No real cloud, no real image tool, nothing spent.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { OpenPixoCloudGenerationJob, OpenPixoGenerationParams, RecipeRun } from '@openpixo/contracts';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getProject, insertProject, openDatabase } from '../../src/db.js';
import { ArtBudgetLedger } from '../../src/game/art-budget.js';
import { IMAGE_MODELS } from '../../src/media/models.js';
import { OpenPixoHostedMedia, type HostedCloud } from '../../src/media/openpixo-hosted.js';
import { createMediaTaskStore } from '../../src/media/task-store.js';
import type { RecipeExecutor } from '../../src/recipes/executor.js';
import { hostedRecipeModelIds, selectRecipeModel } from '../../src/recipes/models.js';
import { registerRecipeRoutes } from '../../src/recipes/routes.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

// The machine's real tools (a signed-in Codex among them) must stay out of reach.
const ownTools = vi.hoisted(() => ({ providers: {} as Record<string, { configured: boolean; available?: boolean }> }));
vi.mock('../../src/media/config.js', () => ({ readMaskedConfig: async () => ({ providers: ownTools.providers }) }));
vi.mock('../../src/styles/service.js', () => ({ resolveArtStyleForGeneration: async () => null }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
const PNG_SHA = createHash('sha256').update(PNG).digest('hex');
const CLOUD_ORIGIN = 'https://cloud.test';

function fakeCloud() {
  const jobs = new Map<string, OpenPixoCloudGenerationJob>();
  const byKey = new Map<string, OpenPixoCloudGenerationJob>();
  const image = (id: string, min: number) => ({ id, surface: 'image' as const, label: id, credits: 4, priceVersion: 1, maxPromptChars: 12000,
    aspects: ['1:1', '3:2'] as const, styles: [], references: { min, max: 4 },
    pricing: { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1 } });
  const cloud = {
    charged: 0,
    quotes: [] as Array<{ service: string; params: OpenPixoGenerationParams }>,
    submits: [] as Array<{ idempotencyKey: string; service: string }>,
    api: {
      cloudOrigin: () => CLOUD_ORIGIN,
      generationServices: async () => ({ generationPaused: false, services: [image('openpixo-image', 0), image('openpixo-image-edit', 1)] }),
      generationReference: async (sha256: string) => ({ sha256, uploadUrl: null }),
      generationQuote: async (service: string, params: OpenPixoGenerationParams) => {
        cloud.quotes.push({ service, params });
        return { quoteId: randomUUID(), service, credits: 4, priceVersion: 1, paramsDigest: 'a'.repeat(64),
          expiresAt: '2026-11-11T01:00:00.000Z', available: 1000, breakdown: { base: 4, longPrompt: 0, extraReferences: 0 } };
      },
      generationSubmit: async (input: { quoteId: string; idempotencyKey: string; service: string }) => {
        cloud.submits.push(input);
        const existing = byKey.get(input.idempotencyKey);
        if (existing) return { ...existing };
        const job: OpenPixoCloudGenerationJob = { jobId: randomUUID(), service: input.service, state: 'succeeded', creditsReserved: 4, creditsCharged: 4,
          errorCode: null, artifact: { mime: 'image/png', bytes: PNG.length, sha256: PNG_SHA }, download: null,
          createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z' };
        job.download = { url: `${CLOUD_ORIGIN}/${job.jobId}.png`, expiresAt: '2026-11-11T00:05:00.000Z' };
        cloud.charged += 4;
        byKey.set(input.idempotencyKey, job);
        jobs.set(job.jobId, job);
        return { ...job };
      },
      generationJob: async (jobId: string) => ({ ...jobs.get(jobId)! }),
    },
  };
  return cloud;
}

const RECIPE = { name: 'test-hosted', title: 'Hosted sprite', version: '0.1.0', pixo: { kind: 'recipe', recipe: {
  surface: 'image', category: 'character', engines: ['any'],
  inputs: [{ name: 'prompt', type: 'text', default: 'a hero' }, { name: 'reference', type: 'image-ref' }],
  prompt: '{{prompt}} sprite', models: { requires: [], recommended: [], fallback: [] },
  generation: { count: { default: 3, max: 4 }, aspect: '1:1' },
  output: { dir: 'sprites', name: 'hero' },
} } };

describe('an agent\'s image recipe and the art budget', () => {
  let root = '';
  let db: ReturnType<typeof openDatabase>;
  let cloud: ReturnType<typeof fakeCloud>;
  let ledger: ArtBudgetLedger;
  let hosted: OpenPixoHostedMedia;
  let executor: RecipeExecutor;
  let server: Server;
  let base = '';
  let signedIn = true;
  const projectsDir = () => path.join(root, 'projects');

  beforeEach(async () => {
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('PIXO_FAL_KEY', '');
    root = await mkdtemp(path.join(tmpdir(), 'pixo-art-budget-recipes-'));
    const bundled = path.join(root, 'plugins');
    await mkdir(path.join(bundled, 'recipes', 'test-hosted'), { recursive: true });
    await writeFile(path.join(bundled, 'recipes', 'test-hosted', 'pixo.json'), JSON.stringify(RECIPE));
    await mkdir(projectsDir(), { recursive: true });
    db = openDatabase(root, { dataDir: path.join(root, 'data') });
    cloud = fakeCloud();
    signedIn = true;
    ownTools.providers = {};
    hosted = new OpenPixoHostedMedia({ db, cloud: cloud.api as unknown as HostedCloud, projectsRoot: projectsDir(),
      getProjectMetadata: id => getProject(db, id)?.metadata, sleep: async () => {}, fetch: async () => new Response(new Uint8Array(PNG), { status: 200 }) });
    ledger = new ArtBudgetLedger(db);
    hosted.attachSettlement(ledger);
    const app = express();
    app.use(express.json());
    executor = registerRecipeRoutes(app, { db, mediaTasks: createMediaTaskStore(db, { isRunActive: () => true }),
      paths: { RUNTIME_DATA_DIR: path.join(root, 'data'), PROJECT_ROOT: root, PROJECTS_DIR: projectsDir(), SKILLS_DIR: path.join(root, 'skills'), USER_SKILLS_DIR: path.join(root, 'user-skills'), BUNDLED_PLUGINS_DIR: bundled },
      http: { requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(), isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 },
        sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) } as never,
      authorizeProjectRequest: async () => true, authorizeProjectToolRequest: async () => true as never, resources: { listAllSkills: async () => [] },
      artBudget: { ledger, openpixoHosted: hosted, hasSession: async () => signedIn },
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterEach(async () => {
    hosted.close();
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    await executor.initialized;
    closeDatabase();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function project() {
    const id = `p_${randomUUID()}`;
    insertProject(db, { id, name: 'Game', metadata: { kind: 'other' }, createdAt: 1, updatedAt: 1 } as never);
    mkdirSync(path.join(projectsDir(), id), { recursive: true });
    return id;
  }
  const token = (projectId: string, runId = `run_${randomUUID()}`) => toolTokenRegistry.mint({ runId, projectId }).token;
  const runRecipe = (projectId: string, body: Record<string, unknown> = {}, bearer?: string) => fetch(`${base}/api/projects/${projectId}/recipe-runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ recipeId: 'test-hosted', ...body }),
  });
  const errorOf = async (response: Response) => (await response.json() as { error: { code: string; message: string } }).error;
  async function ready(projectId: string, response: Response): Promise<RecipeRun> {
    expect(response.status, await response.clone().text()).toBe(202);
    const run = await response.json() as RecipeRun;
    return executor.wait(projectId, run.id);
  }
  const auto = (projectId: string, credits: number) => { ledger.setLimit(projectId, credits); ledger.setMode(projectId, 'auto'); };

  it('tries every own tool, Codex included, before a hosted model', () => {
    const recipe = RECIPE.pixo.recipe as never;
    const hostedIds = hostedRecipeModelIds(recipe, false);
    expect(selectRecipeModel(recipe, IMAGE_MODELS, new Set(['codex-cli']), undefined, hostedIds).id).toBe('codex-image');
    expect(selectRecipeModel(recipe, IMAGE_MODELS, new Set(['openai']), undefined, hostedIds).provider).toBe('openai');
    // Even a recipe that recommends a hosted model reaches it only after the own tools.
    const recommending = { ...RECIPE.pixo.recipe, models: { requires: [], recommended: ['openpixo-image'], fallback: [] } } as never;
    expect(selectRecipeModel(recommending, IMAGE_MODELS, new Set(['codex-cli']), undefined, hostedIds).id).toBe('codex-image');
    expect(selectRecipeModel(recipe, IMAGE_MODELS, new Set(), undefined, hostedIds).id).toBe('openpixo-image');
    expect(selectRecipeModel(recipe, IMAGE_MODELS, new Set(), undefined, hostedRecipeModelIds(recipe, true)).id).toBe('openpixo-image-edit');
    expect(() => selectRecipeModel(recipe, IMAGE_MODELS, new Set())).toThrow('No usable model');
    expect(hostedRecipeModelIds({ ...RECIPE.pixo.recipe, surface: 'audio' } as never, false)).toEqual([]);
  });

  it('pays one candidate by default, stages the file, and records the charge', async () => {
    const id = project();
    auto(id, 100);
    const run = await ready(id, await runRecipe(id, {}, token(id)));
    expect(run.status, JSON.stringify(run)).toBe('ready');
    expect(run.model).toEqual({ provider: 'openpixo', id: 'openpixo-image' });
    expect(run.candidates).toHaveLength(1);
    const staged = run.candidates[0]!.stagedFiles[0]!;
    expect(staged.ref.startsWith(path.join(root, 'data'))).toBe(true);
    await expect(readFile(staged.ref)).resolves.toEqual(PNG);
    // Nothing lands in the game until the agent adopts a candidate.
    await expect(readFile(path.join(projectsDir(), id, 'primary.png'))).rejects.toThrow();
    expect(cloud.charged).toBe(4);
    expect(ledger.read(id)).toMatchObject({ usedCredits: 4, spentCredits: 4, reservedCredits: 0 });
    expect(db.prepare('SELECT project_id FROM openpixo_cloud_jobs').all()).toEqual([{ project_id: id }]);
  });

  it('reserves every candidate it was asked for, each under its own request id', async () => {
    const id = project();
    auto(id, 100);
    const run = await ready(id, await runRecipe(id, { count: 3 }, token(id)));
    expect(run.candidates.filter(candidate => candidate.stagedFiles.length)).toHaveLength(3);
    expect(cloud.quotes).toHaveLength(3);
    expect(new Set(cloud.submits.map(submit => submit.idempotencyKey)).size).toBe(3);
    expect(ledger.read(id)?.usedCredits).toBe(12);
  });

  it('uses the edit service for a recipe with a reference, and prices the reference', async () => {
    const id = project();
    auto(id, 100);
    await mkdir(path.join(projectsDir(), id), { recursive: true });
    await writeFile(path.join(projectsDir(), id, 'ref.png'), PNG);
    const run = await ready(id, await runRecipe(id, { inputs: { reference: 'ref.png' } }, token(id)));
    expect(run.model.id).toBe('openpixo-image-edit');
    expect(cloud.quotes[0]!.params).toMatchObject({ references: [PNG_SHA] });
  });

  it('answers an unapproved recipe in ask mode with the refusal, and starts nothing', async () => {
    const id = project();
    ledger.setLimit(id, 100);
    const response = await runRecipe(id, {}, token(id));
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('ART_APPROVAL_REQUIRED');
    expect(cloud.quotes).toHaveLength(0);
    expect(cloud.submits).toHaveLength(0);
  });

  it('gives back the candidates it reserved when a later one is refused', async () => {
    const id = project();
    ledger.setLimit(id, 100);
    ledger.approve(id, 8);
    const refused = await runRecipe(id, { count: 3 }, token(id, 'run-a'));
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe('ART_APPROVAL_REQUIRED');
    expect(cloud.submits).toHaveLength(0);
    expect(ledger.read(id)?.usedCredits).toBe(0);
    expect(ledger.readApproval(id)).toMatchObject({ usedCredits: 0, remainingCredits: 8 });
    const paid = await ready(id, await runRecipe(id, { count: 2 }, token(id, 'run-a')));
    expect(paid.status).toBe('ready');
    expect(ledger.read(id)?.usedCredits).toBe(8);
  });

  it('answers a budget that cannot pay every candidate with its own code', async () => {
    const id = project();
    auto(id, 4);
    const response = await runRecipe(id, { count: 2 }, token(id));
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('ART_BUDGET_EXHAUSTED');
    expect(ledger.read(id)?.usedCredits).toBe(0);
  });

  it('offers no hosted model to the user, signed out, or without a budget that can pay', async () => {
    const id = project();
    expect((await errorOf(await runRecipe(id, {}, token(id)))).code).toBe('RECIPE_NO_MODEL');
    auto(id, 0);
    expect((await errorOf(await runRecipe(id, {}, token(id)))).code).toBe('RECIPE_NO_MODEL');
    auto(id, 100);
    expect((await errorOf(await runRecipe(id))).code).toBe('RECIPE_NO_MODEL');
    signedIn = false;
    expect((await errorOf(await runRecipe(id, {}, token(id)))).code).toBe('RECIPE_NO_MODEL');
    expect(cloud.quotes).toHaveLength(0);
  });
});
