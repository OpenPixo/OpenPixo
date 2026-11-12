/**
 * The art budget at the daemon HTTP boundary: real routes, real ledger, real
 * SQLite and the real hosted-media module, over a fake cloud. No real cloud calls
 * and no spending. The fake cloud keeps the cloud's own rules (idempotent per
 * request id, one job per key, a refused request reserves nothing), so
 * `cloud.charged` says what the user would really have paid.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OPENPIXO_MODEL3D_PROMPT, type ArtBudgetResponse, type ApproveGamePlanResponse, type OpenPixoCloudGenerationJob, type OpenPixoGenerationParams } from '@openpixo/contracts';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountError } from '../../src/account/errors.js';
import { closeDatabase, getProject, insertProject, openDatabase, updateProject } from '../../src/db.js';
import { ArtBudgetLedger } from '../../src/game/art-budget.js';
import { GAME_PLAN_USAGE, runGamePlanCli } from '../../src/game/plan-cli.js';
import { createToolRequestAuth } from '../../src/http/tool-request-auth.js';
import { requireLocalDaemonRequest } from '../../src/http/local-daemon-request.js';
import { generateMedia } from '../../src/media/index.js';
import { OpenPixoHostedMedia, type HostedCloud } from '../../src/media/openpixo-hosted.js';
import { confirmOpenPixoHosted } from '../../src/media/openpixo-hosted-cli.js';
import { createMediaTaskStore } from '../../src/media/task-store.js';
import { isLocalSameOrigin } from '../../src/origin-validation.js';
import { registerArtBudgetRoutes } from '../../src/routes/art-budget.js';
import { registerGamePlanRoutes } from '../../src/routes/game-plan.js';
import { registerMediaRoutes } from '../../src/routes/media.js';
import { resolveProjectDir } from '../../src/projects.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

const styleForTest = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('../../src/styles/service.js', () => ({ resolveArtStyleForGeneration: async () => styleForTest.current }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
const PNG_SHA = createHash('sha256').update(PNG).digest('hex');
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(120, 9)]);
const MP3_SHA = createHash('sha256').update(MP3).digest('hex');
const GLB = Buffer.concat([Buffer.from('glTF', 'latin1'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(120, 3)]);
const GLB_SHA = createHash('sha256').update(GLB).digest('hex');
const VENDOR_ORIGIN = 'https://media.example';
const CLOUD_ORIGIN = 'https://cloud.test';
const AUDIO_SERVICE = { surface: 'audio' as const, priceVersion: 1, aspects: [] as const, references: { min: 0, max: 0 },
  pricing: { longPromptTokens: 1000, longPromptCredits: 0, maxPromptTokens: 1000, extraReferenceCredits: 0 } };

type Outcome =
  | 'succeeded' | 'failed' | 'checking' | 'vanishes' | 'conflict' | 'unavailable'
  | { refuse: ConstructorParameters<typeof AccountError>[0] };

/** A stand-in for the cloud with its real money rules: see the file comment. */
function fakeCloud() {
  const jobsById = new Map<string, OpenPixoCloudGenerationJob>();
  const jobsByKey = new Map<string, OpenPixoCloudGenerationJob>();
  const cloud = {
    price: 4,
    available: 1000,
    /** What the next new job does; a resumed job can be told to change later. */
    outcome: 'succeeded' as Outcome,
    charged: 0,
    /** Hands out a vendor link and no hash, as the cloud does on direct delivery. */
    direct: false,
    /** What the link serves, when it isn't the file the job says it is. */
    served: null as Buffer | null,
    quotes: [] as Array<{ service: string; params: OpenPixoGenerationParams }>,
    submits: [] as Array<{ quoteId: string; idempotencyKey: string; service: string; params: OpenPixoGenerationParams }>,
    /** Lets a test hold every quote open until it says otherwise. */
    quoteGate: null as Promise<void> | null,
    settle(job: OpenPixoCloudGenerationJob, state: OpenPixoCloudGenerationJob['state']) {
      job.state = state;
      if (state === 'failed') { cloud.charged -= job.creditsReserved; job.errorCode = 'VENDOR_FAILED'; }
      if (state === 'succeeded') {
        job.creditsCharged = job.creditsReserved;
        const audio = /^openpixo-(sfx|voice|music)$/u.test(job.service);
        const model = /^openpixo-model3d(-draft|-high)?$/u.test(job.service);
        const { mime, bytes, sha256, extension } = audio ? { mime: 'audio/mpeg' as const, bytes: MP3.length, sha256: MP3_SHA, extension: 'mp3' }
          : model ? { mime: 'model/gltf-binary' as const, bytes: GLB.length, sha256: GLB_SHA, extension: 'glb' }
          : { mime: 'image/png' as const, bytes: PNG.length, sha256: PNG_SHA, extension: 'png' };
        job.artifact = { mime, bytes, sha256: cloud.direct ? null : sha256 };
        job.download = { url: `${cloud.direct ? VENDOR_ORIGIN : CLOUD_ORIGIN}/${job.jobId}.${extension}`, expiresAt: '2026-11-05T00:05:00.000Z' };
      }
    },
    lastJob: () => [...jobsById.values()].at(-1)!,
    api: {
      cloudOrigin: () => CLOUD_ORIGIN,
      generationServices: async () => ({ generationPaused: false, services: [
        { id: 'openpixo-image', surface: 'image' as const, label: 'x', credits: cloud.price, priceVersion: 1, maxPromptChars: 12000,
          aspects: ['1:1', '2:3', '3:2'] as const, styles: [], references: { min: 0, max: 0 },
          pricing: { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1 } },
        { id: 'openpixo-image-edit', surface: 'image' as const, label: 'y', credits: cloud.price, priceVersion: 1, maxPromptChars: 12000,
          aspects: ['1:1', '2:3', '3:2'] as const, styles: [], references: { min: 1, max: 4 },
          pricing: { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1 } },
        { ...AUDIO_SERVICE, id: 'openpixo-sfx', audioKind: 'sfx' as const, label: 'Sound effect', credits: cloud.price, maxPromptChars: 450, styles: [], durationSeconds: { min: 0.5, max: 10, default: 3 } },
        { ...AUDIO_SERVICE, id: 'openpixo-voice', audioKind: 'speech' as const, label: 'Voice line', credits: cloud.price, maxPromptChars: 300, styles: ['Rachel', 'Aria'] },
        { ...AUDIO_SERVICE, id: 'openpixo-music', audioKind: 'music' as const, label: 'Music', credits: cloud.price, maxPromptChars: 300, minPromptChars: 10, styles: [] },
        { ...AUDIO_SERVICE, surface: 'model3d' as const, id: 'openpixo-model3d', label: '3D model', credits: cloud.price, maxPromptChars: 200, styles: [], references: { min: 1, max: 1 } },
        { ...AUDIO_SERVICE, surface: 'model3d' as const, id: 'openpixo-model3d-high', label: '3D model (high)', credits: cloud.price, maxPromptChars: 200, styles: [], references: { min: 1, max: 1 } },
      ] }),
      generationReference: async (sha256: string) => ({ sha256, uploadUrl: null }),
      generationQuote: async (service: string, params: OpenPixoGenerationParams) => {
        cloud.quotes.push({ service, params });
        if (cloud.quoteGate) await cloud.quoteGate;
        return { quoteId: randomUUID(), service, credits: cloud.price, priceVersion: 1, paramsDigest: 'a'.repeat(64),
          expiresAt: '2026-11-05T01:00:00.000Z', available: cloud.available, breakdown: { base: cloud.price, longPrompt: 0, extraReferences: 0 } };
      },
      generationSubmit: async (input: { quoteId: string; idempotencyKey: string; service: string; params: OpenPixoGenerationParams }) => {
        cloud.submits.push(input);
        const existing = jobsByKey.get(input.idempotencyKey);
        if (existing) return { ...existing };
        const outcome = cloud.outcome;
        if (outcome === 'unavailable') throw new AccountError('CLOUD_UNAVAILABLE');
        if (outcome === 'conflict') throw new AccountError('GENERATION_IDEMPOTENCY_CONFLICT');
        if (typeof outcome === 'object') throw new AccountError(outcome.refuse);
        const job: OpenPixoCloudGenerationJob = { jobId: randomUUID(), service: input.service, state: 'running', creditsReserved: cloud.price, creditsCharged: null,
          errorCode: null, artifact: null, download: null, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' };
        cloud.charged += cloud.price;
        jobsByKey.set(input.idempotencyKey, job);
        jobsById.set(job.jobId, job);
        if (outcome === 'succeeded' || outcome === 'failed') cloud.settle(job, outcome);
        if (outcome === 'checking') job.state = 'checking';
        return { ...job };
      },
      generationJob: async (jobId: string) => {
        if (cloud.outcome === 'vanishes') throw new AccountError('GENERATION_JOB_NOT_FOUND');
        const job = jobsById.get(jobId);
        if (!job) throw new AccountError('GENERATION_JOB_NOT_FOUND');
        return { ...job };
      },
    },
  };
  return cloud;
}

const artifactFor = (url: string) => (url.endsWith('.mp3') ? MP3 : url.endsWith('.glb') ? GLB : PNG);
const quickSleep = () => new Promise<void>(resolve => setTimeout(resolve, 2));

interface Harness {
  base: string;
  ledger: ArtBudgetLedger;
  hosted: OpenPixoHostedMedia;
  stop: () => Promise<void>;
}

describe('the art budget', () => {
  let root = '';
  let cloud: ReturnType<typeof fakeCloud>;
  let db: ReturnType<typeof openDatabase>;
  let busy: Set<string>;
  let signedIn = true;
  let ownImageTool = false;
  let harness: Harness;
  let tasks: ReturnType<typeof createMediaTaskStore>;
  const projectsDir = () => path.join(root, 'projects');

  function start(): Promise<Harness> {
    const hosted = new OpenPixoHostedMedia({ db, cloud: cloud.api as unknown as HostedCloud, projectsRoot: projectsDir(),
      getProjectMetadata: id => getProject(db, id)?.metadata, tasks, sleep: quickSleep,
      fetch: async url => new Response(new Uint8Array(cloud.served ?? artifactFor(String(url))), { status: 200 }) });
    const ledger = new ArtBudgetLedger(db);
    hosted.attachSettlement(ledger);
    const auth = createToolRequestAuth(toolTokenRegistry);
    const portRef = { current: 0 };
    const http = {
      sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
      requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef: portRef,
    };
    const paths = { PROJECT_ROOT: root, PROJECTS_DIR: projectsDir(), RUNTIME_DATA_DIR: path.join(root, 'data') };
    const account = {
      hasSession: async () => signedIn,
      balance: async () => {
        if (!signedIn) throw new AccountError('ACCOUNT_SIGNED_OUT');
        return { available: cloud.available, reserved: 0, subscription: null };
      },
      generationServices: async () => cloud.api.generationServices(),
    };
    const artBudget = { ledger, account, isProjectBusy: (id: string) => busy.has(id) };
    const app = express();
    app.use(express.json());
    registerGamePlanRoutes(app, { db, http, paths, artBudget, templatesRoot: '', isProjectBusy: (id: string) => busy.has(id),
      authorizeProjectRequest: async () => true, authorizeProjectToolRequest: async () => true } as never);
    registerArtBudgetRoutes(app, { db, http, ...artBudget, readImageTools: async () => ownImageTool ? ['openai'] : [],
      authorizeProjectRequest: async () => true } as never);
    const design = { runs: { get: (id: string) => ({ id, mediaExecution: undefined }), noteMediaTaskFailure: () => {} },
      readAnalyticsContext: () => null, analytics: { capture: () => {} }, getAppVersion: () => 'test' };
    registerMediaRoutes(app, {
      db, design, http, paths, ids: { randomUUID }, auth,
      media: { ...tasks, IMAGE_MODELS: [], VIDEO_MODELS: [], AUDIO_MODELS_BY_KIND: {}, MEDIA_PROVIDERS: [], listMediaTasksByProject: () => [],
        generateMedia: (args: Parameters<typeof generateMedia>[0]) => generateMedia({ ...args, openpixoHosted: hosted }),
        openpixoHosted: hosted, artBudget: ledger },
      appConfig: { readAppConfig: async () => ({}), writeAppConfig: async () => ({}) }, nativeDialogs: {},
      projectStore: { getProject }, projectFiles: { resolveProjectDir, listFiles: async () => [], resolveProjectFilePath: async () => { throw new Error('none'); } },
      conversations: {}, research: {},
      authorizeProjectRequest: async () => true, authorizeProjectToolRequest: async () => true,
    } as never);
    const server: Server = app.listen(0, '127.0.0.1');
    const { mediaTasks } = tasks;
    return new Promise<Harness>((resolve) => {
      server.once('listening', () => {
        portRef.current = (server.address() as { port: number }).port;
        resolve({ base: `http://127.0.0.1:${portRef.current}`, ledger, hosted, stop: async () => {
          hosted.close();
          server.closeAllConnections();
          await new Promise(done => server.close(done));
          // Closing tells followed jobs to stop; each one still writes its last row.
          await vi.waitFor(() => {
            for (const task of mediaTasks.values()) if (task.status === 'queued' || task.status === 'running') throw new Error('still following');
          }, { timeout: 5000, interval: 2 });
        } });
      });
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pixo-art-budget-'));
    await mkdir(projectsDir(), { recursive: true });
    db = openDatabase(root, { dataDir: path.join(root, 'data') });
    tasks = createMediaTaskStore(db, { isRunActive: () => true });
    cloud = fakeCloud();
    busy = new Set();
    signedIn = true;
    ownImageTool = false;
    styleForTest.current = null;
    harness = await start();
  });

  afterEach(async () => {
    await harness.stop();
    closeDatabase();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function project(metadata: Record<string, unknown> = { kind: 'other', gamePlan: { status: 'approved', startedAt: 1, approvedAt: 2 } }) {
    const id = `p_${randomUUID()}`;
    insertProject(db, { id, name: 'Game', metadata, createdAt: 1, updatedAt: 1 } as never);
    return id;
  }
  const planning = () => project({ kind: 'other', gamePlan: { status: 'planning', startedAt: 1 } });
  const token = (projectId: string, runId = `run_${randomUUID()}`) => toolTokenRegistry.mint({ runId, projectId }).token;
  const post = (route: string, body: unknown = {}, headers: Record<string, string> = {}) => fetch(`${harness.base}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: harness.base, ...headers }, body: JSON.stringify(body),
  });
  /**
   * Most of this file is about the budget itself, so it spends as `auto` did before
   * spending modes; `ask` has its own block below.
   */
  const setBudget = (projectId: string, credits: number, headers: Record<string, string> = {}) => post(`/api/projects/${projectId}/art-budget`, { credits, mode: 'auto' }, headers);
  const setAsking = (projectId: string, credits: number) => post(`/api/projects/${projectId}/art-budget`, { credits, mode: 'ask' });
  const approveArt = (projectId: string, credits: number, headers: Record<string, string> = {}) => post(`/api/projects/${projectId}/art-budget/approve`, { credits }, headers);
  const state = async (projectId: string, headers: Record<string, string> = {}) =>
    await (await fetch(`${harness.base}/api/projects/${projectId}/art-budget`, { headers })).json() as ArtBudgetResponse;
  const budget = async (projectId: string) => (await (await fetch(`${harness.base}/api/projects/${projectId}/art-budget`)).json() as ArtBudgetResponse).budget;
  const agentGenerate = (bearer: string, prompt = 'a pixel slime', extra: Record<string, unknown> = {}) =>
    post('/api/tools/media/generate', { surface: 'image', model: 'openpixo-image', prompt, output: `sprites/${randomUUID()}.png`, ...extra }, { Authorization: `Bearer ${bearer}` });
  async function finished(response: Response) {
    expect(response.status, await response.clone().text()).toBe(202);
    const { taskId } = await response.json() as { taskId: string };
    return vi.waitFor(() => {
      const task = tasks.getLiveMediaTask(taskId)!;
      if (task.status === 'queued' || task.status === 'running') throw new Error('still running');
      return task;
    }, { timeout: 5000, interval: 2 });
  }
  /** The moment a dispatched job has reached the cloud. */
  const reachedCloud = (submits: number) => vi.waitFor(() => expect(cloud.submits.length).toBeGreaterThanOrEqual(submits), { timeout: 5000, interval: 2 });
  const errorOf = async (response: Response) => (await response.json() as { error: { code: string; message: string } }).error;

  describe('the agent can spend only an existing budget', () => {
    it('refuses an agent with no budget set, and asks nothing of the cloud', async () => {
      const id = project();
      const response = await agentGenerate(token(id));
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe('GENERATION_CONFIRMATION_REQUIRED');
      expect(cloud.quotes).toHaveLength(0);
      expect(cloud.charged).toBe(0);
    });

    it('treats a budget of 0 as no budget', async () => {
      const id = project();
      expect((await setBudget(id, 0)).status).toBe(200);
      const response = await agentGenerate(token(id));
      expect((await errorOf(response)).code).toBe('GENERATION_CONFIRMATION_REQUIRED');
      expect(cloud.quotes).toHaveLength(0);
    });

    it('refuses hosted spending while the plan is pending and the user has set no budget', async () => {
      const id = planning();
      const response = await agentGenerate(token(id));
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe('GENERATION_CONFIRMATION_REQUIRED');
      expect(cloud.quotes).toHaveLength(0);
      expect(cloud.charged).toBe(0);
    });

    it('pays planning\'s style samples from a budget the user set before approval, within the concept cap', async () => {
      // Owner decision 2026-11-10: the art step shows samples, and only the user sets what they may cost.
      const id = planning();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentGenerate(token(id), 'style sample'));
      expect(task.status).toBe('done');
      expect(cloud.quotes).toHaveLength(1);
      expect((await budget(id))?.usedCredits).toBeGreaterThan(0);
      expect(getProject(db, id)!.metadata?.gamePlan?.conceptImages).toBe(1);
      expect(getProject(db, id)!.metadata?.gamePlan?.status).toBe('planning');
    });

    it('never lets a token spend another project\'s budget', async () => {
      const mine = project();
      const theirs = project();
      expect((await setBudget(theirs, 100)).status).toBe(200);
      const bearer = token(mine);
      // Its own project has none, whatever the body names.
      const own = await agentGenerate(bearer, 'slime', { projectId: theirs });
      expect((await errorOf(own)).code).toBe('GENERATION_CONFIRMATION_REQUIRED');
      // The project route accepts a tool token too: the grant decides, not the path.
      const direct = await post(`/api/projects/${theirs}/media/generate`, { surface: 'image', model: 'openpixo-image', prompt: 'slime', output: 'a.png' }, { Authorization: `Bearer ${bearer}` });
      expect(direct.status).toBe(403);
      expect(cloud.quotes).toHaveLength(0);
      expect(cloud.charged).toBe(0);
      expect((await budget(theirs))?.usedCredits).toBe(0);
    });

    it('spends within the budget, writes the file and records the charge', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentGenerate(token(id), 'a pixel slime', { output: 'sprites/slime.png' }));
      expect(task.status).toBe('done');
      await expect(readFile(path.join(projectsDir(), id, 'sprites', 'slime.png'))).resolves.toEqual(PNG);
      expect(cloud.charged).toBe(4);
      expect(await budget(id)).toMatchObject({ limitCredits: 100, usedCredits: 4, spentCredits: 4, reservedCredits: 0, remainingCredits: 96 });
      const rows = db.prepare('SELECT status, credits, run_id FROM project_art_budget_charges WHERE project_id = ?').all(id) as Array<{ status: string; credits: number; run_id: string }>;
      expect(rows).toEqual([expect.objectContaining({ status: 'spent', credits: 4 })]);
      expect(rows[0]!.run_id).toBeTruthy();
    });

    it('refuses a quote above what remains, with nothing spent', async () => {
      const id = project();
      expect((await setBudget(id, 3)).status).toBe(200);
      const response = await agentGenerate(token(id));
      expect(response.status).toBe(409);
      const error = await errorOf(response);
      expect(error.code).toBe('ART_BUDGET_EXHAUSTED');
      expect(error.message).toContain('0 of 3');
      expect(cloud.submits).toHaveLength(0);
      expect(cloud.charged).toBe(0);
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('stops at the limit without asking the cloud for a price it cannot pay', async () => {
      const id = project();
      expect((await setBudget(id, 4)).status).toBe(200);
      const bearer = token(id);
      await finished(await agentGenerate(bearer, 'first'));
      const quotesBefore = cloud.quotes.length;
      const response = await agentGenerate(bearer, 'second');
      expect((await errorOf(response)).code).toBe('ART_BUDGET_EXHAUSTED');
      expect(cloud.quotes).toHaveLength(quotesBefore);
      expect(cloud.charged).toBe(4);
    });

    it('lets only one of two concurrent requests through a budget that covers one', async () => {
      const id = project();
      expect((await setBudget(id, 4)).status).toBe(200);
      const bearer = token(id);
      let open!: () => void;
      cloud.quoteGate = new Promise<void>(resolve => { open = resolve; });
      const both = Promise.all([agentGenerate(bearer, 'first slime'), agentGenerate(bearer, 'second slime')]);
      await vi.waitFor(() => expect(cloud.quotes).toHaveLength(2), { timeout: 5000, interval: 2 });
      open();
      const responses = await both;
      expect(responses.map(response => response.status).sort()).toEqual([202, 409]);
      await reachedCloud(1);
      await finished(responses.find(response => response.status === 202)!);
      expect(cloud.submits).toHaveLength(1);
      expect(cloud.charged).toBe(4);
      expect((await budget(id))?.usedCredits).toBe(4);
    });
  });

  describe('a charge is only released when the cloud kept nothing', () => {
    it('releases a job the cloud failed, which returned the credits', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = 'failed';
      const task = await finished(await agentGenerate(token(id)));
      expect(task.status).toBe('failed');
      expect(cloud.charged).toBe(0);
      expect(await budget(id)).toMatchObject({ usedCredits: 0, remainingCredits: 100 });
    });

    it.each(['INSUFFICIENT_CREDITS', 'GENERATION_QUOTE_EXPIRED', 'GENERATION_QUOTE_INVALID', 'GENERATION_RATE_LIMITED'] as const)(
      'releases when the cloud refused the submit with %s', async (code) => {
        const id = project();
        expect((await setBudget(id, 100)).status).toBe(200);
        cloud.outcome = { refuse: code };
        const task = await finished(await agentGenerate(token(id)));
        expect(task.status).toBe('failed');
        expect(cloud.charged).toBe(0);
        expect((await budget(id))?.usedCredits).toBe(0);
      });

    it('releases when the request never reached the cloud', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentGenerate(token(id), 'slime', { output: '../outside.png' }));
      expect(task.status).toBe('failed');
      expect(cloud.submits).toHaveLength(0);
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('keeps counting a job that disappears after it was accepted', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = 'checking';
      const pending = agentGenerate(token(id));
      await reachedCloud(1);
      cloud.outcome = 'vanishes';
      const task = await finished(await pending);
      expect(task.status).toBe('failed');
      expect(await budget(id)).toMatchObject({ usedCredits: 4, reservedCredits: 4, remainingCredits: 96 });
    });

    it('keeps counting a job whose outcome is unknown while it stays unknown', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = 'checking';
      expect((await agentGenerate(token(id))).status).toBe(202);
      await reachedCloud(1);
      expect(await budget(id)).toMatchObject({ usedCredits: 4, reservedCredits: 4, spentCredits: 0 });
    });

    it('keeps counting while the cloud cannot be reached, and retries the same request id', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = 'unavailable';
      expect((await agentGenerate(token(id))).status).toBe(202);
      await reachedCloud(3);
      expect((await budget(id))?.usedCredits).toBe(4);
      expect(new Set(cloud.submits.map(submit => submit.idempotencyKey)).size).toBe(1);
    });

    it('keeps counting on a refusal that does not prove nothing was reserved', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = 'conflict';
      const task = await finished(await agentGenerate(token(id)));
      expect(task.status).toBe('failed');
      expect((await budget(id))?.usedCredits).toBe(4);
    });

    it('does not trust a refusal raised before the cloud looked for the job, once an earlier attempt may have reached it', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = 'unavailable';
      const response = agentGenerate(token(id));
      await reachedCloud(2);
      cloud.outcome = { refuse: 'GENERATION_PAUSED' };
      const task = await finished(await response);
      expect(task.status).toBe('failed');
      expect((await budget(id))?.usedCredits).toBe(4);
    });

    it('releases that same refusal on a clean first attempt, when no job can exist', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = { refuse: 'GENERATION_PAUSED' };
      const task = await finished(await agentGenerate(token(id)));
      expect(task.status).toBe('failed');
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('keeps a paid image counted when only the download fails', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      await harness.stop();
      const hosted = new OpenPixoHostedMedia({ db, cloud: cloud.api as unknown as HostedCloud, projectsRoot: projectsDir(),
        getProjectMetadata: () => undefined, sleep: quickSleep, fetch: async () => new Response('', { status: 500 }) });
      const ledger = new ArtBudgetLedger(db);
      hosted.attachSettlement(ledger);
      const requestId = `artbudget-${randomUUID()}`;
      const quoteId = randomUUID();
      ledger.reserve({ projectId: id, runId: 'run', fingerprint: 'f', quoteId, service: 'openpixo-image', credits: 4, requestId });
      await expect(hosted.generate({ taskId: 'download-task', projectId: id, service: 'openpixo-image', params: { prompt: 'x' }, quoteId, cloudRequestId: requestId, output: 'x.png' }))
        .rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED' });
      hosted.close();
      expect(ledger.read(id)).toMatchObject({ spentCredits: 4, usedCredits: 4 });
      harness = await start();
    });
  });

  describe('a retry never charges twice', () => {
    it('reuses the request id and the quote for an identical request whose outcome is open', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = 'checking';
      const bearer = token(id);
      const body = { output: 'sprites/slime.png' };
      expect((await agentGenerate(bearer, 'a pixel slime', body)).status).toBe(202);
      await reachedCloud(1);
      expect((await agentGenerate(bearer, 'a pixel slime', body)).status).toBe(202);
      await reachedCloud(2);
      expect(cloud.quotes).toHaveLength(1);
      expect(cloud.submits[1]!.idempotencyKey).toBe(cloud.submits[0]!.idempotencyKey);
      expect(cloud.submits[1]!.quoteId).toBe(cloud.submits[0]!.quoteId);
      expect(cloud.charged).toBe(4);
      expect((await budget(id))?.usedCredits).toBe(4);
    });

    it('reuses it across runs while the outcome is still open', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = 'checking';
      expect((await agentGenerate(token(id), 'a pixel slime')).status).toBe(202);
      await reachedCloud(1);
      expect((await agentGenerate(token(id), 'a pixel slime')).status).toBe(202);
      await reachedCloud(2);
      expect(cloud.submits[1]!.idempotencyKey).toBe(cloud.submits[0]!.idempotencyKey);
      expect(cloud.charged).toBe(4);
      expect((await budget(id))?.usedCredits).toBe(4);
    });

    it('takes a fresh request and a fresh quote once the first attempt was released', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const bearer = token(id);
      cloud.outcome = 'failed';
      await finished(await agentGenerate(bearer, 'a pixel slime'));
      cloud.outcome = 'succeeded';
      const task = await finished(await agentGenerate(bearer, 'a pixel slime'));
      expect(task.status).toBe('done');
      expect(cloud.quotes).toHaveLength(2);
      expect(cloud.submits[1]!.idempotencyKey).not.toBe(cloud.submits[0]!.idempotencyKey);
      expect(cloud.charged).toBe(4);
      expect((await budget(id))?.usedCredits).toBe(4);
    });

    it('returns the same paid image for a repeat in the same run, and charges a new run for a new one', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const bearer = token(id);
      await finished(await agentGenerate(bearer, 'a pixel slime'));
      await finished(await agentGenerate(bearer, 'a pixel slime'));
      expect(cloud.charged).toBe(4);
      expect((await budget(id))?.usedCredits).toBe(4);
      await finished(await agentGenerate(token(id), 'a pixel slime'));
      expect(cloud.charged).toBe(8);
      expect((await budget(id))?.usedCredits).toBe(8);
    });

    it('sends one charge for two identical requests in flight together', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const bearer = token(id);
      let open!: () => void;
      cloud.quoteGate = new Promise<void>(resolve => { open = resolve; });
      const both = Promise.all([agentGenerate(bearer, 'a pixel slime'), agentGenerate(bearer, 'a pixel slime')]);
      await vi.waitFor(() => expect(cloud.quotes).toHaveLength(2), { timeout: 5000, interval: 2 });
      open();
      for (const response of await both) await finished(response);
      expect(cloud.charged).toBe(4);
      expect((await budget(id))?.usedCredits).toBe(4);
    });
  });

  describe('the ledger is durable', () => {
    it('survives re-opening the database, a leftover reservation included', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      await finished(await agentGenerate(token(id), 'made'));
      const left = new ArtBudgetLedger(db).reserve({ projectId: id, runId: 'crashed', fingerprint: 'crash', quoteId: randomUUID(), service: 'openpixo-image', credits: 7, requestId: `artbudget-${randomUUID()}` });
      expect(left.ok).toBe(true);
      await harness.stop();
      closeDatabase();
      db = openDatabase(root, { dataDir: path.join(root, 'data') });
      tasks = createMediaTaskStore(db, { isRunActive: () => true });
      harness = await start();
      expect(harness.ledger.read(id)).toMatchObject({ limitCredits: 100, spentCredits: 4, reservedCredits: 7, usedCredits: 11, remainingCredits: 89 });
    });

    it('is not held in project metadata, so a stale metadata write cannot reset it', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const stale = getProject(db, id)!.metadata!;
      await finished(await agentGenerate(token(id)));
      updateProject(db, id, { metadata: stale });
      expect(JSON.stringify(getProject(db, id)!.metadata)).not.toContain('100');
      expect((await budget(id))?.usedCredits).toBe(4);
    });

    it('settles a job after a restart when the cloud finally answers', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      cloud.outcome = 'checking';
      expect((await agentGenerate(token(id), 'still checking')).status).toBe(202);
      await reachedCloud(1);
      await vi.waitFor(() => {
        expect(db.prepare(`SELECT COUNT(*) AS n FROM openpixo_cloud_jobs WHERE project_id = ? AND state = 'pending'`).get(id)).toEqual({ n: 1 });
      }, { timeout: 5000, interval: 2 });
      await harness.stop();
      closeDatabase();
      db = openDatabase(root, { dataDir: path.join(root, 'data') });
      tasks = createMediaTaskStore(db, { isRunActive: () => true });
      harness = await start();
      expect(harness.ledger.read(id)?.usedCredits).toBe(4);
      cloud.settle(cloud.lastJob(), 'failed');
      harness.hosted.resumePending();
      await vi.waitFor(() => expect(harness.ledger.read(id)?.usedCredits).toBe(0), { timeout: 5000, interval: 2 });
    });
  });

  describe('only the user sets a budget', () => {
    it('refuses an agent token setting or raising it, and through plan approval', async () => {
      const id = project();
      const bearer = { Authorization: `Bearer ${token(id)}` };
      expect((await setBudget(id, 100)).status).toBe(200);
      const raise = await setBudget(id, 1000, bearer);
      expect(raise.status).toBe(403);
      const pending = planning();
      const approve = await post(`/api/projects/${pending}/game-plan/approve`, { artBudgetCredits: 500 }, { Authorization: `Bearer ${token(pending)}` });
      expect(approve.status).toBe(403);
      expect((await budget(id))?.limitCredits).toBe(100);
      expect(await budget(pending)).toBeNull();
    });

    it('refuses a token-less request from a foreign origin', async () => {
      const id = project();
      expect((await setBudget(id, 100, { Origin: 'http://evil.example' })).status).toBe(403);
      expect(await budget(id)).toBeNull();
    });

    it('answers RUN_ACTIVE to a token-less call during a run, which is the agent\'s shell', async () => {
      const id = project();
      expect((await setBudget(id, 10)).status).toBe(200);
      busy.add(id);
      const during = await setBudget(id, 1000);
      expect(during.status).toBe(409);
      expect((await errorOf(during)).code).toBe('RUN_ACTIVE');
      expect((await budget(id))?.limitCredits).toBe(10);
      busy.delete(id);
      expect((await setBudget(id, 1000)).status).toBe(200);
    });

    it('answers RUN_ACTIVE to an approval carrying a budget during a run', async () => {
      const id = planning();
      busy.add(id);
      const during = await post(`/api/projects/${id}/game-plan/approve`, { artBudgetCredits: 100 });
      expect(during.status).toBe(409);
      expect((await errorOf(during)).code).toBe('RUN_ACTIVE');
      expect(await budget(id)).toBeNull();
      expect(getProject(db, id)!.metadata?.gamePlan?.status).toBe('planning');
    });

    it('sets the budget together with the approval', async () => {
      const id = planning();
      const response = await post(`/api/projects/${id}/game-plan/approve`, { artBudgetCredits: 80 });
      expect(response.status).toBe(200);
      expect((await response.json() as ApproveGamePlanResponse).plan.status).toBe('approved');
      expect((await budget(id))?.limitCredits).toBe(80);
      // A budget set this way asks before spending, like every project, until the user says otherwise.
      expect((await state(id)).mode).toBe('ask');
      expect((await errorOf(await agentGenerate(token(id)))).code).toBe('ART_APPROVAL_REQUIRED');
      expect((await post(`/api/projects/${id}/art-budget`, { mode: 'auto' })).status).toBe(200);
      expect((await budget(id))?.limitCredits).toBe(80);
      await finished(await agentGenerate(token(id)));
      expect((await budget(id))?.usedCredits).toBe(4);
    });

    it('can change the budget of an approved plan through the approval route too', async () => {
      const id = project();
      expect((await post(`/api/projects/${id}/game-plan/approve`, { artBudgetCredits: 20 })).status).toBe(200);
      expect((await budget(id))?.limitCredits).toBe(20);
    });

    it('leaves plan approval as it was when no budget is sent', async () => {
      const id = planning();
      expect((await post(`/api/projects/${id}/game-plan/approve`)).status).toBe(200);
      expect(await budget(id)).toBeNull();
    });

    it('rejects anything that is not a whole number of credits', async () => {
      const id = project();
      for (const credits of [-1, 1.5, '50', null, 2_000_000]) {
        expect((await post(`/api/projects/${id}/art-budget`, { credits })).status, String(credits)).toBe(400);
      }
      expect((await post(`/api/projects/${planning()}/game-plan/approve`, { artBudgetCredits: -5 })).status).toBe(400);
      expect(await budget(id)).toBeNull();
    });

    it('caps the budget at what the account can pay, counting what it already spent', async () => {
      const id = project();
      cloud.available = 50;
      const over = await setBudget(id, 51);
      expect(over.status).toBe(400);
      expect((await errorOf(over)).code).toBe('ART_BUDGET_OVER_BALANCE');
      expect((await setBudget(id, 50)).status).toBe(200);
      await finished(await agentGenerate(token(id)));
      cloud.available = 46;
      expect((await setBudget(id, 51)).status).toBe(400);
      expect((await setBudget(id, 50)).status).toBe(200);
    });

    it('needs a signed-in account to raise a budget, but never to lower or clear it', async () => {
      const id = project();
      expect((await setBudget(id, 20)).status).toBe(200);
      signedIn = false;
      const raise = await setBudget(id, 30);
      expect(raise.status).toBe(401);
      expect((await setBudget(id, 10)).status).toBe(200);
      expect((await setBudget(id, 0)).status).toBe(200);
      expect((await budget(id))?.limitCredits).toBe(0);
    });
  });

  describe('reading a budget', () => {
    it('tells the user\'s surfaces what the control needs', async () => {
      const id = project();
      cloud.available = 240;
      const state = await (await fetch(`${harness.base}/api/projects/${id}/art-budget`)).json() as ArtBudgetResponse;
      expect(state).toMatchObject({ budget: null, runActive: false, ownImageTool: false, suggestedCredits: 100,
        account: { signedIn: true, availableCredits: 240, maxCredits: 240, imageCredits: 4 } });
    });

    it('suggests 0 when an own image tool is connected, since those cost nothing extra', async () => {
      ownImageTool = true;
      const state = await (await fetch(`${harness.base}/api/projects/${project()}/art-budget`)).json() as ArtBudgetResponse;
      expect(state).toMatchObject({ ownImageTool: true, suggestedCredits: 0 });
    });

    it('suggests no more than the balance', async () => {
      cloud.available = 30;
      const state = await (await fetch(`${harness.base}/api/projects/${project()}/art-budget`)).json() as ArtBudgetResponse;
      expect(state.suggestedCredits).toBe(30);
    });

    it('reports a signed-out account without calling it an error', async () => {
      signedIn = false;
      const response = await fetch(`${harness.base}/api/projects/${project()}/art-budget`);
      expect(response.status).toBe(200);
      expect(await response.json() as ArtBudgetResponse).toMatchObject({ account: { signedIn: false, availableCredits: null } });
    });

    it('lets an agent read its own project and no other', async () => {
      const mine = project();
      const theirs = project();
      expect((await setBudget(mine, 100)).status).toBe(200);
      const headers = { Authorization: `Bearer ${token(mine)}` };
      const own = await fetch(`${harness.base}/api/projects/${mine}/art-budget`, { headers });
      expect(own.status).toBe(200);
      const body = await own.json() as ArtBudgetResponse;
      expect(body.budget?.limitCredits).toBe(100);
      expect(body.account).toBeUndefined();
      expect((await fetch(`${harness.base}/api/projects/${theirs}/art-budget`, { headers })).status).toBe(403);
    });
  });

  describe('the daemon prices the request, the agent supplies nothing about money', () => {
    it('ignores a quote, a price and a request id in an agent\'s body', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const forged = { quoteId: randomUUID(), cloudRequestId: 'agent-chosen-request', credits: 1, price: 1, style: 'free', hosted: { quoteId: 'x' } };
      await finished(await agentGenerate(token(id), 'a pixel slime', forged));
      expect(cloud.quotes).toHaveLength(1);
      expect(cloud.submits[0]!.quoteId).not.toBe(forged.quoteId);
      expect(cloud.submits[0]!.idempotencyKey).not.toBe(forged.cloudRequestId);
      expect(cloud.submits[0]!.params).not.toHaveProperty('style');
      expect((await budget(id))?.usedCredits).toBe(4);
    });

    it('generates exactly what it priced: style, aspect and references', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const dir = path.join(projectsDir(), id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'ref.png'), PNG);
      styleForTest.current = { id: 'ink', prompt: 'Carved ink shapes', negativePrompt: 'photography', constraints: {} };
      const task = await finished(await post('/api/tools/media/generate', {
        surface: 'image', model: 'openpixo-image-edit', prompt: 'a knight', output: 'knight.png', aspect: '3:2', image: 'ref.png', images: ['ref.png'],
      }, { Authorization: `Bearer ${token(id)}` }));
      expect(task.status).toBe('done');
      expect(cloud.quotes).toHaveLength(1);
      expect(cloud.submits[0]!.service).toBe(cloud.quotes[0]!.service);
      expect(cloud.submits[0]!.params).toEqual(cloud.quotes[0]!.params);
      expect(cloud.quotes[0]!.params).toMatchObject({ aspect: '3:2', references: [PNG_SHA] });
      expect(cloud.quotes[0]!.params.prompt).toContain('a knight');
      expect(cloud.quotes[0]!.params.prompt).toContain('Carved ink shapes');
    });

    it('sends an agent\'s openpixo-image with a style reference to the service that takes references', async () => {
      // 2026-11-11 skill test: the agent's image model list shows only openpixo-image, so a
      // weak model passes the style reference there. It has to reach the cloud, not be lost.
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const dir = path.join(projectsDir(), id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'style.png'), PNG);
      const task = await finished(await agentGenerate(token(id), 'a slime that matches the game', { images: ['style.png'], output: 'slime.png' }));
      expect(task.status).toBe('done');
      expect(cloud.quotes[0]).toMatchObject({ service: 'openpixo-image-edit', params: { references: [PNG_SHA] } });
      expect(cloud.submits[0]!.service).toBe('openpixo-image-edit');
      expect((task.file as { warnings?: string[] }).warnings?.join(' ')).toContain('openpixo-image-edit');
    });

    it('makes an agent choose between the style reference and --no-reference, and never attaches it', async () => {
      // Owner decision 2026-11-11: the agent decides, so art meant to look different stays free,
      // but it has to say which. A note on the result alone was ignored by a real weak model.
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      updateProject(db, id, { metadata: { ...getProject(db, id)!.metadata, styleReference: 'concept/style-2.png' } });
      const refused = await agentGenerate(token(id), 'a slime');
      expect(refused.status).toBe(400);
      const error = await errorOf(refused);
      expect(error.code).toBe('STYLE_REFERENCE_CHOICE_REQUIRED');
      expect(error.message).toContain('--image concept/style-2.png');
      expect(error.message).toContain('--no-reference');
      expect(cloud.quotes).toHaveLength(0);
      expect((await budget(id))?.usedCredits).toBe(0);

      const different = await finished(await agentGenerate(token(id), 'a night sky background', { noReference: true }));
      expect(different.status).toBe('done');
      expect(cloud.quotes[0]!.service).toBe('openpixo-image');
      expect(cloud.quotes[0]!.params).not.toHaveProperty('references');

      const dir = path.join(projectsDir(), id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'other.png'), PNG);
      const matched = await finished(await agentGenerate(token(id), 'a slime', { images: ['other.png'] }));
      expect(matched.status).toBe('done');
      expect(cloud.quotes[1]!.service).toBe('openpixo-image-edit');
    });

    it('lets an agent image without --image through in a game with no style reference', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      expect((await finished(await agentGenerate(token(id), 'a slime'))).status).toBe('done');
    });

    it('sends an agent\'s openpixo-image-edit with no reference to the text-to-image service', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentGenerate(token(id), 'a slime', { model: 'openpixo-image-edit' }));
      expect(task.status).toBe('done');
      expect(cloud.quotes[0]!.service).toBe('openpixo-image');
      expect(cloud.quotes[0]!.params).not.toHaveProperty('references');
    });

    it('asks for an aspect the service can render, and the final size stays local', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentGenerate(token(id), 'a wide background', { aspect: '16:9' }));
      expect(task.status).toBe('done');
      expect(cloud.quotes[0]!.params.aspect).toBe('3:2');
      expect(cloud.submits[0]!.params).toEqual(cloud.quotes[0]!.params);
      expect((task.file as { warnings?: string[] }).warnings?.join(' ')).toContain('16:9');
    });

    it('prices the backdrop instruction a transparent request needs, so a cutout can work', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      await finished(await agentGenerate(token(id), 'a gold coin', { background: 'transparent' })).catch(() => null);
      expect(cloud.quotes[0]!.params.prompt).toContain('a gold coin');
      expect(cloud.quotes[0]!.params.prompt).toContain('flat, uniform');
      expect(cloud.submits[0]!.params).toEqual(cloud.quotes[0]!.params);
    });

    it('validates reference images against the project, before anything is priced', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      for (const image of ['../outside.png', path.join(tmpdir(), 'elsewhere.png'), 'missing.png']) {
        const response = await post('/api/tools/media/generate', { surface: 'image', model: 'openpixo-image-edit', prompt: 'x', output: 'x.png', image },
          { Authorization: `Bearer ${token(id)}` });
        expect(response.status, image).toBe(400);
        expect((await errorOf(response)).code).toBe('GENERATION_PARAMS_INVALID');
      }
      expect(cloud.quotes).toHaveLength(0);
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('reports cloud trouble while pricing as itself, with nothing reserved', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      signedIn = false;
      const original = cloud.api.generationQuote;
      cloud.api.generationQuote = async () => { throw new AccountError('ACCOUNT_SIGNED_OUT'); };
      const response = await agentGenerate(token(id));
      cloud.api.generationQuote = original;
      expect(response.status).toBe(401);
      expect((await errorOf(response)).code).toBe('ACCOUNT_SIGNED_OUT');
      expect((await budget(id))?.usedCredits).toBe(0);
    });
  });

  describe('hosted audio', () => {
    const agentAudio = (bearer: string, model: string, prompt: string, extra: Record<string, unknown> = {}) =>
      post('/api/tools/media/generate', { surface: 'audio', model, prompt, output: `audio/${randomUUID()}.mp3`, ...extra }, { Authorization: `Bearer ${bearer}` });

    it('spends through the ledger like an image, and writes the MP3', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentAudio(token(id), 'openpixo-sfx', 'a short coin pickup', { output: 'audio/coin.mp3', duration: 3 }));
      expect(task.status).toBe('done');
      expect(task.file).toMatchObject({ name: 'audio/coin.mp3', surface: 'audio', kind: 'audio', mime: 'audio/mpeg' });
      await expect(readFile(path.join(projectsDir(), id, 'audio', 'coin.mp3'))).resolves.toEqual(MP3);
      expect(cloud.quotes).toEqual([{ service: 'openpixo-sfx', params: { prompt: 'a short coin pickup', duration: 3 } }]);
      expect(cloud.submits[0]!.params).toEqual({ prompt: 'a short coin pickup', duration: 3 });
      expect(await budget(id)).toMatchObject({ usedCredits: 4, spentCredits: 4, reservedCredits: 0 });
    });

    it('is refused with no budget, and asks nothing of the cloud', async () => {
      const response = await agentAudio(token(project()), 'openpixo-music', 'light 8-bit village music');
      expect(response.status).toBe(403);
      const error = await errorOf(response);
      expect(error.code).toBe('GENERATION_CONFIRMATION_REQUIRED');
      expect(error.message).toContain('This audio would spend credits');
      expect(error.message).not.toMatch(/image/i);
      expect(cloud.quotes).toHaveLength(0);
    });

    it('is refused when the budget cannot pay, and does not call it an image', async () => {
      const id = project();
      expect((await setBudget(id, 3)).status).toBe(200);
      const response = await agentAudio(token(id), 'openpixo-voice', 'Welcome back.');
      expect(response.status).toBe(409);
      const error = await errorOf(response);
      expect(error.code).toBe('ART_BUDGET_EXHAUSTED');
      expect(error.message).toContain('This audio costs 4');
      expect(cloud.submits).toHaveLength(0);
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('lets only one of two concurrent requests through a budget that covers one', async () => {
      const id = project();
      expect((await setBudget(id, 4)).status).toBe(200);
      const bearer = token(id);
      let open!: () => void;
      cloud.quoteGate = new Promise<void>(resolve => { open = resolve; });
      const both = Promise.all([agentAudio(bearer, 'openpixo-sfx', 'coin'), agentAudio(bearer, 'openpixo-sfx', 'door')]);
      await vi.waitFor(() => expect(cloud.quotes).toHaveLength(2), { timeout: 5000, interval: 2 });
      open();
      const responses = await both;
      expect(responses.map(response => response.status).sort()).toEqual([202, 409]);
      await finished(responses.find(response => response.status === 202)!);
      expect(cloud.charged).toBe(4);
    });

    it('sends the voice as the service\'s style, and never an aspect', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      await finished(await agentAudio(token(id), 'openpixo-voice', 'Welcome back.', { voice: 'Aria', aspect: '1:1' }));
      expect(cloud.quotes[0]!.params).toEqual({ prompt: 'Welcome back.', style: 'Aria' });
      expect(cloud.submits[0]!.params).toEqual({ prompt: 'Welcome back.', style: 'Aria' });
    });

    it('leaves out what the cloud would refuse on this service, and says so', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const bearer = token(id);
      const music = await finished(await agentAudio(bearer, 'openpixo-music', 'light 8-bit village music', { duration: 30, voice: 'Aria' }));
      expect(cloud.submits.at(-1)!.params).toEqual({ prompt: 'light 8-bit village music' });
      expect((music.file as { warnings: string[] }).warnings.join(' ')).toMatch(/duration ignored.*voice ignored|voice ignored.*duration ignored/u);
      await finished(await agentAudio(bearer, 'openpixo-voice', 'Welcome back.', { duration: 5 }));
      expect(cloud.submits.at(-1)!.params).toEqual({ prompt: 'Welcome back.' });
      await finished(await agentAudio(bearer, 'openpixo-sfx', 'a coin', { voice: 'Aria' }));
      expect(cloud.submits.at(-1)!.params).toEqual({ prompt: 'a coin' });
    });

    it('holds a sound effect to the length the service offers', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentAudio(token(id), 'openpixo-sfx', 'a long rumble', { duration: 60 }));
      expect(cloud.quotes[0]!.params.duration).toBe(10);
      expect((task.file as { warnings: string[] }).warnings.join(' ')).toContain('rendered as 10 s');
    });

    it('prices a different voice or length as a different request', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const bearer = token(id);
      await finished(await agentAudio(bearer, 'openpixo-voice', 'Welcome back.', { voice: 'Aria', output: 'audio/a.mp3' }));
      await finished(await agentAudio(bearer, 'openpixo-voice', 'Welcome back.', { voice: 'Rachel', output: 'audio/b.mp3' }));
      expect(new Set(cloud.submits.map(submit => submit.idempotencyKey)).size).toBe(2);
      expect(cloud.charged).toBe(8);
    });

    it('refuses what it can tell is wrong before pricing, and names the fix', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const bearer = token(id);
      const unknown = await agentAudio(bearer, 'openpixo-voice', 'Welcome back.', { voice: 'Nobody' });
      expect(unknown.status).toBe(400);
      expect((await errorOf(unknown)).message).toContain('Rachel, Aria');
      const short = await agentAudio(bearer, 'openpixo-music', 'too short');
      expect((await errorOf(short)).message).toContain('at least 10');
      const long = await agentAudio(bearer, 'openpixo-voice', 'x'.repeat(301));
      expect((await errorOf(long)).message).toContain('at most 300');
      const referenced = await agentAudio(bearer, 'openpixo-sfx', 'a coin', { image: 'ref.png' });
      expect((await errorOf(referenced)).message).toContain('no reference images');
      const crossed = await agentAudio(bearer, 'openpixo-image', 'a coin');
      expect((await errorOf(crossed)).code).toBe('GENERATION_PARAMS_INVALID');
      const imageSurface = await post('/api/tools/media/generate', { surface: 'image', model: 'openpixo-sfx', prompt: 'a coin', output: 'a.png' }, { Authorization: `Bearer ${bearer}` });
      expect((await errorOf(imageSurface)).code).toBe('GENERATION_PARAMS_INVALID');
      expect(cloud.quotes).toHaveLength(0);
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('still waits for the plan, like every paid request', async () => {
      const id = planning();
      expect((await setBudget(id, 100)).status).toBe(200);
      const response = await agentAudio(token(id), 'openpixo-sfx', 'a coin');
      expect(response.status).toBe(409);
      // The plan gate refuses non-image media before the budget is even read.
      expect((await errorOf(response)).code).toBe('GAME_PLAN_NOT_APPROVED');
      expect(cloud.quotes).toHaveLength(0);
    });

    it('quotes a user\'s request as it will be sent, without an aspect or a stray option', async () => {
      const id = project();
      const quote = async (body: Record<string, unknown>) => {
        const response = await post(`/api/projects/${id}/media/openpixo-quote`, body);
        expect(response.status, await response.clone().text()).toBe(200);
        return cloud.quotes.at(-1)!.params;
      };
      expect(await quote({ service: 'openpixo-sfx', prompt: 'a coin', aspect: '1:1', duration: 3, voice: 'Aria', images: [] })).toEqual({ prompt: 'a coin', duration: 3 });
      expect(await quote({ service: 'openpixo-voice', prompt: 'Hello there', voice: 'Aria', duration: 3 })).toEqual({ prompt: 'Hello there', style: 'Aria' });
      expect(await quote({ service: 'openpixo-voice', prompt: 'Hello there', style: 'Rachel' })).toEqual({ prompt: 'Hello there', style: 'Rachel' });
      expect(await quote({ service: 'openpixo-music', prompt: 'light village music', style: 'x', duration: 9 })).toEqual({ prompt: 'light village music' });
      const refused = await post(`/api/projects/${id}/media/openpixo-quote`, { service: 'openpixo-sfx', prompt: 'a coin', images: ['ref.png'] });
      expect(refused.status).toBe(400);
    });

    it('sends a user\'s confirmed request exactly as quoted, with no budget involved', async () => {
      const id = project();
      const confirm = { surface: 'audio', prompt: 'a coin', quoteId: randomUUID(), cloudRequestId: `studio-${randomUUID()}` };
      const sfx = await finished(await post(`/api/projects/${id}/media/generate`, { ...confirm, model: 'openpixo-sfx', output: 'audio/coin.mp3', duration: 3, aspect: '1:1' }));
      expect(sfx.file).toMatchObject({ name: 'audio/coin.mp3', surface: 'audio' });
      expect(cloud.submits.at(-1)!.params).toEqual({ prompt: 'a coin', duration: 3 });
      await finished(await post(`/api/projects/${id}/media/generate`, { ...confirm, model: 'openpixo-voice', cloudRequestId: `studio-${randomUUID()}`, output: 'audio/a.mp3', style: 'Aria' }));
      expect(cloud.submits.at(-1)!.params).toEqual({ prompt: 'a coin', style: 'Aria' });
      await finished(await post(`/api/projects/${id}/media/generate`, { ...confirm, model: 'openpixo-voice', cloudRequestId: `studio-${randomUUID()}`, output: 'audio/b.mp3', voice: 'Rachel' }));
      expect(cloud.submits.at(-1)!.params).toEqual({ prompt: 'a coin', style: 'Rachel' });
      await finished(await post(`/api/projects/${id}/media/generate`, { ...confirm, model: 'openpixo-music', cloudRequestId: `studio-${randomUUID()}`, output: 'audio/m.mp3', audioKind: 'sfx' }));
      expect(cloud.submits.at(-1)!.params).toEqual({ prompt: 'a coin' });
      expect(cloud.quotes).toHaveLength(0);
      expect(await budget(id)).toBeNull();
    });
  });

  describe('hosted audio by direct delivery', () => {
    const agentAudio = (bearer: string, model: string, prompt: string, extra: Record<string, unknown> = {}) =>
      post('/api/tools/media/generate', { surface: 'audio', model, prompt, ...extra }, { Authorization: `Bearer ${bearer}` });

    for (const [model, prompt, extra] of [
      ['openpixo-sfx', 'a short coin pickup', { duration: 3 }],
      ['openpixo-voice', 'Welcome back, traveler.', { voice: 'Aria' }],
      ['openpixo-music', 'light 8-bit village music', {}],
    ] as const) {
      it(`${model}: an agent's request with no hash is saved as an MP3, and the link goes no further`, async () => {
        cloud.direct = true;
        const id = project();
        expect((await setBudget(id, 100)).status).toBe(200);
        // The output's own extension is wrong on purpose: the file's bytes decide it.
        const task = await finished(await agentAudio(token(id), model, prompt, { ...extra, output: 'audio/made.wav' }));
        expect(task.status, JSON.stringify(task.error)).toBe('done');
        expect(cloud.lastJob().artifact).toMatchObject({ mime: 'audio/mpeg', sha256: null });
        expect(task.file).toMatchObject({ name: 'audio/made.mp3', surface: 'audio', kind: 'audio', mime: 'audio/mpeg' });
        await expect(readFile(path.join(projectsDir(), id, 'audio', 'made.mp3'))).resolves.toEqual(MP3);
        expect(await budget(id)).toMatchObject({ spentCredits: 4, reservedCredits: 0 });
        expect(JSON.stringify(task)).not.toContain('media.example');
      });

      it(`${model}: a user's confirmed request with no hash is saved the same way`, async () => {
        cloud.direct = true;
        const id = project();
        const task = await finished(await post(`/api/projects/${id}/media/generate`, { surface: 'audio', model, prompt, ...extra, output: 'audio/mine.mp3',
          quoteId: randomUUID(), cloudRequestId: `studio-${randomUUID()}` }));
        expect(task.status, JSON.stringify(task.error)).toBe('done');
        expect(task.file).toMatchObject({ name: 'audio/mine.mp3', surface: 'audio' });
      });
    }

    it('refuses a direct file that is not an MP3: the charge stands and nothing is resubmitted', async () => {
      cloud.direct = true;
      // Right size, wrong file: a WAV where the job says MP3.
      cloud.served = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVE', 'latin1'), Buffer.alloc(MP3.length - 12, 1)]);
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentAudio(token(id), 'openpixo-sfx', 'a short coin pickup', { output: 'audio/coin.mp3' }));
      expect(task.status).toBe('failed');
      expect(task.error).toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', message: expect.stringContaining('file') });
      expect(task.error?.message).not.toMatch(/image/iu);
      expect(cloud.submits).toHaveLength(1);
      expect(cloud.charged).toBe(4);
      expect(await budget(id)).toMatchObject({ spentCredits: 4, reservedCredits: 0, usedCredits: 4 });
      await expect(readFile(path.join(projectsDir(), id, 'audio', 'coin.mp3'))).rejects.toThrow();
    });
  });

  describe('hosted 3D', () => {
    const agentModel = (bearer: string, extra: Record<string, unknown> = {}) =>
      post('/api/tools/media/generate', { surface: 'model3d', model: 'openpixo-model3d', image: 'art/chest.png', output: 'models/chest.glb', ...extra }, { Authorization: `Bearer ${bearer}` });
    const withPicture = async () => {
      const id = project();
      await mkdir(path.join(projectsDir(), id, 'art'), { recursive: true });
      await writeFile(path.join(projectsDir(), id, 'art', 'chest.png'), PNG);
      return id;
    };

    it('spends through the ledger, priced from the picture alone, whatever the agent typed', async () => {
      cloud.direct = true;
      const id = await withPicture();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentModel(token(id), { prompt: 'make it huge', aspect: '16:9' }));
      expect(task.file).toMatchObject({ name: 'models/chest.glb', surface: 'model3d', kind: 'model3d' });
      await expect(readFile(path.join(projectsDir(), id, 'models', 'chest.glb'))).resolves.toEqual(GLB);
      expect(cloud.quotes).toEqual([{ service: 'openpixo-model3d', params: { prompt: OPENPIXO_MODEL3D_PROMPT, references: [PNG_SHA] } }]);
      expect(cloud.submits[0]!.params).toEqual({ prompt: OPENPIXO_MODEL3D_PROMPT, references: [PNG_SHA] });
      expect(await budget(id)).toMatchObject({ usedCredits: 4, spentCredits: 4, reservedCredits: 0 });
    });

    it('spends the budget on another quality tier the same way', async () => {
      const id = await withPicture();
      expect((await setBudget(id, 100)).status).toBe(200);
      const task = await finished(await agentModel(token(id), { model: 'openpixo-model3d-high', prompt: 'make it huge' }));
      expect(task.file).toMatchObject({ name: 'models/chest.glb', surface: 'model3d', kind: 'model3d' });
      expect(cloud.quotes).toEqual([{ service: 'openpixo-model3d-high', params: { prompt: OPENPIXO_MODEL3D_PROMPT, references: [PNG_SHA] } }]);
      expect(await budget(id)).toMatchObject({ usedCredits: 4, spentCredits: 4, reservedCredits: 0 });
    });

    it('is refused with no budget, and does not call it an image', async () => {
      const response = await agentModel(token(await withPicture()));
      expect(response.status).toBe(403);
      const error = await errorOf(response);
      expect(error.message).toContain('This 3D model would spend credits');
      expect(error.message).not.toMatch(/image/iu);
      expect(cloud.quotes).toHaveLength(0);
    });

    it('stops at the limit, and only the budget decides', async () => {
      const id = await withPicture();
      expect((await setBudget(id, 3)).status).toBe(200);
      const response = await agentModel(token(id));
      expect(response.status).toBe(409);
      expect((await errorOf(response)).message).toContain('This 3D model costs 4');
      expect(cloud.submits).toHaveLength(0);
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('never charges twice for a repeat of a request still open', async () => {
      cloud.outcome = 'checking';
      const id = await withPicture();
      expect((await setBudget(id, 100)).status).toBe(200);
      const bearer = token(id, 'run-3d');
      expect((await agentModel(bearer)).status).toBe(202);
      await reachedCloud(1);
      expect((await agentModel(bearer)).status).toBe(202);
      await reachedCloud(2);
      expect(new Set(cloud.submits.map(submit => submit.idempotencyKey)).size).toBe(1);
      expect(cloud.charged).toBe(4);
    });

    it('refuses a surface the model does not make, before anything is priced', async () => {
      const id = await withPicture();
      expect((await setBudget(id, 100)).status).toBe(200);
      const bearer = token(id);
      for (const body of [
        { surface: 'image', model: 'openpixo-model3d', prompt: 'a chest', output: 'a.png' },
        { surface: 'model3d', model: 'openpixo-image', image: 'art/chest.png', output: 'a.glb' },
        { surface: 'audio', model: 'openpixo-model3d', prompt: 'a chest', output: 'a.mp3' },
      ]) {
        const response = await post('/api/tools/media/generate', body, { Authorization: `Bearer ${bearer}` });
        expect((await errorOf(response)).code).toBe('GENERATION_PARAMS_INVALID');
      }
      expect(cloud.quotes).toHaveLength(0);
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('takes a user\'s confirmed request with its picture, at the fixed prompt it was quoted at', async () => {
      const id = await withPicture();
      const quoted = await post(`/api/projects/${id}/media/openpixo-quote`, { service: 'openpixo-model3d', prompt: 'ignored', images: ['art/chest.png'] });
      expect(quoted.status, await quoted.clone().text()).toBe(200);
      expect(cloud.quotes.at(-1)!.params).toEqual({ prompt: OPENPIXO_MODEL3D_PROMPT, references: [PNG_SHA] });
      const task = await finished(await post(`/api/projects/${id}/media/generate`, { surface: 'model3d', model: 'openpixo-model3d', images: ['art/chest.png'], output: 'models/mine.glb',
        quoteId: randomUUID(), cloudRequestId: `studio-${randomUUID()}` }));
      expect(task.file).toMatchObject({ name: 'models/mine.glb', surface: 'model3d' });
      expect(cloud.submits.at(-1)!.params).toEqual(cloud.quotes.at(-1)!.params);
      expect(await budget(id)).toBeNull();
    });
  });

  describe('the user\'s own paths do not change', () => {
    const confirmed =(extra: Record<string, unknown> = {}) => ({ surface: 'image', model: 'openpixo-image', prompt: 'a pixel slime', aspect: '1:1',
      output: 'sprites/mine.png', quoteId: randomUUID(), cloudRequestId: `studio-${randomUUID()}`, ...extra });

    it('spends a user-confirmed quote without touching any budget', async () => {
      const id = project();
      expect((await setBudget(id, 10)).status).toBe(200);
      const body = confirmed();
      const task = await finished(await post(`/api/projects/${id}/media/generate`, body));
      expect(task.status).toBe('done');
      expect(cloud.quotes).toHaveLength(0);
      expect(cloud.submits[0]).toMatchObject({ quoteId: body.quoteId, idempotencyKey: body.cloudRequestId });
      expect(await budget(id)).toMatchObject({ limitCredits: 10, usedCredits: 0 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM project_art_budget_charges WHERE project_id = ?').get(id)).toEqual({ n: 0 });
    });

    it('works with no budget at all and while the plan is pending, as it does today', async () => {
      const task = await finished(await post(`/api/projects/${planning()}/media/generate`, confirmed()));
      expect(task.status).toBe('done');
    });

    // The known gap, pinned so it stays visible: this path cannot tell the user from a
    // shell. No token, no Origin and a loopback peer is all it asks, and an agent's
    // shell can send that during a run. Reported to the owner, not changed here.
    it('known gap: a token-less local call spends outside the budget, even during a run', async () => {
      const id = project();
      expect((await setBudget(id, 4)).status).toBe(200);
      busy.add(id);
      const body = confirmed();
      const shell = await fetch(`${harness.base}/api/projects/${id}/media/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      expect((await finished(shell)).status).toBe('done');
      expect(cloud.charged).toBe(4);
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('still needs a quote from the user', async () => {
      const id = project();
      const response = await post(`/api/projects/${id}/media/generate`, confirmed({ quoteId: undefined }));
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('GENERATION_CONFIRMATION_REQUIRED');
    });

    it('still refuses an agent\'s token on the quote route', async () => {
      const id = project();
      const response = await post(`/api/projects/${id}/media/openpixo-quote`, { service: 'openpixo-image', prompt: 'x' }, { Authorization: `Bearer ${token(id)}` });
      expect(response.status).toBe(403);
    });
  });

  // Owner decision 2026-11-11: a project asks before spending unless the user chose auto.
  describe('asking before spending', () => {
    const setLimit = (projectId: string, credits: number) => post(`/api/projects/${projectId}/art-budget`, { credits });

    it('is every project\'s mode, and without an approval the agent spends nothing and asks the cloud nothing', async () => {
      const id = project();
      expect((await setLimit(id, 100)).status).toBe(200);
      expect(await state(id)).toMatchObject({ mode: 'ask', approval: null });
      const response = await agentGenerate(token(id));
      expect(response.status).toBe(409);
      const error = await errorOf(response);
      expect(error.code).toBe('ART_APPROVAL_REQUIRED');
      expect(error.message).toContain('art card');
      expect(cloud.quotes).toHaveLength(0);
      expect((await budget(id))?.usedCredits).toBe(0);
    });

    it('pays one run from an approval, and no other run', async () => {
      const id = project();
      expect((await setLimit(id, 100)).status).toBe(200);
      const approved = await approveArt(id, 8);
      expect(approved.status).toBe(200);
      expect((await approved.json() as ArtBudgetResponse).approval).toMatchObject({ approvedCredits: 8, usedCredits: 0, remainingCredits: 8, runId: null });
      const first = token(id, 'run-a');
      expect((await finished(await agentGenerate(first, 'hero'))).status).toBe('done');
      expect((await state(id)).approval).toMatchObject({ runId: 'run-a', usedCredits: 4, remainingCredits: 4 });
      const quotes = cloud.quotes.length;
      const other = await agentGenerate(token(id, 'run-b'), 'slime');
      expect(other.status).toBe(409);
      const refusal = await errorOf(other);
      expect(refusal.code).toBe('ART_APPROVAL_REQUIRED');
      expect(refusal.message).toContain('earlier turn');
      expect(cloud.quotes).toHaveLength(quotes);
      expect((await finished(await agentGenerate(first, 'hero jump'))).status).toBe('done');
      const over = await agentGenerate(first, 'hero hurt');
      expect((await errorOf(over)).code).toBe('ART_APPROVAL_REQUIRED');
      expect(cloud.charged).toBe(8);
      expect(await budget(id)).toMatchObject({ usedCredits: 8, remainingCredits: 92 });
    });

    it('lets only one of two runs at once claim an approval', async () => {
      const id = project();
      expect((await setLimit(id, 100)).status).toBe(200);
      expect((await approveArt(id, 8)).status).toBe(200);
      let open!: () => void;
      cloud.quoteGate = new Promise<void>(resolve => { open = resolve; });
      const both = Promise.all([agentGenerate(token(id, 'run-a'), 'first'), agentGenerate(token(id, 'run-b'), 'second')]);
      await vi.waitFor(() => expect(cloud.quotes).toHaveLength(2), { timeout: 5000, interval: 2 });
      open();
      const responses = await both;
      expect(responses.map(response => response.status).sort()).toEqual([202, 409]);
      expect((await errorOf(responses.find(response => response.status === 409)!)).code).toBe('ART_APPROVAL_REQUIRED');
      await finished(responses.find(response => response.status === 202)!);
      expect(cloud.charged).toBe(4);
    });

    it('lets a new approval replace the old one, for the next run', async () => {
      const id = project();
      expect((await setLimit(id, 100)).status).toBe(200);
      expect((await approveArt(id, 4)).status).toBe(200);
      await finished(await agentGenerate(token(id, 'run-a'), 'first'));
      expect((await approveArt(id, 4)).status).toBe(200);
      expect((await state(id)).approval).toMatchObject({ approvedCredits: 4, runId: null, remainingCredits: 4 });
      expect((await finished(await agentGenerate(token(id, 'run-b'), 'second'))).status).toBe('done');
      expect((await budget(id))?.usedCredits).toBe(8);
    });

    it('gives a released charge back to the approval', async () => {
      const id = project();
      expect((await setLimit(id, 100)).status).toBe(200);
      expect((await approveArt(id, 4)).status).toBe(200);
      cloud.outcome = 'failed';
      const bearer = token(id, 'run-a');
      expect((await finished(await agentGenerate(bearer, 'first'))).status).toBe('failed');
      expect((await state(id)).approval).toMatchObject({ runId: 'run-a', usedCredits: 0, remainingCredits: 4 });
      cloud.outcome = 'succeeded';
      expect((await finished(await agentGenerate(bearer, 'first'))).status).toBe('done');
    });

    it('approves no more than the budget has left, and the budget stays the limit', async () => {
      const id = project();
      expect((await approveArt(id, 4)).status).toBe(409);
      expect((await setLimit(id, 10)).status).toBe(200);
      const over = await approveArt(id, 11);
      expect(over.status).toBe(409);
      const error = await errorOf(over);
      expect(error.code).toBe('ART_APPROVAL_OVER_BUDGET');
      expect(error.message).toContain('10 left');
      for (const credits of [0, -1, 1.5, '5', null]) expect((await post(`/api/projects/${id}/art-budget/approve`, { credits })).status, String(credits)).toBe(400);
      expect((await state(id)).approval).toBeNull();
      expect((await approveArt(id, 10)).status).toBe(200);
      // Lowered after the approval: the budget still decides.
      expect((await setLimit(id, 4)).status).toBe(200);
      const bearer = token(id);
      await finished(await agentGenerate(bearer, 'first'));
      expect((await errorOf(await agentGenerate(bearer, 'second'))).code).toBe('ART_BUDGET_EXHAUSTED');
      expect(cloud.charged).toBe(4);
    });

    it('needs no approval for planning\'s style samples', async () => {
      const id = planning();
      expect((await setLimit(id, 100)).status).toBe(200);
      expect((await state(id)).mode).toBe('ask');
      expect((await finished(await agentGenerate(token(id), 'style sample'))).status).toBe('done');
      expect((await state(id)).approval).toBeNull();
    });

    it('spends within the budget without an approval in auto, as before', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      expect(await state(id)).toMatchObject({ mode: 'auto', approval: null });
      expect((await finished(await agentGenerate(token(id)))).status).toBe('done');
    });

    it('keeps an unset budget unset when only the mode is chosen', async () => {
      const id = project();
      const response = await post(`/api/projects/${id}/art-budget`, { mode: 'auto' });
      expect(response.status).toBe(200);
      expect(await response.json() as ArtBudgetResponse).toMatchObject({ budget: null, mode: 'auto' });
      expect((await post(`/api/projects/${id}/art-budget`, { mode: 'yolo' })).status).toBe(400);
      expect((await post(`/api/projects/${id}/art-budget`, {})).status).toBe(400);
      expect((await state(id)).mode).toBe('auto');
    });

    it('lets only the user change the mode or approve, and never during a run', async () => {
      const id = project();
      expect((await setLimit(id, 100)).status).toBe(200);
      const bearer = { Authorization: `Bearer ${token(id)}` };
      expect((await post(`/api/projects/${id}/art-budget`, { mode: 'auto' }, bearer)).status).toBe(403);
      expect((await approveArt(id, 8, bearer)).status).toBe(403);
      expect((await post(`/api/projects/${id}/art-budget`, { mode: 'auto' }, { Origin: 'http://evil.example' })).status).toBe(403);
      expect((await approveArt(id, 8, { Origin: 'http://evil.example' })).status).toBe(403);
      busy.add(id);
      const mode = await post(`/api/projects/${id}/art-budget`, { mode: 'auto' });
      expect(mode.status).toBe(409);
      expect((await errorOf(mode)).code).toBe('RUN_ACTIVE');
      const approval = await approveArt(id, 8);
      expect(approval.status).toBe(409);
      expect((await errorOf(approval)).code).toBe('RUN_ACTIVE');
      busy.delete(id);
      expect(await state(id)).toMatchObject({ mode: 'ask', approval: null });
    });

    it('shows the mode and the approval to the user and to the agent', async () => {
      const id = project();
      expect((await setLimit(id, 100)).status).toBe(200);
      expect((await approveArt(id, 12)).status).toBe(200);
      expect(await state(id)).toMatchObject({ mode: 'ask', approval: { approvedCredits: 12, remainingCredits: 12, runId: null }, account: { signedIn: true } });
      const agent = await state(id, { Authorization: `Bearer ${token(id)}` });
      expect(agent).toMatchObject({ mode: 'ask', approval: { approvedCredits: 12 } });
      expect(agent.account).toBeUndefined();
    });
  });

  describe('the CLI', () => {
    async function cli(args: string[], env: Record<string, string> = {}) {
      const previous = { token: process.env.PIXO_TOOL_TOKEN, exit: process.exitCode };
      Object.assign(process.env, env);
      if (!env.PIXO_TOOL_TOKEN) delete process.env.PIXO_TOOL_TOKEN;
      const chunks: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { chunks.push(String(chunk)); return true; });
      process.exitCode = 0;
      try {
        await runGamePlanCli([...args, '--daemon-url', harness.base, '--json']);
        return { body: JSON.parse(chunks.join('')) as Record<string, any>, exitCode: process.exitCode };
      } finally {
        spy.mockRestore();
        process.exitCode = previous.exit;
        if (previous.token === undefined) delete process.env.PIXO_TOOL_TOKEN;
        else process.env.PIXO_TOOL_TOKEN = previous.token;
      }
    }

    it('approves with a budget, reads it and changes it as the user', async () => {
      const id = planning();
      const approved = await cli(['plan', 'approve', '--project', id, '--art-budget', '60']);
      expect(approved.body.plan.status).toBe('approved');
      expect((await cli(['plan', 'budget', '--project', id])).body.budget.limitCredits).toBe(60);
      expect((await cli(['plan', 'budget', '--project', id, '--credits', '90'])).body.budget.limitCredits).toBe(90);
      expect(GAME_PLAN_USAGE).toContain('--art-budget');
      expect(GAME_PLAN_USAGE).toContain('--credits');
    });

    it('sets the mode and approves art as the user, and refuses both under a tool token', async () => {
      const id = project();
      const set = await cli(['plan', 'budget', '--project', id, '--credits', '50', '--mode', 'auto']);
      expect(set.body).toMatchObject({ budget: { limitCredits: 50 }, mode: 'auto' });
      expect((await cli(['plan', 'budget', '--project', id, '--mode', 'ask'])).body.mode).toBe('ask');
      expect((await cli(['plan', 'approve-art', '--project', id, '--credits', '8'])).body.approval).toMatchObject({ approvedCredits: 8, runId: null });
      expect((await cli(['plan', 'budget', '--project', id, '--mode', 'sometimes'])).exitCode).toBe(1);
      expect((await cli(['plan', 'approve-art', '--project', id, '--credits', '0'])).exitCode).toBe(1);
      const env = { PIXO_TOOL_TOKEN: token(id) };
      const mode = await cli(['plan', 'budget', '--project', id, '--mode', 'auto'], env);
      expect(mode.body.error.code).toBe('FORBIDDEN');
      const approve = await cli(['plan', 'approve-art', '--project', id, '--credits', '8'], env);
      expect(approve.body.error.code).toBe('FORBIDDEN');
      expect(await state(id)).toMatchObject({ mode: 'ask', approval: { approvedCredits: 8 } });
      expect(GAME_PLAN_USAGE).toContain('approve-art --credits <n>');
      expect(GAME_PLAN_USAGE).toContain('--mode ask|auto');
    });

    it('rejects a malformed amount before calling the daemon', async () => {
      const id = project();
      const result = await cli(['plan', 'budget', '--project', id, '--credits', 'lots']);
      expect(result.exitCode).toBe(1);
      expect(await budget(id)).toBeNull();
    });

    it('under a tool token reads the budget but never changes it', async () => {
      const id = project();
      expect((await setBudget(id, 100)).status).toBe(200);
      const env = { PIXO_TOOL_TOKEN: token(id) };
      expect((await cli(['plan', 'budget', '--project', id], env)).body.budget.limitCredits).toBe(100);
      const change = await cli(['plan', 'budget', '--project', id, '--credits', '1000'], env);
      expect(change.exitCode).toBe(1);
      expect(change.body.error.code).toBe('FORBIDDEN');
      const pending = planning();
      const approve = await cli(['plan', 'approve', '--project', pending, '--art-budget', '500'], { PIXO_TOOL_TOKEN: token(pending) });
      expect(approve.exitCode).toBe(1);
      expect(approve.body.error.code).toBe('FORBIDDEN');
      expect((await budget(id))?.limitCredits).toBe(100);
      expect(await budget(pending)).toBeNull();
    });

    it('under a tool token sends a hosted generate with no quote or request id, whatever the flags say', async () => {
      const previous = process.env.PIXO_TOOL_TOKEN;
      process.env.PIXO_TOOL_TOKEN = 'pixott_agent';
      try {
        await expect(confirmOpenPixoHosted(harness.base, { prompt: 'x', model: 'openpixo-image', quote: randomUUID(), 'request-id': 'agent-request', 'cloud-style': 'free' }))
          .resolves.toEqual({});
      } finally {
        if (previous === undefined) delete process.env.PIXO_TOOL_TOKEN;
        else process.env.PIXO_TOOL_TOKEN = previous;
      }
    });
  });

  describe('a project that has no plan', () => {
    it('can hold a budget, and the agent can spend it', async () => {
      const id = project({ kind: 'other' });
      expect((await setBudget(id, 8)).status).toBe(200);
      await finished(await agentGenerate(token(id)));
      expect(await budget(id)).toMatchObject({ usedCredits: 4, remainingCredits: 4 });
    });
  });
});

