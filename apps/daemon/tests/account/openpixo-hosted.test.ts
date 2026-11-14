import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPENPIXO_MODEL3D_PROMPT } from '@openpixo/contracts';
import { generationJob, generationParams, generationServices } from '../../src/account/cloud-media.js';
import { generateMedia } from '../../src/media/index.js';
import { HostedGenerationError, migrateOpenPixoCloudJobs, OpenPixoHostedMedia, pendingHostedTaskIds, type HostedCloud } from '../../src/media/openpixo-hosted.js';
import { createMediaTaskStore } from '../../src/media/task-store.js';
import { getMediaTask, insertMediaTask, migrateMediaTasks, reconcileMediaTasksOnBoot } from '../../src/media/tasks.js';
import { accountHarness, type CloudRequest } from './fixtures.js';

// Asset provenance has its own tables and tests; a completed task here only needs to persist.
vi.mock('../../src/assets/provenance-store.js', () => ({ recordAssetProvenance: vi.fn() }));

const JOB_ID = '6f0e8a52-3c1d-4b7e-9a2f-1d2c3b4a5e6f';
const QUOTE_ID = '0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
const SHA = createHash('sha256').update(PNG).digest('hex');
const PARAMS = { prompt: 'a pixel slime', aspect: '1:1' as const };
/** After the fixtures' jobs and before their download dates, whatever day the tests run. */
const TEST_NOW = Date.parse('2026-11-03T00:00:10.000Z');

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function job(state: string, extra: Record<string, unknown> = {}) {
  return { jobId: JOB_ID, service: 'openpixo-image', state, creditsReserved: 2, creditsCharged: state === 'succeeded' ? 2 : null,
    errorCode: state === 'failed' ? 'VENDOR_FAILED' : null,
    artifact: state === 'succeeded' ? { mime: 'image/png', bytes: PNG.length, sha256: SHA } : null,
    createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:01.000Z', download: null, ...extra };
}

async function setup(options: { states?: string[]; artifact?: Buffer; downloadOrigin?: string; vendor?: (url: string, init?: RequestInit) => Response } = {}) {
  const h = await accountHarness();
  cleanup.push(h.close);
  expect((await h.signIn()).status).toBe(200);
  const states = [...(options.states ?? ['running', 'running', 'succeeded'])];
  const submits: CloudRequest[] = [];
  let downloads = 0;
  h.cloud.handlers.set('POST /functions/v1/generation-submit', (request) => { submits.push(request); return { body: job('running') }; });
  h.cloud.handlers.set('GET /functions/v1/generation-status', () => {
    const state = states.length > 1 ? states.shift()! : states[0]!;
    return { body: job(state, state === 'succeeded'
      ? { download: { url: `${options.downloadOrigin ?? h.cloud.url}/storage/v1/object/sign/generation-results/u/${JOB_ID}.png?token=t`, expiresAt: '2026-11-03T00:05:00.000Z' } }
      : {}) };
  });
  h.cloud.handlers.set('GET /storage/v1/object/sign/generation-results/u/6f0e8a52-3c1d-4b7e-9a2f-1d2c3b4a5e6f.png', () => {
    downloads++;
    return { raw: (options.artifact ?? PNG).toString('latin1') };
  });
  const db = new Database(':memory:');
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p1')");
  migrateMediaTasks(db);
  migrateOpenPixoCloudJobs(db);
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-hosted-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const projectsRoot = path.join(root, 'projects');
  await mkdir(path.join(projectsRoot, 'p1'), { recursive: true });
  // The fake cloud answers JSON; serve the artifact as raw bytes through a fetch shim.
  const fetchBytes: typeof fetch = async (input, init) => {
    // No test may reach a real host: a link off the fake cloud answers from `options.vendor`.
    if (!String(input).startsWith(h.cloud.url)) return (options.vendor ?? (() => { throw new Error(`unexpected request: ${String(input)}`); }))(String(input), init);
    const response = await fetch(input, init);
    return new Response(Buffer.from(await response.text(), 'latin1'), { status: response.status });
  };
  const hosted = new OpenPixoHostedMedia({ db, cloud: h.account, projectsRoot, getProjectMetadata: () => undefined,
    sleep: async () => {}, fetch: fetchBytes, now: () => TEST_NOW });
  cleanup.push(() => hosted.close());
  return { h, db, hosted, projectsRoot, submits, downloads: () => downloads, fetchBytes };
}

/** The failure a call was meant to end in. A call that succeeds instead fails the test. */
const refusal = (attempt: Promise<unknown>) => attempt.then(() => { throw new Error('expected a failure'); }, (error: unknown) => error as HostedGenerationError);

const args = (taskId = 'task-1') => ({ taskId, projectId: 'p1', service: 'openpixo-image', params: PARAMS,
  quoteId: QUOTE_ID, cloudRequestId: 'studio-request-0001', output: 'sprites/slime.png' });

const MP3_ID3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(120, 7)]);
const MP3_SYNC = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(120, 7)]);
const audioService = { id: 'openpixo-sfx', surface: 'audio', audioKind: 'sfx', label: 'Sound effect', credits: 7, priceVersion: 1, maxPromptChars: 450,
  durationSeconds: { min: 0.5, max: 10, default: 3 }, aspects: [], styles: [], references: { min: 0, max: 0 },
  pricing: { longPromptTokens: 1000, longPromptCredits: 0, maxPromptTokens: 1000, extraReferenceCredits: 0 } };

