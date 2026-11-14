/**
 * The 生成 page's own surface, `/api/generate/*`: runs made with no game, references
 * uploaded to the daemon's generate area, and saving a no-game result into whichever game
 * the user picks, at that game's engine paths. Real recipe routes, executor, SQLite and
 * hosted-media module over a fake cloud; no real cloud, no real image tool, nothing spent.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GenerateReferenceResponse, OpenPixoCloudGenerationJob, OpenPixoGenerationParams, RecipeRun, RecipeRunListResponse, RecipeRunQuote } from '@openpixo/contracts';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getProject, insertProject, openDatabase } from '../../src/db.js';
import { ArtBudgetLedger } from '../../src/game/art-budget.js';
import { OpenPixoHostedMedia, type HostedCloud } from '../../src/media/openpixo-hosted.js';
import { createMediaTaskStore } from '../../src/media/task-store.js';
import { ALL_GAMES, type RecipeExecutor } from '../../src/recipes/executor.js';
import { registerRecipeRoutes } from '../../src/recipes/routes.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

const ownTools = vi.hoisted(() => ({ providers: {} as Record<string, { configured: boolean; available?: boolean }> }));
vi.mock('../../src/media/config.js', () => ({ readMaskedConfig: async () => ({ providers: ownTools.providers }) }));
vi.mock('../../src/styles/service.js', () => ({ resolveArtStyleForGeneration: async () => null }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
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
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(), available: 1000, breakdown: { base: 4, longPrompt: 0, extraReferences: 0 } };
      },
      generationSubmit: async (input: { quoteId: string; idempotencyKey: string; service: string }) => {
        cloud.submits.push(input);
        const existing = byKey.get(input.idempotencyKey);
        if (existing) return { ...existing };
        const job: OpenPixoCloudGenerationJob = { jobId: randomUUID(), service: input.service, state: 'succeeded', creditsReserved: 4, creditsCharged: 4,
          errorCode: null, artifact: { mime: 'image/png', bytes: PNG.length, sha256: sha(PNG) }, download: null,
          createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z' };
        job.download = { url: `${CLOUD_ORIGIN}/${job.jobId}.png`, expiresAt: '2026-11-14T00:05:00.000Z' };
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

/** Lands at the game's own sprite folder, which only the game's engine profile knows. */
const RECIPE = { name: 'test-sprite', title: 'Sprite', version: '0.1.0', pixo: { kind: 'recipe', recipe: {
  surface: 'image', category: 'character', engines: ['any'],
  inputs: [{ name: 'prompt', type: 'text', default: 'a hero' }, { name: 'reference', type: 'image-ref' }],
  prompt: '{{prompt}} sprite', models: { requires: [], recommended: [], fallback: [] },
  generation: { count: { default: 1, max: 4 }, aspect: '1:1' },
  output: { dir: '{{engine.spriteRoot}}', name: 'hero' },
} } };
const GODOT_ONLY = { ...RECIPE, name: 'test-godot', pixo: { kind: 'recipe', recipe: { ...RECIPE.pixo.recipe, engines: ['godot'] } } };
const WITH_EXAMPLES = { ...RECIPE, name: 'test-examples', examples: [
  { title: 'Slime', prompt: 'a slime', inputs: { prompt: 'a slime' }, before: 'examples/slime-before.png', after: 'examples/slime.png' },
  { title: 'Not a picture', prompt: 'x', after: 'pixo.json' },
] };
const ENGINE = (engine: string, assetRoots: string[]) => ({ detectorVersion: 1, engine, confidence: 'high', evidence: [], languages: [], assetRoots,
  importMetadata: 'none', commands: {} });

