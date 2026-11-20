/**
 * Inside a game, the game's look decides a recipe's style: a preset never adds a look
 * of its own. Real bundled recipes, real recipe routes and executor, SQLite and the
 * hosted-media module over a fake cloud that records what it is asked to price; no real
 * cloud, no real image tool, nothing spent.
 *
 * Reported 2026-11-18: in a hand-painted game, an item icon set came out as pixel art,
 * because the recipe's `style` input defaulted to "pixel art" and, once the user had set
 * the look, nothing else in the request named the game's style.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ArtStyle, OpenPixoGenerationParams, RecipeDetail } from '@openpixo/contracts';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getProject, insertProject, openDatabase } from '../../src/db.js';
import { ArtBudgetLedger } from '../../src/game/art-budget.js';
import { OpenPixoHostedMedia, type HostedCloud } from '../../src/media/openpixo-hosted.js';
import type { MediaModel } from '../../src/media/models.js';
import { createMediaTaskStore } from '../../src/media/task-store.js';
import { discoverRecipes, findRecipe } from '../../src/recipes/catalog.js';
import { RecipeExecutor } from '../../src/recipes/executor.js';
import { registerRecipeRoutes } from '../../src/recipes/routes.js';

vi.mock('../../src/media/config.js', () => ({ readMaskedConfig: async () => ({ providers: {} }) }));

const BUNDLED = path.resolve(import.meta.dirname, '../../../../plugins/_official');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
const ENGINE = { detectorVersion: 1, engine: 'phaser', confidence: 'high', evidence: [], languages: [], assetRoots: ['public/assets'], importMetadata: 'none', commands: {} };
const DIRECTION = 'hand-painted watercolour, soft brown outlines, warm light from the top left';
const IMAGE_RECIPES_WITH_STYLE = ['item-icon-set', 'parallax-layers', 'tileset-seamless', 'ui-nine-slice', 'vfx-sequence', 'character-turnaround',
  'sprite-walk-sheet-8dir', 'sprite-idle-sheet-8dir', 'sprite-walk-sheet-side', 'sprite-idle-sheet-side', 'sprite-attack-sheet-side', 'pbr-texture', 'skybox'];

function fakeCloud() {
  const service = (id: string, min: number) => ({ id, surface: 'image' as const, label: id, credits: 4, priceVersion: 1, maxPromptChars: 12000,
    aspects: ['1:1', '3:2', '16:9', '2:1'] as const, styles: [], references: { min, max: 4 },
    pricing: { longPromptTokens: 4000, longPromptCredits: 1, maxPromptTokens: 6000, extraReferenceCredits: 1 } });
  const quotes: OpenPixoGenerationParams[] = [];
  const api = {
    cloudOrigin: () => 'https://cloud.test',
    generationServices: async () => ({ generationPaused: false, services: [service('openpixo-image', 0), service('openpixo-image-edit', 1)] }),
    generationReference: async (sha256: string) => ({ sha256, uploadUrl: null }),
    generationQuote: async (id: string, params: OpenPixoGenerationParams) => {
      quotes.push(params);
      return { quoteId: randomUUID(), service: id, credits: 4, priceVersion: 1, paramsDigest: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(), available: 1000, breakdown: { base: 4, longPrompt: 0, extraReferences: 0 } };
    },
    generationSubmit: async () => { throw new Error('nothing is submitted in this test'); },
    generationJob: async () => { throw new Error('nothing is submitted in this test'); },
  };
  return { api, quotes };
}

describe('a recipe inside a game uses the game\'s look', () => {
  let root = '';
  let db: ReturnType<typeof openDatabase>;
  let cloud: ReturnType<typeof fakeCloud>;
  let hosted: OpenPixoHostedMedia;
  let executor: RecipeExecutor;
  let server: Server;
  let base = '';
  const projectsDir = () => path.join(root, 'projects');

  beforeEach(async () => {
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('PIXO_FAL_KEY', '');
    root = await mkdtemp(path.join(tmpdir(), 'pixo-recipe-look-'));
    await mkdir(projectsDir(), { recursive: true });
    db = openDatabase(root, { dataDir: path.join(root, 'data') });
    cloud = fakeCloud();
    hosted = new OpenPixoHostedMedia({ db, cloud: cloud.api as unknown as HostedCloud, projectsRoot: projectsDir(),
      getProjectMetadata: id => getProject(db, id)?.metadata, sleep: async () => {},
      fetch: async () => new Response(new Uint8Array(PNG), { status: 200 }) });
    const ledger = new ArtBudgetLedger(db);
    hosted.attachSettlement(ledger);
    const app = express();
    app.use(express.json());
    executor = registerRecipeRoutes(app, { db, mediaTasks: createMediaTaskStore(db, { isRunActive: () => true }),
      paths: { RUNTIME_DATA_DIR: path.join(root, 'data'), PROJECT_ROOT: root, PROJECTS_DIR: projectsDir(), SKILLS_DIR: path.join(root, 'skills'),
        USER_SKILLS_DIR: path.join(root, 'user-skills'), BUNDLED_PLUGINS_DIR: BUNDLED },
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

  function game(metadata: Record<string, unknown>) {
    const id = `p_${randomUUID()}`;
    insertProject(db, { id, name: 'Game', metadata: { kind: 'other', engineProfile: ENGINE, ...metadata }, createdAt: 1, updatedAt: 1 } as never);
    mkdirSync(path.join(projectsDir(), id), { recursive: true });
    return id;
  }
  /** The prompt the user would be asked to pay for, which is the prompt the run sends. */
  async function pricedPrompt(projectId: string, recipeId: string, inputs: Record<string, unknown>): Promise<string> {
    const before = cloud.quotes.length;
    const response = await fetch(`${base}/api/generate/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, recipeId, inputs, count: 1 }) });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(cloud.quotes.length).toBe(before + 1);
    return String(cloud.quotes.at(-1)!.prompt);
  }
  const icons = { items: 'red health potion, brass key', setName: 'pickups' };

  it('[P0] writes the look the user set into a preset that was given no style, never the preset\'s own', async () => {
    const id = game({ gameSetup: { art: { direction: DIRECTION } } });
    const prompt = await pricedPrompt(id, 'item-icon-set', icons);
    expect(prompt).not.toMatch(/pixel art/i);
    expect(prompt).toContain(`Style: ${DIRECTION}`);
  });

  it('[P0] names the game\'s style reference, not a preset look, when the user picked a sample but wrote no direction', async () => {
    const id = game({ artStyleId: 'pixel-8-bit', styleReference: 'concept/style-2.png' });
    const prompt = await pricedPrompt(id, 'item-icon-set', icons);
    expect(prompt).not.toMatch(/pixel art/i);
    expect(prompt).toMatch(/Style: match the game's existing art/);
  });

  it('[P1] keeps a style the user or agent typed into the preset', async () => {
    const id = game({ gameSetup: { art: { direction: DIRECTION } } });
    const prompt = await pricedPrompt(id, 'item-icon-set', { ...icons, style: 'chunky 16-bit pixel art' });
    expect(prompt).toContain('Style: chunky 16-bit pixel art');
    expect(prompt).not.toContain(DIRECTION);
  });

  it.each(IMAGE_RECIPES_WITH_STYLE)('[P1] %s ships no look of its own', async (recipeId) => {
    const manifest = JSON.parse(await readFile(path.join(BUNDLED, 'recipes', recipeId, 'pixo.json'), 'utf8')) as RecipeDetail['manifest'];
    const style = manifest.pixo!.recipe!.inputs.find(input => input.name === 'style');
    expect(style, recipeId).toBeDefined();
    expect(style!.default, recipeId).toBeUndefined();
    expect(style!.type ?? 'string', recipeId).toBe('string');
    for (const example of manifest.examples ?? []) expect((example as { inputs?: Record<string, unknown> }).inputs?.style, `${recipeId} example`).toBeUndefined();
  });
});

describe('the post-processing a preset adds', () => {
  const model = { id: 'stub-image', provider: 'stub', capabilities: ['t2i'] } as unknown as MediaModel;
  const watercolour = { id: 'storybook', title: 'Storybook', prompt: 'soft watercolour', negativePrompt: 'pixels', medium: ['watercolour'], previews: [], examples: [], license: 'Apache-2.0', description: '' } as unknown as ArtStyle;

  async function planned(look: Parameters<RecipeExecutor['plan']>[5], inputs: Record<string, unknown> = {}) {
    const root = await mkdtemp(path.join(tmpdir(), 'pixo-recipe-look-plan-'));
    const db = openDatabase(root, { dataDir: path.join(root, 'data') });
    try {
      const executor = new RecipeExecutor({ runtimeDataDir: path.join(root, 'data'), projectRoot: root, db, mediaTasks: createMediaTaskStore(db) });
      await executor.initialized;
      const detail = findRecipe(discoverRecipes(BUNDLED), 'item-icon-set');
      return await executor.plan(detail, root, { recipeId: detail.id, inputs: { items: 'key', setName: 'keys', ...inputs } }, model, null, look);
    } finally { closeDatabase(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
  }

  it('[P0] does not pixelate a game that is not pixel art', async () => {
    expect((await planned(null)).steps.map(step => step.op)).not.toContain('pixelate');
    expect((await planned(watercolour)).steps.map(step => step.op)).not.toContain('pixelate');
    expect((await planned({ artStyle: null, direction: DIRECTION })).steps.map(step => step.op)).not.toContain('pixelate');
  });

  it('[P1] pixelates a pixel-art game, and art the request asks to be pixel art', async () => {
    expect((await planned({ artStyle: null, pixelGrid: true })).steps.map(step => step.op)).toContain('pixelate');
    expect((await planned(null, { style: 'pixel art' })).steps.map(step => step.op)).toContain('pixelate');
  });

  it('[P1] names a picked style in the style slot and keeps its own prompt below', async () => {
    const plan = await planned(watercolour);
    expect(plan.prompt).toContain('Style: Storybook.');
    expect(plan.prompt).toContain('soft watercolour');
  });
});