describe('hosted audio', () => {
  for (const [label, bytes] of [['an ID3 tag', MP3_ID3], ['a bare frame sync', MP3_SYNC]] as const) {
    it(`saves an MP3 that opens with ${label}, as audio`, async () => {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const { h, hosted, projectsRoot } = await setup({ artifact: bytes });
      h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('succeeded', {
        service: 'openpixo-sfx', artifact: { mime: 'audio/mpeg', bytes: bytes.length, sha256 },
        download: { url: `${h.cloud.url}/storage/v1/object/sign/generation-results/u/${JOB_ID}.png?token=t`, expiresAt: '2026-11-03T00:05:00.000Z' },
      }) }));
      h.cloud.handlers.set('POST /functions/v1/generation-submit', () => ({ body: job('running', { service: 'openpixo-sfx' }) }));
      const file = await hosted.generate({ ...args(), service: 'openpixo-sfx', params: { prompt: 'a coin', duration: 3 }, output: 'audio/coin.wav' });
      expect(file).toMatchObject({ name: 'audio/coin.mp3', surface: 'audio', kind: 'audio', mime: 'audio/mpeg' });
      expect(file.assetProvenance.params).toMatchObject({ surface: 'audio', duration: 3 });
      expect(await readFile(path.join(projectsRoot, 'p1', 'audio', 'coin.mp3'))).toEqual(bytes);
    });
  }

  it('still reads a JPEG as a JPEG, not as an MP3 frame', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120, 7)]);
    const { hosted } = await setup();
    await expect(hosted.uploadReferences([{ bytes: jpeg, mime: 'audio/mpeg' }])).rejects.toMatchObject({ code: 'GENERATION_PARAMS_INVALID' });
  });

  it('never accepts audio as a reference image', async () => {
    const { hosted } = await setup();
    await expect(hosted.uploadReferences([{ bytes: MP3_ID3, mime: 'audio/mpeg' }])).rejects.toMatchObject({ code: 'GENERATION_PARAMS_INVALID' });
    await expect(hosted.uploadReferences([{ bytes: MP3_SYNC, mime: 'image/png' }])).rejects.toMatchObject({ code: 'GENERATION_PARAMS_INVALID' });
  });

  it('keeps following a slow job with no deadline, and never releases it', async () => {
    const released: string[] = [];
    const { hosted, db, submits } = await setup({ states: [...Array<string>(40).fill('running'), 'succeeded'] });
    hosted.attachSettlement({ charged: () => {}, released: id => released.push(id) });
    const file = await hosted.generate(args());
    expect(file.name).toBe('sprites/slime.png');
    expect(submits).toHaveLength(1);
    expect(released).toEqual([]);
    expect(db.prepare('SELECT state FROM openpixo_cloud_jobs').get()).toEqual({ state: 'delivered' });
  });

  it('reads the catalogue with its new fields, and tolerates their absence', () => {
    const { voice } = { voice: { ...audioService, id: 'openpixo-voice', audioKind: 'speech', styles: ['Aria'], durationSeconds: undefined } };
    const parsed = generationServices({ generationPaused: false, services: [audioService, voice,
      { ...audioService, id: 'openpixo-music', audioKind: 'music', minPromptChars: 10, durationSeconds: undefined }] });
    expect(parsed.services[0]).toMatchObject({ surface: 'audio', audioKind: 'sfx', durationSeconds: { min: 0.5, max: 10, default: 3 } });
    expect(parsed.services[1]).toMatchObject({ audioKind: 'speech', styles: ['Aria'] });
    expect(parsed.services[1]).not.toHaveProperty('durationSeconds');
    expect(parsed.services[1]).not.toHaveProperty('minPromptChars');
    expect(parsed.services[2]).toMatchObject({ minPromptChars: 10 });
  });

  it('leaves out a surface newer than this app instead of losing the whole catalogue', () => {
    const parsed = generationServices({ generationPaused: false, services: [audioService, { ...audioService, id: 'openpixo-hologram', surface: 'hologram' }] });
    expect(parsed.services.map(service => service.id)).toEqual(['openpixo-sfx']);
    expect(() => generationServices({ generationPaused: false, services: [{ ...audioService, surface: undefined }] })).toThrow();
  });

  it('reads the 3D service next to the audio ones', () => {
    const model3d = { ...audioService, id: 'openpixo-model3d', surface: 'model3d', audioKind: undefined, durationSeconds: undefined, references: { min: 1, max: 1 } };
    const parsed = generationServices({ generationPaused: false, services: [audioService, model3d] });
    expect(parsed.services.map(service => service.surface)).toEqual(['audio', 'model3d']);
    expect(parsed.services[1]).toMatchObject({ references: { min: 1, max: 1 } });
    expect(parsed.services[1]).not.toHaveProperty('audioKind');
  });

  it('reads the 3D quality tiers and leaves out a 3D service this app cannot run', () => {
    const tier = (id: string, quality: unknown) => ({ ...audioService, id, surface: 'model3d', quality, audioKind: undefined, durationSeconds: undefined, references: { min: 1, max: 1 } });
    const parsed = generationServices({ generationPaused: false, services: [
      tier('openpixo-model3d-draft', 'draft'), tier('openpixo-model3d', 'medium'), tier('openpixo-model3d-high', 'high'),
      tier('openpixo-model3d-ultra', 'ultra'), audioService,
    ] });
    expect(parsed.services.map(service => [service.id, service.quality])).toEqual([
      ['openpixo-model3d-draft', 'draft'], ['openpixo-model3d', 'medium'], ['openpixo-model3d-high', 'high'], [audioService.id, undefined],
    ]);
    // A quality is a 3D field: an audio service that claims one does not carry it.
    expect(generationServices({ generationPaused: false, services: [{ ...audioService, quality: 'high' }] }).services[0]).not.toHaveProperty('quality');
  });

  it('accepts a duration in a request, and only a sensible one', () => {
    expect(generationParams({ prompt: 'a coin', duration: 0.5 })).toEqual({ prompt: 'a coin', duration: 0.5 });
    for (const duration of [0, -1, Number.NaN, '3', 99_999]) expect(() => generationParams({ prompt: 'a coin', duration })).toThrow();
  });

  it('accepts an MP3 artifact on a job', () => {
    const parsed = generationJob(job('succeeded', { artifact: { mime: 'audio/mpeg', bytes: 10, sha256: SHA } }));
    expect(parsed.artifact?.mime).toBe('audio/mpeg');
  });

  it('accepts an MP3 or a GLB with no hash, and nothing it does not know', () => {
    for (const mime of ['audio/mpeg', 'model/gltf-binary'] as const) {
      expect(generationJob(job('succeeded', { artifact: { mime, bytes: 10, sha256: null } })).artifact).toEqual({ mime, bytes: 10, sha256: null });
    }
    expect(() => generationJob(job('succeeded', { artifact: { mime: 'audio/wav', bytes: 10, sha256: null } }))).toThrow();
  });

  it('reads image resolutions and their prices, and leaves out a shape it does not know', () => {
    const image = { id: 'openpixo-image', surface: 'image', label: 'Image', credits: 4, priceVersion: 3, maxPromptChars: 12000,
      aspects: ['1:1', '21:9', '5:1'], resolutions: ['1k', '2k', '4k', '8k'], styles: [], references: { min: 0, max: 0 },
      pricing: { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1, resolutionCredits: { '2k': 2, '4k': 5 } } };
    const [service] = generationServices({ generationPaused: false, services: [image] }).services;
    expect(service).toMatchObject({ aspects: ['1:1', '21:9'], resolutions: ['1k', '2k', '4k'], pricing: { resolutionCredits: { '2k': 2, '4k': 5 } } });
    expect(generationParams({ prompt: 'a chest', resolution: '2k' })).toEqual({ prompt: 'a chest', resolution: '2k' });
    expect(generationParams({ prompt: 'a chest', resolution: '1k' })).toEqual({ prompt: 'a chest' });
    expect(() => generationParams({ prompt: 'a chest', resolution: '2K' })).toThrow();
  });

  it('asks the cloud for every surface, every 3D tier and every image size', async () => {
    const h = await accountHarness();
    cleanup.push(h.close);
    let query = '';
    h.cloud.handlers.set('GET /functions/v1/generation-services', (request) => { query = request.url.search; return { body: { generationPaused: false, services: [] } }; });
    await h.account.generationServices();
    expect(query).toBe('?v=4');
  });
});