describe('the 生成 page surface', () => {
  let root = '';
  let db: ReturnType<typeof openDatabase>;
  let cloud: ReturnType<typeof fakeCloud>;
  let hosted: OpenPixoHostedMedia;
  let ledger: ArtBudgetLedger;
  let executor: RecipeExecutor;
  let server: Server;
  let base = '';
  const projectsDir = () => path.join(root, 'projects');
  const dataDir = () => path.join(root, 'data');

  beforeEach(async () => {
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('PIXO_FAL_KEY', '');
    root = await mkdtemp(path.join(tmpdir(), 'pixo-generate-routes-'));
    const bundled = path.join(root, 'plugins');
    for (const manifest of [RECIPE, GODOT_ONLY, WITH_EXAMPLES]) {
      const folder = path.join(bundled, 'recipes', manifest.name);
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'pixo.json'), JSON.stringify(manifest));
    }
    await mkdir(path.join(bundled, 'recipes', 'test-examples', 'examples'), { recursive: true });
    await writeFile(path.join(bundled, 'recipes', 'test-examples', 'examples', 'slime.png'), PNG);
    await writeFile(path.join(bundled, 'recipes', 'test-examples', 'examples', 'unlisted.png'), PNG);
    await mkdir(projectsDir(), { recursive: true });
    db = openDatabase(root, { dataDir: dataDir() });
    cloud = fakeCloud();
    ownTools.providers = {};
    hosted = new OpenPixoHostedMedia({ db, cloud: cloud.api as unknown as HostedCloud, projectsRoot: projectsDir(),
      getProjectMetadata: id => getProject(db, id)?.metadata, sleep: async () => {},
      fetch: async () => new Response(new Uint8Array(PNG), { status: 200 }) });
    ledger = new ArtBudgetLedger(db);
    hosted.attachSettlement(ledger);
    const app = express();
    app.use(express.json());
    executor = registerRecipeRoutes(app, { db, mediaTasks: createMediaTaskStore(db, { isRunActive: () => true }),
      paths: { RUNTIME_DATA_DIR: dataDir(), PROJECT_ROOT: root, PROJECTS_DIR: projectsDir(), SKILLS_DIR: path.join(root, 'skills'), USER_SKILLS_DIR: path.join(root, 'user-skills'), BUNDLED_PLUGINS_DIR: bundled },
      http: { requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(), isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 },
        sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) } as never,
      authorizeProjectRequest: async () => true, authorizeProjectToolRequest: async () => true as never, resources: { listAllSkills: async () => [] },
      artBudget: { ledger, openpixoHosted: hosted, hasSession: async () => true },
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

  function game(engine = ENGINE('phaser', ['public/assets'])) {
    const id = `p_${randomUUID()}`;
    insertProject(db, { id, name: 'Game', metadata: { kind: 'other', engineProfile: engine }, createdAt: 1, updatedAt: 1 } as never);
    mkdirSync(path.join(projectsDir(), id), { recursive: true });
    return id;
  }
  const post = (url: string, body: Record<string, unknown>, bearer?: string) => fetch(`${base}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
  const errorOf = async (response: Response) => (await response.json() as { error: { code: string; message: string } }).error;
  async function quoted(body: Record<string, unknown>): Promise<Extract<RecipeRunQuote, { paid: true }>> {
    const response = await post('/api/generate/quote', { recipeId: 'test-sprite', count: 1, ...body });
    expect(response.status, await response.clone().text()).toBe(200);
    const quote = await response.json() as RecipeRunQuote;
    expect(quote.paid).toBe(true);
    return quote as Extract<RecipeRunQuote, { paid: true }>;
  }
  async function ready(response: Response): Promise<RecipeRun> {
    expect(response.status, await response.clone().text()).toBe(202);
    return executor.wait(ALL_GAMES, (await response.json() as RecipeRun).id);
  }
  const runs = async (query = '') => (await (await fetch(`${base}/api/generate/runs${query}`)).json() as RecipeRunListResponse).runs.map(run => run.id);
  async function upload(bytes: Buffer, name = 'ref.png', type = 'image/png'): Promise<Response> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    return fetch(`${base}/api/generate/references`, { method: 'POST', body: form });
  }

  it('makes art with no game and saves it into the game the user picks, at that game\'s paths', async () => {
    const quote = await quoted({ projectId: null });
    const run = await ready(await post('/api/generate/runs', { recipeId: 'test-sprite', count: 1, projectId: null, quoteId: quote.quoteId }));
    expect(run).toMatchObject({ status: 'ready', projectId: null, origin: 'user' });
    expect(cloud.charged).toBe(4);
    const candidate = run.candidates[0]!;
    const staged = await fetch(`${base}/api/generate/runs/${run.id}/candidates/${candidate.id}/files/0`);
    expect(staged.status).toBe(200);
    expect(Buffer.from(await staged.arrayBuffer()).equals(PNG)).toBe(true);

    const godot = game(ENGINE('godot', ['art']));
    const saved = await post(`/api/generate/runs/${run.id}/adopt`, { projectId: godot, candidateIds: [candidate.id] });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect((await saved.json() as RecipeRun).candidates[0]!.adoptedPaths).toEqual(['art/sprites/hero.png']);
    expect(await readFile(path.join(projectsDir(), godot, 'art', 'sprites', 'hero.png'))).toEqual(PNG);
    const provenance = db.prepare('SELECT project_id FROM asset_provenance WHERE rel_path = ?').all('art/sprites/hero.png') as Array<{ project_id: string }>;
    expect(provenance.map(row => row.project_id)).toEqual([godot]);

    // The same result can go into another game too, at that game's own folder.
    const phaser = game();
    const again = await post(`/api/generate/runs/${run.id}/adopt`, { projectId: phaser, candidateIds: [candidate.id] });
    expect(again.status, await again.clone().text()).toBe(200);
    expect(existsSync(path.join(projectsDir(), phaser, 'public', 'assets', 'sprites', 'hero.png'))).toBe(true);
    // Saved art shows in that game's history too; a game it never went into does not list it.
    expect(await runs(`?projectId=${phaser}`)).toEqual([run.id]);
    expect(await runs(`?projectId=${game()}`)).toEqual([]);
  });

  it('keeps a price to the game it was given for', async () => {
    const id = game();
    const noGame = await quoted({ projectId: null });
    const borrowed = await post('/api/generate/runs', { recipeId: 'test-sprite', count: 1, projectId: id, quoteId: noGame.quoteId });
    expect((await errorOf(borrowed)).code).toBe('RECIPE_QUOTE_UNKNOWN');
    const forGame = await quoted({ projectId: id });
    const elsewhere = await post('/api/generate/runs', { recipeId: 'test-sprite', count: 1, projectId: null, quoteId: forGame.quoteId });
    expect((await errorOf(elsewhere)).code).toBe('RECIPE_QUOTE_UNKNOWN');
    const unpriced = await post('/api/generate/runs', { recipeId: 'test-sprite', count: 1 });
    expect((await errorOf(unpriced)).code).toBe('GENERATION_CONFIRMATION_REQUIRED');
    expect(cloud.submits).toHaveLength(0);
  });

  it('takes uploaded pictures as references for a run with no game, and nothing outside them', async () => {
    const uploaded = await upload(PNG);
    expect(uploaded.status, await uploaded.clone().text()).toBe(200);
    const { ref } = await uploaded.json() as GenerateReferenceResponse;
    expect(ref).toBe(`references/${sha(PNG)}.png`);
    const quote = await quoted({ projectId: null, inputs: { reference: ref } });
    expect(quote.model.id).toBe('openpixo-image-edit');
    expect((await ready(await post('/api/generate/runs', { recipeId: 'test-sprite', count: 1, projectId: null, inputs: { reference: ref }, quoteId: quote.quoteId }))).status).toBe('ready');

    expect((await upload(Buffer.from('not a picture'), 'notes.txt', 'text/plain')).status).toBe(400);
    for (const reference of ['../projects/x.png', 'elsewhere.png']) {
      const refused = await post('/api/generate/quote', { recipeId: 'test-sprite', count: 1, projectId: null, inputs: { reference } });
      expect(refused.status, reference).toBeGreaterThanOrEqual(400);
    }
    expect(cloud.quotes.filter(entry => entry.service === 'openpixo-image-edit')).toHaveLength(1);
  });

  it('offers no game only recipes for any engine, and never code', async () => {
    const refused = await post('/api/generate/quote', { recipeId: 'test-godot', count: 1, projectId: null });
    expect(refused.status).toBe(400);
    const godot = game(ENGINE('godot', ['art']));
    expect((await post('/api/generate/quote', { recipeId: 'test-godot', count: 1, projectId: godot })).status).toBe(200);
  });

  it('keeps an agent to its own game', async () => {
    const id = game();
    ledger.setLimit(id, 100);
    ledger.setMode(id, 'auto');
    const bearer = toolTokenRegistry.mint({ runId: `run_${randomUUID()}`, projectId: id }).token;
    const noGame = await post('/api/generate/runs', { recipeId: 'test-sprite', projectId: null }, bearer);
    expect(noGame.status).toBe(403);
    const other = await post('/api/generate/runs', { recipeId: 'test-sprite', projectId: game() }, bearer);
    expect(other.status).toBe(403);
    const own = await ready(await post('/api/generate/runs', { recipeId: 'test-sprite', projectId: id }, bearer));
    expect(own).toMatchObject({ projectId: id, origin: 'agent', status: 'ready' });
    expect((await fetch(`${base}/api/generate/runs`, { headers: { Authorization: `Bearer ${bearer}` } })).status).toBe(403);
  });

  it('lists every run on this machine, one game or none, and keeps a game\'s run in its game', async () => {
    const id = game();
    const gameQuote = await (await post(`/api/projects/${id}/recipe-runs/quote`, { recipeId: 'test-sprite', count: 1 })).json() as Extract<RecipeRunQuote, { paid: true }>;
    // The older per-game routes are the same runs.
    const gameRun = await ready(await post(`/api/projects/${id}/recipe-runs`, { recipeId: 'test-sprite', count: 1, quoteId: gameQuote.quoteId }));
    const noGameQuote = await quoted({ projectId: null });
    const noGameRun = await ready(await post('/api/generate/runs', { recipeId: 'test-sprite', count: 1, projectId: null, quoteId: noGameQuote.quoteId }));
    expect(await runs()).toEqual([noGameRun.id, gameRun.id]);
    expect(await runs(`?projectId=${id}`)).toEqual([gameRun.id]);
    expect(await runs('?noGame=1')).toEqual([noGameRun.id]);
    expect((await (await fetch(`${base}/api/projects/${id}/recipe-runs`)).json() as RecipeRunListResponse).runs.map(run => run.id)).toEqual([gameRun.id]);

    const moved = await post(`/api/generate/runs/${gameRun.id}/adopt`, { projectId: game(), candidateIds: [gameRun.candidates[0]!.id] });
    expect(moved.status).toBe(409);
    expect((await post(`/api/generate/runs/${gameRun.id}/adopt`, { projectId: id, candidateIds: [gameRun.candidates[0]!.id] })).status).toBe(200);
    expect(existsSync(path.join(projectsDir(), id, 'public', 'assets', 'sprites', 'hero.png'))).toBe(true);
  });

  it('serves the example pictures a recipe lists, and nothing else', async () => {
    const summary = (await (await fetch(`${base}/api/recipes`)).json() as Array<{ id: string; examples?: unknown[] }>).find(entry => entry.id === 'test-examples');
    expect(summary?.examples).toHaveLength(2);
    const picture = await fetch(`${base}/api/recipes/test-examples/examples/0/after`);
    expect(picture.status).toBe(200);
    expect(Buffer.from(await picture.arrayBuffer()).equals(PNG)).toBe(true);
    // Listed but missing, outside the folder, not a picture kind, or not listed at all.
    for (const url of ['0/before', '1/after', '0/cover', '2/after', '0/other']) {
      expect((await fetch(`${base}/api/recipes/test-examples/examples/${url}`)).status, url).toBe(404);
    }
  });
});
