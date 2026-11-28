/**
 * A paid recipe that is cancelled, or whose daemon stops, while its hosted job is on the
 * way. Real recipe routes, executor, ledger, SQLite and hosted-media module over a fake
 * cloud whose reference upload and job can be held open. No real cloud, nothing spent.
 *
 * - Cancelled before the submit: nothing reaches the cloud and the reservation goes back.
 * - Cancelled after the submit: the job is paid whatever happens, so its file is kept.
 * - Stopped or crashed after the submit: the next start follows the job and the run shows it.
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
import { OpenPixoHostedMedia, type HostedCloud } from '../../src/media/openpixo-hosted.js';
import { createMediaTaskStore } from '../../src/media/task-store.js';
import { RecipeExecutor } from '../../src/recipes/executor.js';
import { registerRecipeRoutes } from '../../src/recipes/routes.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

// The machine's real tools (a signed-in Codex among them) must stay out of reach.
vi.mock('../../src/media/config.js', () => ({ readMaskedConfig: async () => ({ providers: {} }) }));
vi.mock('../../src/styles/service.js', () => ({ resolveArtStyleForGeneration: async () => null, projectUsesPixelGrid: () => false }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const CLOUD_ORIGIN = 'https://cloud.test';

/** A gate a fake cloud call waits on until the test opens it. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>(resolve => { open = resolve; });
  return { opened, open };
}

/**
 * A cloud that keeps the money rules: a submit reserves, a finished job charges, the same
 * request id answers with the same job. `holdReference` holds the generate's reference
 * registration (the quote's goes through); `holdJob` keeps a submitted job running.
 */
function fakeCloud() {
  const jobs = new Map<string, OpenPixoCloudGenerationJob>();
  const byKey = new Map<string, OpenPixoCloudGenerationJob>();
  const image = (id: string, min: number) => ({ id, surface: 'image' as const, label: id, credits: 4, priceVersion: 1, maxPromptChars: 12000,
    aspects: ['1:1'] as const, styles: [], references: { min, max: 4 },
    pricing: { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 0 } });
  const cloud = {
    charged: 0,
    references: 0,
    holdReference: null as ReturnType<typeof gate> | null,
    holdJob: null as ReturnType<typeof gate> | null,
    submits: [] as string[],
    api: {
      cloudOrigin: () => CLOUD_ORIGIN,
      generationServices: async () => ({ generationPaused: false, services: [image('openpixo-image', 0), image('openpixo-image-edit', 1)] }),
      generationReference: async (sha256: string) => {
        cloud.references += 1;
        // The first registration is the quote's; the next is the generate's, right before its submit.
        if (cloud.references > 1 && cloud.holdReference) await cloud.holdReference.opened;
        return { sha256, uploadUrl: null };
      },
      generationQuote: async (service: string, _params: OpenPixoGenerationParams) => ({ quoteId: randomUUID(), service, credits: 4, priceVersion: 1, paramsDigest: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(), available: 1000, breakdown: { base: 4, longPrompt: 0, extraReferences: 0 } }),
      generationSubmit: async (input: { quoteId: string; idempotencyKey: string; service: string }) => {
        cloud.submits.push(input.idempotencyKey);
        const existing = byKey.get(input.idempotencyKey);
        if (existing) return { ...existing };
        const job: OpenPixoCloudGenerationJob = { jobId: randomUUID(), service: input.service, state: 'running', creditsReserved: 4, creditsCharged: null,
          errorCode: null, artifact: null, download: null, createdAt: '2026-11-28T00:00:00.000Z', updatedAt: '2026-11-28T00:00:00.000Z' };
        byKey.set(input.idempotencyKey, job);
        jobs.set(job.jobId, job);
        if (!cloud.holdJob) finish(job);
        else void cloud.holdJob.opened.then(() => finish(job));
        return { ...job };
      },
      generationJob: async (jobId: string) => ({ ...jobs.get(jobId)! }),
    },
  };
  function finish(job: OpenPixoCloudGenerationJob) {
    if (job.state === 'succeeded') return;
    Object.assign(job, { state: 'succeeded', creditsCharged: 4, artifact: { mime: 'image/png', bytes: PNG.length, sha256: sha(PNG) },
      download: { url: `${CLOUD_ORIGIN}/${job.jobId}.png`, expiresAt: '2099-01-01T00:00:00.000Z' } });
    cloud.charged += 4;
  }
  return cloud;
}

const RECIPE = { name: 'test-hosted', title: 'Hosted sprite', version: '0.1.0', pixo: { kind: 'recipe', recipe: {
  surface: 'image', category: 'character', engines: ['any'],
  inputs: [{ name: 'prompt', type: 'text', default: 'a hero' }, { name: 'reference', type: 'image-ref' }],
  prompt: '{{prompt}} sprite', models: { requires: [], recommended: [], fallback: [] },
  generation: { count: { default: 1, max: 4 }, aspect: '1:1' },
  output: { dir: 'sprites', name: 'hero' },
} } };