describe('OpenPixo hosted media', () => {
  it('submits the confirmed quote once, follows the job and writes the verified artifact', async () => {
    const { hosted, db, projectsRoot, submits } = await setup();
    const progress: string[] = [];
    const file = await hosted.generate({ ...args(), onProgress: line => progress.push(line) });
    expect(file).toMatchObject({ name: 'sprites/slime.png', providerId: 'openpixo', usedStubFallback: false, intentionalStub: false,
      cloudJobId: JOB_ID, creditsCharged: 2 });
    expect(await readFile(path.join(projectsRoot, 'p1', 'sprites', 'slime.png'))).toEqual(PNG);
    expect(submits).toHaveLength(1);
    expect(submits[0]!.body).toEqual({ quoteId: QUOTE_ID, idempotencyKey: 'studio-request-0001', service: 'openpixo-image', params: PARAMS, delivery: 'direct' });
    expect(progress.join('\n')).toContain('2 credits reserved');
    expect(db.prepare('SELECT state, cloud_job_id, credits_charged FROM openpixo_cloud_jobs').get())
      .toEqual({ state: 'delivered', cloud_job_id: JOB_ID, credits_charged: 2 });
  });

  for (const service of ['openpixo-model3d-draft', 'openpixo-model3d', 'openpixo-model3d-high']) it(`delivers a ${service} model as a verified .glb, with a fixed prompt so the quote cannot drift`, async () => {
    const glb = Buffer.concat([Buffer.from('glTF', 'latin1'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(120, 3)]);
    const sha = createHash('sha256').update(glb).digest('hex');
    const { h, hosted, projectsRoot, submits } = await setup();
    const path3d = `/storage/v1/object/sign/generation-results/u/${JOB_ID}.glb`;
    h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('succeeded', { service,
      artifact: { mime: 'model/gltf-binary', bytes: glb.length, sha256: sha },
      download: { url: `${h.cloud.url}${path3d}?token=t`, expiresAt: '2026-11-03T01:00:00.000Z' } }) }));
    h.cloud.handlers.set(`GET ${path3d}`, () => ({ raw: glb.toString('latin1') }));
    const file = await hosted.generate({ taskId: 'task-3d', projectId: 'p1', service, params: { prompt: 'anything a caller typed' },
      quoteId: QUOTE_ID, cloudRequestId: 'studio-request-3d', output: 'models/chest.glb' });
    expect(file).toMatchObject({ name: 'models/chest.glb', surface: 'model3d', kind: 'model3d', mime: 'model/gltf-binary' });
    expect(await readFile(path.join(projectsRoot, 'p1', 'models/chest.glb'))).toEqual(glb);
    expect((submits[0]!.body as { params: { prompt: string } }).params.prompt).toBe(OPENPIXO_MODEL3D_PROMPT);
  });

  it('reports a released failure and writes nothing', async () => {
    const { hosted, db, projectsRoot } = await setup({ states: ['failed'] });
    await expect(hosted.generate(args())).rejects.toMatchObject({ code: 'OPENPIXO_VENDOR_FAILED' });
    await expect(readFile(path.join(projectsRoot, 'p1', 'sprites', 'slime.png'))).rejects.toThrow();
    expect(db.prepare('SELECT state, error_code FROM openpixo_cloud_jobs').get()).toEqual({ state: 'failed', error_code: 'VENDOR_FAILED' });
  });

  for (const [code, words] of [
    ['ARTIFACT_UNAVAILABLE', 'The finished file could not be retrieved in time, so this job was cancelled.'],
    ['GENERATION_TIMED_OUT', 'The hosted service did not finish this job in time.'],
  ] as const) {
    it(`explains ${code} without a vendor's name, and returns the credits`, async () => {
      const released: string[] = [];
      const { h, hosted, db } = await setup();
      hosted.attachSettlement({ charged: () => { throw new Error('nothing was charged'); }, released: id => released.push(id) });
      h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('failed', { errorCode: code, creditsReserved: 60 }) }));
      const failure = await refusal(hosted.generate(args()));
      expect(failure).toMatchObject({ code: `OPENPIXO_${code}`, retryable: true });
      expect(failure.message).toBe(`${words} Your 60 reserved credits were returned.`);
      expect(failure.message).not.toMatch(/\bfal\b|tripo|elevenlabs|minimax|vendor/iu);
      expect(released).toEqual(['studio-request-0001']);
      expect(db.prepare('SELECT state, error_code FROM openpixo_cloud_jobs').get()).toEqual({ state: 'failed', error_code: code });
    });
  }

  it('never accepts bytes that do not match the settled artifact, and never resubmits', async () => {
    const tampered = Buffer.from(PNG); tampered[100] = 1;
    const { hosted, submits, downloads, projectsRoot } = await setup({ states: ['succeeded'], artifact: tampered });
    await expect(hosted.generate(args())).rejects.toBeInstanceOf(HostedGenerationError);
    expect(downloads()).toBe(5);
    expect(submits).toHaveLength(1);
    await expect(readFile(path.join(projectsRoot, 'p1', 'sprites', 'slime.png'))).rejects.toThrow();
  });

  it('takes a link the cloud hands out only if it is secure', async () => {
    const { hosted, downloads } = await setup({ states: ['succeeded'], downloadOrigin: 'http://media.example' });
    await expect(hosted.generate(args())).rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED' });
    expect(downloads()).toBe(0);
  });

  describe('direct delivery', () => {
    const LINK = 'https://media.example/files/a1b2.png';
    const directJob = (bytes = PNG.length) => job('succeeded', { artifact: { mime: 'image/png', bytes, sha256: null }, download: { url: LINK, expiresAt: '2026-11-10T00:00:00.000Z' } });

    it('saves the file from the link the cloud hands out, and the link goes no further', async () => {
      const seen: string[] = [];
      const { h, hosted, db, projectsRoot } = await setup({ vendor: url => { seen.push(url); return new Response(new Uint8Array(PNG)); } });
      h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob() }));
      const progress: string[] = [];
      const file = await hosted.generate({ ...args(), onProgress: line => progress.push(line) });
      expect(seen).toEqual([LINK]);
      expect(await readFile(path.join(projectsRoot, 'p1', 'sprites', 'slime.png'))).toEqual(PNG);
      expect(file.assetProvenance.contentHash).toBe(SHA);
      const row = db.prepare('SELECT * FROM openpixo_cloud_jobs').get();
      for (const text of [JSON.stringify(file), JSON.stringify(row), progress.join('\n')]) expect(text).not.toContain('media.example');
    });

    it('never accepts a file of another size or type, and retries the link rather than the job', async () => {
      let served = 0;
      const { h, hosted, submits, projectsRoot } = await setup({ vendor: () => { served++; return new Response(new Uint8Array(Buffer.alloc(PNG.length, 7))); } });
      h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob() }));
      await expect(hosted.generate(args())).rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', message: expect.stringContaining('7 days') });
      expect(served).toBe(5);
      expect(submits).toHaveLength(1);
      await expect(readFile(path.join(projectsRoot, 'p1', 'sprites', 'slime.png'))).rejects.toThrow();

      const short = await setup({ vendor: () => new Response(new Uint8Array(PNG)) });
      short.h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob(PNG.length + 1) }));
      await expect(short.hosted.generate(args())).rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED' });
    });

    describe('a link that cannot give the file back', () => {
      const EXPIRED = 'This file was paid for, but its 7-day download window has passed. Contact support.';
      const GONE = 'This file was paid for, but its download link no longer works. Contact support.';
      const pastLink = () => job('succeeded', { artifact: { mime: 'image/png', bytes: PNG.length, sha256: null }, download: { url: LINK, expiresAt: '2026-11-02T00:00:00.000Z' } });
      const settlements = (hosted: OpenPixoHostedMedia) => {
        const log = { charged: 0, released: 0 };
        hosted.attachSettlement({ charged: () => { log.charged++; }, released: () => { log.released++; } });
        return log;
      };

      for (const status of [403, 404, 410]) {
        it(`stops for good on a ${status} past the 7 days, keeps the charge and says so`, async () => {
          let served = 0;
          const { h, hosted, db, submits } = await setup({ vendor: () => { served++; return new Response('', { status }); } });
          const log = settlements(hosted);
          h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: pastLink() }));
          const failure = await refusal(hosted.generate(args()));
          expect(failure).toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', message: EXPIRED, status: 410, retryable: false });
          expect(served).toBe(1);
          expect(submits).toHaveLength(1);
          expect(log.charged).toBeGreaterThan(0);
          expect(log.released).toBe(0);
          expect(db.prepare('SELECT state, error_code FROM openpixo_cloud_jobs').get()).toEqual({ state: 'failed', error_code: 'DOWNLOAD_GONE' });
          expect(pendingHostedTaskIds(db)).toEqual([]);
        });
      }

      it('never gives up on a 403 inside the 7 days, because a proxy or blocked region answers the same way', async () => {
        const { h, hosted, db } = await setup({ vendor: () => new Response('', { status: 403 }) });
        const log = settlements(hosted);
        h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob() }));
        const failure = await refusal(hosted.generate(args()));
        expect(failure).toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', status: 503, retryable: true });
        expect(failure.message).toBe('The file is paid and waiting for you for 7 days, but downloading it failed. Restart OpenPixo to retry the download.');
        expect(db.prepare('SELECT state FROM openpixo_cloud_jobs').get()).toEqual({ state: 'pending' });
        expect(pendingHostedTaskIds(db)).toEqual(['task-1']);
        expect(log.charged).toBeGreaterThan(0);
        expect(log.released).toBe(0);
      });

      for (const status of [404, 410]) {
        it(`gives a ${status} inside the 7 days a few tries, then stops for good in words that are true then`, async () => {
          let served = 0;
          const { h, hosted, db } = await setup({ vendor: () => { served++; return new Response('', { status }); } });
          const log = settlements(hosted);
          h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob() }));
          const failure = await refusal(hosted.generate(args()));
          expect(failure).toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', message: GONE, retryable: false });
          expect(served).toBe(5);
          expect(log.charged).toBeGreaterThan(0);
          expect(log.released).toBe(0);
          expect(db.prepare('SELECT state FROM openpixo_cloud_jobs').get()).toEqual({ state: 'failed' });
        });
      }

      it('rides out a blip inside the 7 days', async () => {
        let served = 0;
        const { h, hosted, projectsRoot } = await setup({ vendor: () => ++served < 3 ? new Response('', { status: 404 }) : new Response(new Uint8Array(PNG)) });
        h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob() }));
        expect((await hosted.generate(args())).name).toBe('sprites/slime.png');
        expect(await readFile(path.join(projectsRoot, 'p1', 'sprites', 'slime.png'))).toEqual(PNG);
      });

      it('still saves the file if the link outlives its date', async () => {
        const { h, hosted, db } = await setup({ vendor: () => new Response(new Uint8Array(PNG)) });
        h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: pastLink() }));
        expect((await hosted.generate(args())).name).toBe('sprites/slime.png');
        expect(db.prepare('SELECT state FROM openpixo_cloud_jobs').get()).toEqual({ state: 'delivered' });
      });

      for (const [name, answer] of [
        ['a 500', () => new Response('', { status: 500 })],
        ['a 503', () => new Response('', { status: 503 })],
        ['no connection', () => { throw new Error('connect ECONNRESET https://v3.fal.media/files/a1b2.png'); }],
      ] as const) {
        it(`keeps retrying after ${name} inside the 7 days, with the restart message`, async () => {
          const { h, hosted, db } = await setup({ vendor: answer });
          const log = settlements(hosted);
          h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob() }));
          const failure = await refusal(hosted.generate(args()));
          expect(failure).toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', status: 503, retryable: true });
          expect(failure.message).toBe('The file is paid and waiting for you for 7 days, but downloading it failed. Restart OpenPixo to retry the download.');
          expect(db.prepare('SELECT state FROM openpixo_cloud_jobs').get()).toEqual({ state: 'pending' });
          expect(pendingHostedTaskIds(db)).toEqual(['task-1']);
          expect(log.charged).toBeGreaterThan(0);
          expect(log.released).toBe(0);
        });

        it(`keeps retrying after ${name} past the 7 days, without promising the 7 days`, async () => {
          const { h, hosted, db } = await setup({ vendor: answer });
          h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: pastLink() }));
          const failure = await refusal(hosted.generate(args()));
          expect(failure).toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', status: 503, retryable: true });
          expect(failure.message).toBe('This file was paid for, but downloading it failed and its 7-day download window has passed. Restart OpenPixo to retry, or contact support.');
          expect(db.prepare('SELECT state FROM openpixo_cloud_jobs').get()).toEqual({ state: 'pending' });
        });
      }

      it('ends a resumed job once, and a later restart does not try again', async () => {
        let served = 0;
        const { h, db, projectsRoot, fetchBytes } = await setup({ vendor: () => { served++; return new Response('', { status: 404 }); } });
        const statuses = () => h.cloud.requests.filter(request => request.url.pathname.endsWith('generation-status')).length;
        h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: pastLink() }));
        insertMediaTask(db, { id: 'task-old', projectId: 'p1', status: 'running', surface: 'image', model: 'openpixo-image', progress: [] });
        db.prepare(`INSERT INTO openpixo_cloud_jobs (task_id, project_id, cloud_job_id, request_id, quote_id, service, params_json, output, state, created_at, updated_at)
          VALUES ('task-old', 'p1', ?, 'studio-request-0001', ?, 'openpixo-image', ?, 'sprites/slime.png', 'pending', 1, 1)`)
          .run(JOB_ID, QUOTE_ID, JSON.stringify(PARAMS));
        const boot = () => {
          reconcileMediaTasksOnBoot(db, { terminalTtlMs: 60_000_000_000, preserveTaskIds: pendingHostedTaskIds(db) });
          const store = createMediaTaskStore(db);
          const task = getMediaTask(db, 'task-old')!;
          store.hydrateMediaTask(task);
          const restarted = new OpenPixoHostedMedia({ db, cloud: h.account, projectsRoot, getProjectMetadata: () => undefined, tasks: store, sleep: async () => {}, fetch: fetchBytes, now: () => TEST_NOW });
          cleanup.push(() => restarted.close());
          restarted.resumePending();
        };
        boot();
        await vi.waitFor(() => expect(getMediaTask(db, 'task-old')?.status).toBe('failed'));
        expect(getMediaTask(db, 'task-old')?.error).toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', message: EXPIRED });
        expect(JSON.stringify(getMediaTask(db, 'task-old'))).not.toContain('media.example');
        const before = { served, polls: statuses() };
        boot();
        await new Promise(resolve => setTimeout(resolve, 50));
        expect({ served, polls: statuses() }).toEqual(before);
        expect(getMediaTask(db, 'task-old')?.error).toMatchObject({ message: EXPIRED });
      });
    });

    describe('the file bytes', () => {
      /** A real HTTP server, so the real fetch decompresses as it does in the app, whatever the server was asked for. */
      async function compressing(body: Buffer, encoding: string | null = 'gzip') {
        const seen: Array<string | undefined> = [];
        const wire = encoding ? gzipSync(body) : body;
        const server = createServer((request, response) => {
          seen.push(request.headers['accept-encoding']);
          response.writeHead(200, { 'content-length': wire.length, ...(encoding ? { 'content-encoding': encoding } : {}) });
          response.end(wire);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        cleanup.push(() => new Promise(resolve => server.close(resolve)));
        const { port } = server.address() as { port: number };
        return { origin: `http://127.0.0.1:${port}`, seen, wire };
      }
      async function fromServer(origin: string, bytes: number) {
        const db = new Database(':memory:');
        db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p1')");
        migrateOpenPixoCloudJobs(db);
        const root = await mkdtemp(path.join(tmpdir(), 'pixo-hosted-wire-'));
        cleanup.push(() => rm(root, { recursive: true, force: true }));
        const projectsRoot = path.join(root, 'projects');
        await mkdir(path.join(projectsRoot, 'p1'), { recursive: true });
        const cloud = { cloudOrigin: () => origin, generationSubmit: async () => job('running'),
          generationJob: async () => job('succeeded', { artifact: { mime: 'image/png', bytes, sha256: null }, download: { url: `${origin}/file`, expiresAt: '2026-11-10T00:00:00.000Z' } }) } as unknown as HostedCloud;
        const hosted = new OpenPixoHostedMedia({ db, cloud, projectsRoot, getProjectMetadata: () => undefined, sleep: async () => {}, now: () => TEST_NOW });
        cleanup.push(() => hosted.close());
        return { hosted, projectsRoot };
      }

      it('asks for the file uncompressed', async () => {
        const { origin, seen } = await compressing(PNG, null);
        const { hosted } = await fromServer(origin, PNG.length);
        await hosted.generate(args());
        expect(seen).toEqual(['identity']);
      });

      it('takes a file a server compressed anyway, checked against the size of the file itself', async () => {
        const { origin, seen } = await compressing(PNG);
        const { hosted, projectsRoot } = await fromServer(origin, PNG.length);
        await hosted.generate(args());
        expect(seen).toEqual(['identity']);
        expect(await readFile(path.join(projectsRoot, 'p1', 'sprites', 'slime.png'))).toEqual(PNG);
      });

      it('takes it too when the size proved was the compressed one', async () => {
        const { origin, wire } = await compressing(PNG);
        expect(wire.length).not.toBe(PNG.length);
        const { hosted, projectsRoot } = await fromServer(origin, wire.length);
        await hosted.generate(args());
        expect(await readFile(path.join(projectsRoot, 'p1', 'sprites', 'slime.png'))).toEqual(PNG);
      });

      it('refuses a compressed file that matches neither size', async () => {
        const { origin } = await compressing(PNG);
        const { hosted } = await fromServer(origin, PNG.length + 1);
        await expect(hosted.generate(args())).rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', retryable: true });
      });

      it('stops reading a body past the limit, whatever its headers said', async () => {
        const chunk = new Uint8Array(16 * 1024 * 1024);
        let pulled = 0;
        const endless = () => new Response(new ReadableStream({ pull(controller) { pulled++; controller.enqueue(chunk); } }));
        const { h, hosted } = await setup({ vendor: endless });
        h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob() }));
        await expect(hosted.generate(args())).rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED' });
        expect(pulled).toBeLessThan(5 * 16);
      });

      const frame = (...start: number[]) => Buffer.concat([Buffer.from(start), Buffer.alloc(120, 7)]);
      for (const [name, bytes] of [
        ['MPEG-1 Layer III', frame(0xff, 0xfb, 0x90, 0x00)], ['MPEG-1 Layer III without a CRC flag', frame(0xff, 0xfa, 0x90, 0x00)],
        ['MPEG-2 Layer III', frame(0xff, 0xf3, 0x90, 0x00)], ['MPEG-2.5 Layer III', frame(0xff, 0xe3, 0x90, 0x00)], ['an ID3 tag', MP3_ID3],
      ] as const) {
        it(`takes ${name} as an MP3`, async () => {
          const { h, hosted } = await setup({ vendor: () => new Response(new Uint8Array(bytes)) });
          h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('succeeded', { artifact: { mime: 'audio/mpeg', bytes: bytes.length, sha256: null }, download: { url: LINK, expiresAt: '2026-11-10T00:00:00.000Z' } }) }));
          expect((await hosted.generate({ ...args(), output: 'audio/a.mp3' })).mime).toBe('audio/mpeg');
        });
      }
      for (const [name, bytes] of [
        ['a UTF-16 byte order mark', frame(0xff, 0xfe, 0x90, 0x00)], ['an all-ones header', frame(0xff, 0xff, 0x90, 0x00)], ['a reserved version', frame(0xff, 0xeb, 0x90, 0x00)],
        ['Layer I', frame(0xff, 0xff, 0x90, 0x00)], ['Layer II', frame(0xff, 0xfd, 0x90, 0x00)], ['a reserved layer', frame(0xff, 0xf9, 0x90, 0x00)],
        ['a free bitrate', frame(0xff, 0xfb, 0x00, 0x00)], ['a bad bitrate', frame(0xff, 0xfb, 0xf0, 0x00)], ['a bad sample rate', frame(0xff, 0xfb, 0x9c, 0x00)],
      ] as const) {
        it(`refuses ${name} as an MP3`, async () => {
          const { h, hosted } = await setup({ vendor: () => new Response(new Uint8Array(bytes)) });
          h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('succeeded', { artifact: { mime: 'audio/mpeg', bytes: bytes.length, sha256: null }, download: { url: LINK, expiresAt: '2026-11-10T00:00:00.000Z' } }) }));
          await expect(hosted.generate({ ...args(), output: 'audio/a.mp3' })).rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED' });
        });
      }
    });

    it('uploads a reference straight to the link, without the cloud storage header', async () => {
      const puts: Array<{ url: string; headers: Headers; size: number }> = [];
      const { h, hosted } = await setup({ vendor: (url, init) => {
        puts.push({ url, headers: new Headers(init?.headers), size: (init?.body as Uint8Array).length });
        return new Response(null, { status: 200 });
      } });
      h.cloud.handlers.set('POST /functions/v1/generation-reference', (request) => {
        expect(request.body.delivery).toBe('direct');
        return { body: { sha256: request.body.sha256, uploadUrl: 'https://upload.example/put?sig=s' } };
      });
      expect(await hosted.uploadReferences([{ bytes: PNG, mime: 'image/png' }])).toEqual([SHA]);
      expect(puts).toHaveLength(1);
      expect(puts[0]).toMatchObject({ url: 'https://upload.example/put?sig=s', size: PNG.length });
      expect(puts[0]!.headers.get('content-type')).toBe('image/png');
      expect(puts[0]!.headers.has('x-upsert')).toBe(false);
    });

    const GLB = Buffer.concat([Buffer.from('glTF', 'latin1'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(120, 3)]);
    for (const [service, bytes, mime, surface, output, saved] of [
      ['openpixo-sfx', MP3_ID3, 'audio/mpeg', 'audio', 'audio/coin.png', 'audio/coin.mp3'],
      ['openpixo-voice', MP3_SYNC, 'audio/mpeg', 'audio', 'audio/line.mp3', 'audio/line.mp3'],
      ['openpixo-music', MP3_ID3, 'audio/mpeg', 'audio', 'audio/theme.mp3', 'audio/theme.mp3'],
      ['openpixo-model3d', GLB, 'model/gltf-binary', 'model3d', 'models/chest.glb', 'models/chest.glb'],
    ] as const) {
      it(`saves ${service} with no hash under the extension its bytes prove`, async () => {
        const released: string[] = [];
        let charged = 0;
        const { h, hosted, projectsRoot, submits } = await setup({ vendor: () => new Response(new Uint8Array(bytes)) });
        hosted.attachSettlement({ charged: () => { charged++; }, released: id => released.push(id) });
        h.cloud.handlers.set('POST /functions/v1/generation-submit', (request) => { submits.push(request); return { body: job('running', { service }) }; });
        h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('succeeded', { service,
          artifact: { mime, bytes: bytes.length, sha256: null }, download: { url: LINK, expiresAt: '2026-11-10T00:00:00.000Z' } }) }));
        const file = await hosted.generate({ ...args(), service, params: { prompt: 'x' }, output });
        expect(file).toMatchObject({ name: saved, surface, mime });
        expect(file.assetProvenance.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'));
        expect(await readFile(path.join(projectsRoot, 'p1', saved))).toEqual(bytes);
        expect(charged).toBe(1);
        expect(released).toEqual([]);
        expect(submits).toHaveLength(1);
        expect((submits[0]!.body as { delivery?: unknown }).delivery).toBe('direct');
      });
    }

    it('rejects a direct file that is not what the job says, without a release or a second job', async () => {
      const wav = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVE', 'latin1'), Buffer.alloc(120, 1)]);
      const released: string[] = [];
      const { h, hosted, projectsRoot, submits } = await setup({ vendor: () => new Response(new Uint8Array(wav)) });
      hosted.attachSettlement({ charged: () => {}, released: id => released.push(id) });
      h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('succeeded', { service: 'openpixo-sfx',
        artifact: { mime: 'audio/mpeg', bytes: wav.length, sha256: null }, download: { url: LINK, expiresAt: '2026-11-10T00:00:00.000Z' } }) }));
      await expect(hosted.generate({ ...args(), service: 'openpixo-sfx', params: { prompt: 'x' }, output: 'audio/coin.mp3' }))
        .rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED', message: expect.stringContaining('The file is paid') });
      expect(released).toEqual([]);
      expect(submits).toHaveLength(1);
      await expect(readFile(path.join(projectsRoot, 'p1', 'audio', 'coin.mp3'))).rejects.toThrow();
    });

    it('never surfaces or logs the host when the transport names it in a failed download', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cleanup.push(() => warn.mockRestore());
      const { h, hosted } = await setup({ vendor: () => { throw new Error('connect ECONNRESET https://v3.fal.media/files/a1b2.png'); } });
      h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('succeeded', { artifact: { mime: 'image/png', bytes: PNG.length, sha256: null },
        download: { url: 'https://v3.fal.media/files/a1b2.png', expiresAt: '2026-11-10T00:00:00.000Z' } }) }));
      const failure = await refusal(hosted.generate(args()));
      expect(failure).toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED' });
      expect((failure as Error).message).not.toMatch(/fal/iu);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/fal\.media|a1b2/iu);
    });

    it('still logs what its own checks found', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cleanup.push(() => warn.mockRestore());
      const { h, hosted } = await setup({ vendor: () => new Response('', { status: 403 }) });
      h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob() }));
      await expect(hosted.generate(args())).rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED' });
      expect(JSON.stringify(warn.mock.calls)).toContain('artifact download answered 403');
    });

    it('does not repeat a link it could not read', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cleanup.push(() => warn.mockRestore());
      const { h, hosted } = await setup();
      h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('succeeded', { artifact: { mime: 'image/png', bytes: PNG.length, sha256: null },
        download: { url: 'not a link v3.fal.media', expiresAt: '2026-11-10T00:00:00.000Z' } }) }));
      await expect(hosted.generate(args())).rejects.toMatchObject({ code: 'OPENPIXO_DOWNLOAD_FAILED' });
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/fal\.media/iu);
    });

    it('turns a failed reference upload into its own words, whatever the transport said', async () => {
      const { h, hosted } = await setup({ vendor: () => { throw new Error('connect ECONNRESET https://v3.fal.media/upload'); } });
      h.cloud.handlers.set('POST /functions/v1/generation-reference', (request) => ({ body: { sha256: request.body.sha256, uploadUrl: 'https://v3.fal.media/upload?sig=s' } }));
      const failure = await hosted.uploadReferences([{ bytes: PNG, mime: 'image/png' }]).catch((error: unknown) => error as Error);
      expect(failure).toMatchObject({ code: 'CLOUD_UNAVAILABLE' });
      expect((failure as Error).message).not.toMatch(/fal/iu);
    });

    it('never takes an MP3 or a GLB as a reference', async () => {
      const { hosted } = await setup();
      await expect(hosted.uploadReferences([{ bytes: MP3_ID3, mime: 'audio/mpeg' }])).rejects.toMatchObject({ code: 'GENERATION_PARAMS_INVALID' });
      await expect(hosted.uploadReferences([{ bytes: GLB, mime: 'model/gltf-binary' }])).rejects.toMatchObject({ code: 'GENERATION_PARAMS_INVALID' });
    });

    it('reads a job with no hash through the account service', async () => {
      const { h } = await setup();
      h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: directJob() }));
      expect(await h.account.generationJob(JOB_ID)).toMatchObject({ artifact: { sha256: null }, download: { url: LINK } });
    });
  });

  it('retries an unanswered submit under the same request id instead of creating a second job', async () => {
    const { h, hosted, submits } = await setup({ states: ['succeeded'] });
    let first = true;
    h.cloud.handlers.set('POST /functions/v1/generation-submit', (request) => {
      submits.push(request);
      if (first) { first = false; return { disconnect: true }; }
      return { body: job('running') };
    });
    await hosted.generate(args());
    expect(submits.map(request => request.body.idempotencyKey)).toEqual(['studio-request-0001', 'studio-request-0001']);
  });

  it('keeps a definitive refusal before any job as a failure with nothing reserved', async () => {
    const { h, hosted, db } = await setup();
    h.cloud.handlers.set('POST /functions/v1/generation-submit', () => ({ status: 409, body: { error: { code: 'GENERATION_QUOTE_EXPIRED' } } }));
    await expect(hosted.generate(args())).rejects.toMatchObject({ code: 'GENERATION_QUOTE_EXPIRED' });
    expect(db.prepare('SELECT state, cloud_job_id FROM openpixo_cloud_jobs').get()).toEqual({ state: 'failed', cloud_job_id: null });
  });

  it('resumes a followed job after a daemon restart instead of marking it interrupted', async () => {
    const { db, h, projectsRoot } = await setup({ states: ['succeeded'] });
    insertMediaTask(db, { id: 'task-r', projectId: 'p1', status: 'running', surface: 'image', model: 'openpixo-image', progress: [] });
    insertMediaTask(db, { id: 'task-local', projectId: 'p1', status: 'running', surface: 'image', model: 'gpt-image-2', progress: [] });
    db.prepare(`INSERT INTO openpixo_cloud_jobs (task_id, project_id, cloud_job_id, request_id, quote_id, service, params_json, output, state, created_at, updated_at)
      VALUES ('task-r', 'p1', ?, 'studio-request-0001', ?, 'openpixo-image', ?, 'sprites/slime.png', 'pending', 1, 1)`)
      .run(JOB_ID, QUOTE_ID, JSON.stringify(PARAMS));

    reconcileMediaTasksOnBoot(db, { terminalTtlMs: 60_000, preserveTaskIds: pendingHostedTaskIds(db) });
    expect(getMediaTask(db, 'task-local')?.status).toBe('interrupted');
    expect(getMediaTask(db, 'task-r')?.status).toBe('running');

    const store = createMediaTaskStore(db);
    store.hydrateMediaTask(getMediaTask(db, 'task-r')!);
    const fetchBytes: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      return new Response(Buffer.from(await response.text(), 'latin1'), { status: response.status });
    };
    const restarted = new OpenPixoHostedMedia({ db, cloud: h.account, projectsRoot, getProjectMetadata: () => undefined,
      tasks: store, sleep: async () => {}, fetch: fetchBytes });
    cleanup.push(() => restarted.close());
    restarted.resumePending();
    await vi.waitFor(() => expect(getMediaTask(db, 'task-r')?.status).toBe('done'));
    expect(getMediaTask(db, 'task-r')).toMatchObject({ status: 'done', file: expect.objectContaining({ cloudJobId: JOB_ID }) });
    expect(h.cloud.requests.filter(request => request.url.pathname.endsWith('generation-submit'))).toHaveLength(0);
    expect(pendingHostedTaskIds(db)).toEqual([]);
  });

  it('uploads each reference once and sends their hashes with the submit', async () => {
    const { h, hosted, submits } = await setup({ states: ['succeeded'] });
    const stored = new Set<string>();
    const puts: string[] = [];
    h.cloud.handlers.set('POST /functions/v1/generation-reference', (request) => ({ body: { sha256: request.body.sha256,
      uploadUrl: stored.has(String(request.body.sha256)) ? null : `${h.cloud.url}/storage/v1/object/upload/sign/generation-results/u/refs/${request.body.sha256}?token=u` } }));
    h.cloud.handlers.set('PUT /storage/v1/object/upload/sign/generation-results/u/refs/' + SHA, (request) => {
      puts.push(request.url.pathname); stored.add(SHA); return { body: { Key: 'ok' } };
    });
    const other = Buffer.concat([PNG, Buffer.from([1])]);
    const otherSha = createHash('sha256').update(other).digest('hex');
    h.cloud.handlers.set('PUT /storage/v1/object/upload/sign/generation-results/u/refs/' + otherSha, () => { stored.add(otherSha); return { body: {} }; });
    expect(await hosted.uploadReferences([{ bytes: PNG, mime: 'image/png' }, { bytes: other, mime: 'image/png' }])).toEqual([SHA, otherSha]);
    expect(await hosted.uploadReferences([{ bytes: PNG, mime: 'image/png' }])).toEqual([SHA]);
    expect(puts).toHaveLength(1);
    await hosted.generate({ ...args(), service: 'openpixo-image-edit', references: [{ bytes: PNG, mime: 'image/png' }, { bytes: other, mime: 'image/png' }] });
    expect(submits[0]!.body).toMatchObject({ service: 'openpixo-image-edit', params: { ...PARAMS, references: [SHA, otherSha] } });
  });

  it('refuses references that are not real images, too many, or an insecure upload link', async () => {
    const { h, hosted } = await setup();
    await expect(hosted.uploadReferences([{ bytes: Buffer.from('GIF89a' + 'x'.repeat(100)), mime: 'image/gif' }])).rejects.toMatchObject({ code: 'GENERATION_PARAMS_INVALID' });
    await expect(hosted.uploadReferences([{ bytes: PNG, mime: 'image/jpeg' }])).rejects.toMatchObject({ code: 'GENERATION_PARAMS_INVALID' });
    await expect(hosted.uploadReferences(Array.from({ length: 5 }, () => ({ bytes: PNG, mime: 'image/png' })))).rejects.toMatchObject({ code: 'GENERATION_PARAMS_INVALID' });
    h.cloud.handlers.set('POST /functions/v1/generation-reference', (request) => ({ body: { sha256: request.body.sha256, uploadUrl: 'http://elsewhere.example/upload' } }));
    await expect(hosted.uploadReferences([{ bytes: PNG, mime: 'image/png' }])).rejects.toMatchObject({ code: 'CLOUD_UNAVAILABLE' });
    expect(h.cloud.requests.filter(request => request.method === 'PUT')).toHaveLength(0);
  });

  it('refuses an openpixo model without a confirmed quote and never writes a placeholder', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixo-hosted-gate-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const previous = process.env.PIXO_MEDIA_ALLOW_STUBS;
    process.env.PIXO_MEDIA_ALLOW_STUBS = '1';
    cleanup.push(() => { if (previous === undefined) delete process.env.PIXO_MEDIA_ALLOW_STUBS; else process.env.PIXO_MEDIA_ALLOW_STUBS = previous; });
    await expect(generateMedia({ projectRoot: root, projectsRoot: path.join(root, 'projects'), projectId: 'p1', surface: 'image',
      model: 'openpixo-image', prompt: 'slime', output: 'slime.png' })).rejects.toMatchObject({ code: 'GENERATION_CONFIRMATION_REQUIRED' });
    await expect(readFile(path.join(root, 'projects', 'p1', 'slime.png'))).rejects.toThrow();
  });
});

