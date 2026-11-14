/**
 * Recipes that spend credits: an agent's, paid from the art budget, and the user's,
 * at a price they confirmed. Real recipe routes, executor, ledger, SQLite and
 * hosted-media module, over a fake cloud that keeps the cloud's money rules. No real
 * cloud, no real image tool, nothing spent.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { OpenPixoCloudGenerationJob, OpenPixoGenerationParams, RecipeRun, RecipeRunListResponse, RecipeRunQuote } from '@openpixo/contracts';
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
// Files the hosted module accepts as what the cloud said they are: it checks each file's own signature.
const MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(120, 3)]);
const GLB = Buffer.concat([Buffer.from('glTF', 'latin1'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(120, 5)]);
const ARTIFACTS = { png: PNG, mp3: MP3, glb: GLB } as const;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const CLOUD_ORIGIN = 'https://cloud.test';

function fakeCloud() {
  const jobs = new Map<string, OpenPixoCloudGenerationJob>();
  const byKey = new Map<string, OpenPixoCloudGenerationJob>();
  // Only text-to-image sells larger sizes here, so the edit service shows the fallback.
  const image = (id: string, min: number) => ({ id, surface: 'image' as const, label: id, credits: 4, priceVersion: 1, maxPromptChars: 12000,
    aspects: ['1:1', '3:2'] as const, styles: [], references: { min, max: 4 }, ...(min ? {} : { resolutions: ['1k', '2k', '4k'] as const }),
    pricing: { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1 } });
  const cloud = {
    charged: 0,
    quotes: [] as Array<{ service: string; params: OpenPixoGenerationParams }>,
    submits: [] as Array<{ idempotencyKey: string; service: string; params?: OpenPixoGenerationParams }>,
    api: {
      cloudOrigin: () => CLOUD_ORIGIN,
      generationServices: async () => ({ generationPaused: false, services: [image('openpixo-image', 0), image('openpixo-image-edit', 1),
        { id: 'openpixo-sfx', surface: 'audio' as const, audioKind: 'sfx' as const, label: 'Sound effect', credits: 7, priceVersion: 1, maxPromptChars: 450,
          aspects: [], styles: [], references: { min: 0, max: 0 }, durationSeconds: { min: 0.5, max: 10, default: 2 },
          pricing: { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 0 } },
        { id: 'openpixo-model3d', surface: 'model3d' as const, quality: 'medium' as const, label: '3D model', credits: 60, priceVersion: 1, maxPromptChars: 12000,
          aspects: ['1:1'] as const, styles: [], references: { min: 1, max: 1 }, promptOptional: true,
          pricing: { longPromptTokens: 2000, longPromptCredits: 0, maxPromptTokens: 3000, extraReferenceCredits: 0 } }] }),
      generationReference: async (sha256: string) => ({ sha256, uploadUrl: null }),
      generationQuote: async (service: string, params: OpenPixoGenerationParams) => {
        cloud.quotes.push({ service, params });
        return { quoteId: randomUUID(), service, credits: 4, priceVersion: 1, paramsDigest: 'a'.repeat(64),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(), available: 1000, breakdown: { base: 4, longPrompt: 0, extraReferences: 0 } };
      },
      generationSubmit: async (input: { quoteId: string; idempotencyKey: string; service: string; params?: OpenPixoGenerationParams }) => {
        cloud.submits.push(input);
        const existing = byKey.get(input.idempotencyKey);
        if (existing) return { ...existing };
        const kind = input.service === 'openpixo-sfx' ? 'mp3' : input.service === 'openpixo-model3d' ? 'glb' : 'png';
        const mime = ({ png: 'image/png', mp3: 'audio/mpeg', glb: 'model/gltf-binary' } as const)[kind];
        const job: OpenPixoCloudGenerationJob = { jobId: randomUUID(), service: input.service, state: 'succeeded', creditsReserved: 4, creditsCharged: 4,
          errorCode: null, artifact: { mime, bytes: ARTIFACTS[kind].length, sha256: sha(ARTIFACTS[kind]) }, download: null,
          createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z' };
        job.download = { url: `${CLOUD_ORIGIN}/${job.jobId}.${kind}`, expiresAt: '2026-11-11T00:05:00.000Z' };
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
  inputs: [{ name: 'prompt', type: 'text', default: 'a hero' }, { name: 'reference', type: 'image-ref' },
    { name: 'resolution', type: 'select', options: ['1k', '2k', '4k'], default: '1k' }],
  prompt: '{{prompt}} sprite', models: { requires: [], recommended: [], fallback: [] },
  generation: { count: { default: 3, max: 4 }, aspect: '1:1' },
  output: { dir: 'sprites', name: 'hero' },
} } };
const SOUND_RECIPE = { name: 'test-sound', title: 'Hosted sound', version: '0.1.0', pixo: { kind: 'recipe', recipe: {
  surface: 'audio', category: 'plain', engines: ['any'],
  inputs: [{ name: 'prompt', type: 'text', default: 'a jump' }, { name: 'duration', type: 'number', default: 1 }],
  prompt: '{{prompt}}', models: { requires: ['sfx'], recommended: [], fallback: [] },
  generation: { count: { default: 3, max: 4 } },
  output: { dir: 'audio', name: 'jump' },
} } };
const MODEL_RECIPE = { name: 'test-model', title: 'Hosted model', version: '0.1.0', pixo: { kind: 'recipe', recipe: {
  surface: 'model3d', category: 'model', engines: ['any'],
  inputs: [{ name: 'image', type: 'image-ref', required: true }],
  prompt: 'A 3D model of the object in the picture', models: { requires: ['image-to-3d'], recommended: [], fallback: [] },
  generation: { count: { default: 1, max: 2 } },
  output: { dir: 'models', name: 'crate' },
} } };

describe('recipes that spend credits', () => {
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
    for (const [folder, manifest] of [['test-sound', SOUND_RECIPE], ['test-model', MODEL_RECIPE]] as const) {
      await mkdir(path.join(bundled, 'recipes', folder), { recursive: true });
      await writeFile(path.join(bundled, 'recipes', folder, 'pixo.json'), JSON.stringify(manifest));
    }
    await mkdir(projectsDir(), { recursive: true });
    db = openDatabase(root, { dataDir: path.join(root, 'data') });
    cloud = fakeCloud();
    signedIn = true;
    ownTools.providers = {};
    hosted = new OpenPixoHostedMedia({ db, cloud: cloud.api as unknown as HostedCloud, projectsRoot: projectsDir(),
      getProjectMetadata: id => getProject(db, id)?.metadata, sleep: async () => {},
      fetch: async (url: string | URL | Request) => new Response(new Uint8Array(ARTIFACTS[String(url).split('.').pop() as keyof typeof ARTIFACTS] ?? PNG), { status: 200 }) });
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
  const quoteRecipe = (projectId: string, body: Record<string, unknown> = {}, bearer?: string) => fetch(`${base}/api/projects/${projectId}/recipe-runs/quote`, {
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
    // Audio and 3D fall back to their hosted services too; 3D only from a picture.
    expect(hostedRecipeModelIds({ ...RECIPE.pixo.recipe, surface: 'audio' } as never, false)).toContain('openpixo-sfx');
    expect(hostedRecipeModelIds({ ...RECIPE.pixo.recipe, surface: 'model3d' } as never, false)).toEqual([]);
    expect(hostedRecipeModelIds({ ...RECIPE.pixo.recipe, surface: 'model3d' } as never, true)[0]).toBe('openpixo-model3d');
    expect(hostedRecipeModelIds({ ...RECIPE.pixo.recipe, surface: 'video' } as never, true)).toEqual([]);
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

  it('offers an agent no hosted model signed out or without a budget that can pay', async () => {
    const id = project();
    expect((await errorOf(await runRecipe(id, {}, token(id)))).code).toBe('RECIPE_NO_MODEL');
    auto(id, 0);
    expect((await errorOf(await runRecipe(id, {}, token(id)))).code).toBe('RECIPE_NO_MODEL');
    auto(id, 100);
    signedIn = false;
    expect((await errorOf(await runRecipe(id, {}, token(id)))).code).toBe('RECIPE_NO_MODEL');
    expect(cloud.quotes).toHaveLength(0);
  });

  it('pays an agent\'s sound effect recipe from the budget, with the voice and length it was priced on', async () => {
    const id = project();
    auto(id, 100);
    const run = await ready(id, await runRecipe(id, { recipeId: 'test-sound', inputs: { duration: 3 } }, token(id)));
    expect(run.status, JSON.stringify(run)).toBe('ready');
    expect(run).toMatchObject({ model: { provider: 'openpixo', id: 'openpixo-sfx' }, surface: 'audio', origin: 'agent' });
    expect(run.candidates).toHaveLength(1);
    // Hosted audio arrives as mp3 and is staged as such.
    expect(run.candidates[0]!.stagedFiles[0]!.ref).toMatch(/primary\.mp3$/);
    expect(cloud.quotes[0]).toMatchObject({ service: 'openpixo-sfx', params: { prompt: 'a jump', duration: 3 } });
    expect(ledger.read(id)?.usedCredits).toBe(4);
  });

  it('pays an agent\'s 3D recipe from the budget, priced from its picture', async () => {
    const id = project();
    auto(id, 100);
    await writeFile(path.join(projectsDir(), id, 'crate.png'), PNG);
    const run = await ready(id, await runRecipe(id, { recipeId: 'test-model', inputs: { image: 'crate.png' } }, token(id)));
    expect(run.status, JSON.stringify(run)).toBe('ready');
    expect(run).toMatchObject({ model: { id: 'openpixo-model3d' }, surface: 'model3d' });
    expect(run.candidates[0]!.stagedFiles[0]!.ref).toMatch(/primary\.glb$/);
    expect(cloud.quotes[0]!.params).toMatchObject({ references: [PNG_SHA] });
  });

  describe('a run the user pays for', () => {
    async function quoted(id: string, body: Record<string, unknown> = {}): Promise<Extract<RecipeRunQuote, { paid: true }>> {
      const response = await quoteRecipe(id, body);
      expect(response.status, await response.clone().text()).toBe(200);
      const quote = await response.json() as RecipeRunQuote;
      expect(quote.paid).toBe(true);
      return quote as Extract<RecipeRunQuote, { paid: true }>;
    }

    it('prices every candidate, then spends exactly that once, outside the art budget', async () => {
      const id = project();
      auto(id, 100);
      const quote = await quoted(id, { count: 2 });
      expect(quote).toMatchObject({ count: 2, credits: 8, candidates: [{ credits: 4 }, { credits: 4 }], model: { id: 'openpixo-image' } });
      expect(cloud.submits).toHaveLength(0);
      const run = await ready(id, await runRecipe(id, { count: 2, quoteId: quote.quoteId }));
      expect(run).toMatchObject({ status: 'ready', origin: 'user', surface: 'image' });
      expect(run.candidates.filter(candidate => candidate.stagedFiles.length)).toHaveLength(2);
      expect(cloud.charged).toBe(8);
      // The user's own price is not the agent's budget.
      expect(ledger.read(id)?.usedCredits).toBe(0);
      // Asking again with the same price answers with the same run and pays nothing more.
      const again = await runRecipe(id, { count: 2, quoteId: quote.quoteId });
      expect(again.status).toBe(202);
      expect((await again.json() as RecipeRun).id).toBe(run.id);
      expect(cloud.charged).toBe(8);
      expect(cloud.quotes).toHaveLength(2);
    });

    it('prices and sends the resolution the user picked, where the service sells it', async () => {
      const id = project();
      const quote = await quoted(id, { inputs: { resolution: '2k' } });
      expect(cloud.quotes.at(-1)!.params).toMatchObject({ resolution: '2k' });
      await ready(id, await runRecipe(id, { inputs: { resolution: '2k' }, quoteId: quote.quoteId }));
      expect(cloud.submits.at(-1)!.params).toMatchObject({ resolution: '2k' });
      // 1K is the base size: it is never sent, so the request reads as it always has.
      await quoted(id, { inputs: { resolution: '1k' } });
      expect(cloud.quotes.at(-1)!.params).not.toHaveProperty('resolution');
      // A service that does not sell 2K renders the base size and says so.
      await writeFile(path.join(projectsDir(), id, 'ref.png'), PNG);
      const edit = await quoted(id, { inputs: { resolution: '2k', reference: 'ref.png' } });
      expect(cloud.quotes.at(-1)).toMatchObject({ service: 'openpixo-image-edit' });
      expect(cloud.quotes.at(-1)!.params).not.toHaveProperty('resolution');
      expect(edit.warnings).toContain('resolution 2k is not offered by this service; rendered at 1k');
    });

    it('needs a price before it spends, and refuses one for a different run', async () => {
      const id = project();
      const unpriced = await runRecipe(id);
      expect(unpriced.status).toBe(403);
      expect((await errorOf(unpriced)).code).toBe('GENERATION_CONFIRMATION_REQUIRED');
      const quote = await quoted(id, { count: 1 });
      const other = await runRecipe(id, { count: 1, inputs: { prompt: 'a villain' }, quoteId: quote.quoteId });
      expect(other.status).toBe(409);
      expect((await errorOf(other)).code).toBe('RECIPE_QUOTE_MISMATCH');
      const unknown = await runRecipe(id, { count: 1, quoteId: randomUUID() });
      expect((await errorOf(unknown)).code).toBe('RECIPE_QUOTE_UNKNOWN');
      expect(cloud.submits).toHaveLength(0);
    });

    it('is never priced for, or paid by, an agent\'s token', async () => {
      const id = project();
      auto(id, 100);
      const asked = await quoteRecipe(id, {}, token(id));
      expect(asked.status).toBe(403);
      const quote = await quoted(id, { count: 1 });
      const borrowed = await runRecipe(id, { count: 1, quoteId: quote.quoteId }, token(id));
      expect(borrowed.status).toBe(403);
      expect(cloud.submits).toHaveLength(0);
    });

    it('answers a recipe its own tools make with no price', async () => {
      const id = project();
      ownTools.providers = { openai: { configured: true } };
      const response = await quoteRecipe(id, { count: 1 });
      expect(await response.json()).toMatchObject({ paid: false, model: { provider: 'openai' } });
      expect(cloud.quotes).toHaveLength(0);
    });

    it('prices a sound effect and a 3D model the same way', async () => {
      const id = project();
      await writeFile(path.join(projectsDir(), id, 'crate.png'), PNG);
      const sound = await quoted(id, { recipeId: 'test-sound', count: 1 });
      const model = await quoted(id, { recipeId: 'test-model', inputs: { image: 'crate.png' } });
      expect(sound.model.id).toBe('openpixo-sfx');
      expect(model.model.id).toBe('openpixo-model3d');
      expect((await ready(id, await runRecipe(id, { recipeId: 'test-sound', count: 1, quoteId: sound.quoteId }))).status).toBe('ready');
      expect((await ready(id, await runRecipe(id, { recipeId: 'test-model', inputs: { image: 'crate.png' }, quoteId: model.quoteId }))).status).toBe('ready');
    });
  });

  it('runs on a new project whose folder does not exist yet', async () => {
    // A managed project gets its folder on its first write; a recipe used to fail on one.
    const id = `p_${randomUUID()}`;
    insertProject(db, { id, name: 'Fresh', metadata: { kind: 'other' }, createdAt: 1, updatedAt: 1 } as never);
    ownTools.providers = { openai: { configured: true } };
    const quote = await quoteRecipe(id, { count: 1 });
    expect(quote.status, await quote.clone().text()).toBe(200);
    expect(await quote.json()).toMatchObject({ paid: false });
  });

  it('lists this project\'s runs newest first, by who started them', async () => {
    const id = project();
    auto(id, 100);
    const agentRun = await ready(id, await runRecipe(id, {}, token(id)));
    const quote = await (await quoteRecipe(id, { count: 1 })).json() as Extract<RecipeRunQuote, { paid: true }>;
    const userRun = await ready(id, await runRecipe(id, { count: 1, quoteId: quote.quoteId }));
    const list = async (query = '') => (await (await fetch(`${base}/api/projects/${id}/recipe-runs${query}`)).json() as RecipeRunListResponse).runs.map(run => run.id);
    expect(await list()).toEqual([userRun.id, agentRun.id]);
    expect(await list('?origin=agent')).toEqual([agentRun.id]);
    expect(await list('?surface=audio')).toEqual([]);
    expect(await list('?limit=1')).toEqual([userRun.id]);
  });
});