describe('a paid recipe cancelled or interrupted on its way', () => {
  let root = '';
  let db: ReturnType<typeof openDatabase>;
  let cloud: ReturnType<typeof fakeCloud>;
  let ledger: ArtBudgetLedger;
  let mediaTasks: ReturnType<typeof createMediaTaskStore>;
  let hosted: OpenPixoHostedMedia;
  let executor: RecipeExecutor;
  let server: Server;
  let base = '';
  /** Set when the daemon "dies": its hosted module then never takes another step. */
  let frozen = false;
  const extra: OpenPixoHostedMedia[] = [];
  const projectsDir = () => path.join(root, 'projects');
  const dataDir = () => path.join(root, 'data');
  // A real wait between polls, so the follow loop never starves the HTTP server.
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  const download = async (url: string | URL | Request) => { void url; return new Response(new Uint8Array(PNG), { status: 200 }); };

  beforeEach(async () => {
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('PIXO_FAL_KEY', '');
    root = await mkdtemp(path.join(tmpdir(), 'pixo-recipe-cancel-'));
    const bundled = path.join(root, 'plugins');
    await mkdir(path.join(bundled, 'recipes', 'test-hosted'), { recursive: true });
    await writeFile(path.join(bundled, 'recipes', 'test-hosted', 'pixo.json'), JSON.stringify(RECIPE));
    await mkdir(projectsDir(), { recursive: true });
    db = openDatabase(root, { dataDir: dataDir() });
    cloud = fakeCloud();
    frozen = false;
    mediaTasks = createMediaTaskStore(db, { isRunActive: () => true });
    hosted = new OpenPixoHostedMedia({ db, cloud: cloud.api as unknown as HostedCloud, projectsRoot: projectsDir(), tasks: mediaTasks,
      getProjectMetadata: id => getProject(db, id)?.metadata, fetch: download as typeof fetch,
      sleep: () => frozen ? new Promise<void>(() => {}) : tick() });
    ledger = new ArtBudgetLedger(db);
    hosted.attachSettlement(ledger);
    const app = express();
    app.use(express.json());
    executor = registerRecipeRoutes(app, { db, mediaTasks,
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
    cloud.holdReference?.open();
    cloud.holdJob?.open();
    hosted.close();
    for (const other of extra.splice(0)) other.close();
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
  const token = (projectId: string) => toolTokenRegistry.mint({ runId: `run_${randomUUID()}`, projectId }).token;
  async function startRun(projectId: string, body: Record<string, unknown> = {}): Promise<RecipeRun> {
    ledger.setLimit(projectId, 100);
    ledger.setMode(projectId, 'auto');
    const response = await fetch(`${base}/api/projects/${projectId}/recipe-runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(projectId)}` },
      body: JSON.stringify({ recipeId: 'test-hosted', ...body }),
    });
    expect(response.status, await response.clone().text()).toBe(202);
    return await response.json() as RecipeRun;
  }
  const cancel = async (projectId: string, runId: string) => {
    const response = await fetch(`${base}/api/projects/${projectId}/recipe-runs/${runId}/cancel`, { method: 'POST' });
    expect(response.status, await response.clone().text()).toBe(200);
    return await response.json() as RecipeRun;
  };
  const jobRows = () => db.prepare('SELECT state FROM openpixo_cloud_jobs').all() as Array<{ state: string }>;

  it('sends nothing and gives the reservation back when cancelled before the submit', async () => {
    const id = project();
    await writeFile(path.join(projectsDir(), id, 'ref.png'), PNG);
    cloud.holdReference = gate();
    const run = await startRun(id, { inputs: { reference: 'ref.png' } });
    // The generate is uploading its reference: nothing has been submitted yet.
    await vi.waitFor(() => expect(cloud.references).toBe(2));
    expect(ledger.read(id)).toMatchObject({ reservedCredits: 4 });
    const cancelled = await cancel(id, run.id);
    expect(cancelled.status).toBe('cancelled');
    cloud.holdReference.open();
    const settled = await executor.wait(id, run.id);
    expect(settled.status).toBe('cancelled');
    expect(cloud.submits).toEqual([]);
    expect(cloud.charged).toBe(0);
    expect(jobRows()).toEqual([]);
    expect(ledger.read(id)).toMatchObject({ usedCredits: 0, reservedCredits: 0 });
  });

  it('keeps the paid file when cancelled after the submit, and the run shows it', async () => {
    const id = project();
    cloud.holdJob = gate();
    const run = await startRun(id);
    await vi.waitFor(() => expect(cloud.submits).toHaveLength(1));
    const answer = await cancel(id, run.id);
    // Already paid for: the cancel cannot stop it, so the run keeps going.
    expect(answer.status).not.toBe('cancelled');
    cloud.holdJob.open();
    const settled = await executor.wait(id, run.id);
    expect(cloud.charged).toBe(4);
    expect(settled.status, JSON.stringify(settled)).toBe('ready');
    const staged = settled.candidates[0]!.stagedFiles[0]!;
    await expect(readFile(staged.ref)).resolves.toEqual(PNG);
    expect(ledger.read(id)).toMatchObject({ spentCredits: 4, reservedCredits: 0 });
  });

  it('stops only the candidates not sent yet, and keeps the one already paid', async () => {
    const id = project();
    await writeFile(path.join(projectsDir(), id, 'ref.png'), PNG);
    cloud.holdJob = gate();
    // Two candidates: hold the second one's reference upload so only the first is submitted.
    let registrations = 0;
    const held = gate();
    const register = cloud.api.generationReference;
    cloud.api.generationReference = async (sha256: string) => {
      registrations += 1;
      // Quotes register twice, then each candidate's generate once: hold the last one.
      if (registrations === 4) await held.opened;
      return register(sha256);
    };
    const run = await startRun(id, { count: 2, inputs: { reference: 'ref.png' } });
    await vi.waitFor(() => { expect(cloud.submits).toHaveLength(1); expect(registrations).toBe(4); });
    await cancel(id, run.id);
    held.open();
    cloud.holdJob.open();
    const settled = await executor.wait(id, run.id);
    expect(cloud.submits).toHaveLength(1);
    expect(cloud.charged).toBe(4);
    expect(settled.status, JSON.stringify(settled)).toBe('ready');
    const kept = settled.candidates.filter(candidate => candidate.stagedFiles.length);
    expect(kept).toHaveLength(1);
    expect(ledger.read(id)).toMatchObject({ spentCredits: 4, reservedCredits: 0, usedCredits: 4 });
  });

  /** A second daemon on the same data: its own hosted module, task store and executor. */
  async function restart() {
    const tasks = createMediaTaskStore(db, { isRunActive: () => true });
    const next = new OpenPixoHostedMedia({ db, cloud: cloud.api as unknown as HostedCloud, projectsRoot: projectsDir(), tasks,
      getProjectMetadata: projectId => getProject(db, projectId)?.metadata, fetch: download as typeof fetch, sleep: tick });
    next.attachSettlement(ledger);
    extra.push(next);
    next.resumePending();
    const restarted = new RecipeExecutor({ runtimeDataDir: dataDir(), projectRoot: root, db, mediaTasks: tasks, hosted: next });
    await restarted.initialized;
    return { executor: restarted, tasks };
  }

  it('shows the paid file after a crash once the next start has followed the job', async () => {
    const id = project();
    cloud.holdJob = gate();
    const run = await startRun(id);
    await vi.waitFor(() => expect(jobRows()).toEqual([{ state: 'pending' }]));
    // The daemon dies: its hosted module never takes another step, so nothing more is written.
    frozen = true;
    const { executor: restarted, tasks } = await restart();
    expect((await restarted.get(id, run.id)).status).not.toBe('failed');
    cloud.holdJob.open();
    const settled = await restarted.wait(id, run.id);
    expect(settled.status, JSON.stringify(settled)).toBe('ready');
    const candidate = settled.candidates[0]!;
    await expect(readFile(candidate.stagedFiles[0]!.ref)).resolves.toEqual(PNG);
    // The media card points at the staged file, not at a game file of that name.
    const task = tasks.getLiveMediaTask(candidate.mediaTaskId!)!;
    expect(task.status).toBe('done');
    expect(task.file).toMatchObject({ recipeRunId: run.id, candidateId: candidate.id });
    expect(cloud.submits).toHaveLength(1);
    expect(ledger.read(id)).toMatchObject({ spentCredits: 4, reservedCredits: 0 });
  });

  it('shows the paid file after a clean shutdown too', async () => {
    const id = project();
    cloud.holdJob = gate();
    const run = await startRun(id);
    await vi.waitFor(() => expect(jobRows()).toEqual([{ state: 'pending' }]));
    // A clean stop: the hosted module stops following and says the job resumes on the next start.
    hosted.close();
    await executor.wait(id, run.id);
    const { executor: restarted } = await restart();
    cloud.holdJob.open();
    const settled = await restarted.wait(id, run.id);
    expect(settled.status, JSON.stringify(settled)).toBe('ready');
    await expect(readFile(settled.candidates[0]!.stagedFiles[0]!.ref)).resolves.toEqual(PNG);
    expect(cloud.submits).toHaveLength(1);
  });

  it('still marks a run that was never sent as interrupted after a restart', async () => {
    const id = project();
    await writeFile(path.join(projectsDir(), id, 'ref.png'), PNG);
    // The dead daemon never hears back, so it never writes again.
    cloud.holdReference = { opened: new Promise<void>(() => {}), open: () => {} };
    const run = await startRun(id, { inputs: { reference: 'ref.png' } });
    await vi.waitFor(() => expect(cloud.references).toBe(2));
    frozen = true;
    const { executor: restarted } = await restart();
    const settled = await restarted.wait(id, run.id);
    expect(settled.status).toBe('failed');
    expect(settled.error).toBe('Interrupted by a restart before it was sent; nothing was charged for it.');
    expect(cloud.submits).toEqual([]);
  });
});