describe('cloud-media routes', () => {
  it('relays services and quotes, validates input locally and keeps signed URLs inside the daemon', async () => {
    const h = await accountHarness();
    cleanup.push(h.close);
    const services = { services: [{ id: 'openpixo-image', surface: 'image', label: 'GPT Image 2.5 Flare', credits: 4, priceVersion: 2,
      maxPromptChars: 12000, aspects: ['1:1', '2:3', '3:2'], styles: [], references: { min: 0, max: 0 },
      pricing: { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1 } }], generationPaused: false };
    h.cloud.handlers.set('GET /functions/v1/generation-services', () => ({ body: services }));
    expect(await h.json('/cloud-media/services')).toEqual({ status: 200, body: services });
    expect((await h.json('/cloud-media/quote', 'POST', { service: 'openpixo-image', params: PARAMS })).body.error.code).toBe('ACCOUNT_SIGNED_OUT');
    await h.signIn();
    const quote = { quoteId: QUOTE_ID, service: 'openpixo-image', credits: 2, priceVersion: 1, paramsDigest: 'a'.repeat(64),
      expiresAt: '2026-11-03T00:10:00.000Z', available: 98, breakdown: { base: 2, longPrompt: 0, extraReferences: 0 }, debug: 'dropped' };
    h.cloud.handlers.set('POST /functions/v1/generation-quote', () => ({ body: quote }));
    const { debug: _debug, ...expected } = quote;
    expect(await h.json('/cloud-media/quote', 'POST', { service: 'openpixo-image', params: PARAMS })).toEqual({ status: 200, body: expected });
    expect((await h.json('/cloud-media/quote', 'POST', { service: 'gpt-image-2', params: PARAMS })).body.error.code).toBe('GENERATION_SERVICE_UNKNOWN');
    expect((await h.json('/cloud-media/quote', 'POST', { service: 'openpixo-image', params: { prompt: '' } })).body.error.code).toBe('GENERATION_PARAMS_INVALID');
    h.cloud.handlers.set('GET /functions/v1/generation-status', () => ({ body: job('succeeded', { download: { url: `${h.cloud.url}/secret-signed`, expiresAt: '2026-11-03T00:05:00.000Z' } }) }));
    const status = await h.json(`/cloud-media/jobs/${JOB_ID}`);
    expect(status.body).toMatchObject({ jobId: JOB_ID, state: 'succeeded', creditsCharged: 2 });
    expect(JSON.stringify(status.body)).not.toContain('secret-signed');
    expect((await h.json('/cloud-media/jobs/not-a-uuid')).body.error.code).toBe('GENERATION_JOB_NOT_FOUND');
  });
});
