import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { MotionCharacter, MotionJob, MotionPortrait } from '@openpixo/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountError } from '../../src/account/errors.js';
import { closeDatabase, openDatabase } from '../../src/db.js';
import { GODOT_PLAYER_FILES } from '../../src/motion/install.js';
import { registerMotionRoutes, type MotionFacts } from '../../src/motion/routes.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

const ORIGIN = 'https://characters.test';
const PORTRAIT = '11111111-2222-4333-8444-555555555555', CHARACTER = '22222222-2222-4333-8444-555555555555', JOB = '33333333-2222-4333-8444-555555555555';
const REAL_SDK = fileURLToPath(new URL('../../../../game-sdk', import.meta.url));
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const at = '2026-11-27T00:00:00.000Z';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a picture')]);
const PXMO = Buffer.concat([Buffer.from('PXMO'), Buffer.from('the character')]), POSTER = Buffer.from('poster'), PAINTED = Buffer.from('portrait');
/** What the cloud would never send on, in every answer. */
const SECRET = { prompt: 'SECRET', source: 'SECRET', bucketKey: 'SECRET' };

const portrait = (change: Partial<MotionPortrait> = {}): MotionPortrait => ({ id: PORTRAIT, state: 'painting', text: 'a fox knight', fromPicture: false, used: false, errorCode: null, createdAt: at, expiresAt: at, ...change });
const job = (change: Partial<MotionJob> = {}): MotionJob => ({ id: JOB, characterId: CHARACTER, state: 'waiting', progress: 0, creditsReserved: 60, creditsCharged: null, errorCode: null, createdAt: at, updatedAt: at, ...change });
const character = (change: Partial<MotionCharacter> = {}): MotionCharacter => ({ id: CHARACTER, name: 'Fox Knight', state: 'ready', portraitId: PORTRAIT, file: { bytes: PXMO.length, sha256: sha(PXMO) }, job: job({ state: 'succeeded', progress: 1, creditsCharged: 60 }), createdAt: at, updatedAt: at, ...change });

let facts: MotionFacts, root: string, sdk: string, db: ReturnType<typeof openDatabase>, server: Server, base: string, sameOrigin: boolean, signedIn: boolean, available: boolean, balanceReads: number;
let asked: { route: string; method: string; body: any }[], downloads: string[], painted: boolean, jobState: MotionJob['state'], files: Map<string, Buffer>, baseUrl: string, cloud: (route: string, method: string, body: unknown) => unknown;

function answer(route: string, method: string): unknown {
  if (route === 'motion/service') return { ...SECRET, paused: false, priceVersion: 2, price: 60, portraitsPerDay: 10, portraitsLeft: 7 };
  if (route === 'motion/portraits' && method === 'POST') return { ...portrait(), ...SECRET };
  if (route === `motion/portraits/${PORTRAIT}`) return { ...portrait({ state: painted ? 'ready' : 'painting' }), ...SECRET };
  if (route === `motion/portraits/${PORTRAIT}/download`) return { id: PORTRAIT, baseUrl: `${ORIGIN}/files/p`, token: 'file-token', expiresAt: at, files: [{ name: 'portrait.png', bytes: PAINTED.length, sha256: sha(PAINTED) }, { name: 'making.png', bytes: 1, sha256: sha(Buffer.from('x')) }] };
  if (route === 'motion/jobs' && method === 'POST') return { ...job(), ...SECRET };
  if (route === `motion/jobs/${JOB}`) return { ...job({ state: jobState, progress: jobState === 'succeeded' ? 1 : 0.4, creditsCharged: jobState === 'succeeded' ? 60 : null }), ...SECRET };
  if (route === 'motion/characters') return { characters: [{ ...character(), ...SECRET }] };
  if (route === `motion/characters/${CHARACTER}/download`) return { id: CHARACTER, baseUrl, token: 'file-token', expiresAt: at, files: [...files].map(([name, b]) => ({ name, bytes: b.length, sha256: sha(b) })) };
  if (route === `motion/characters/${CHARACTER}` && method === 'DELETE') return { id: CHARACTER, deleted: true };
  if (route === `motion/characters/${CHARACTER}`) return { ...character(), ...SECRET };
  return new Response(JSON.stringify({ error: { code: 'MOTION_NOT_FOUND', message: 'SECRET' } }), { status: 404 });
}

beforeAll(async () => {
  // the real players, and a Godot addon of stubs until the real one is in the SDK
  sdk = await mkdtemp(path.join(os.tmpdir(), 'openpixo-motion-sdk-'));
  await cp(path.join(REAL_SDK, 'openpixo-motion', 'web'), path.join(sdk, 'openpixo-motion', 'web'), { recursive: true });
  await cp(path.join(REAL_SDK, 'openpixo-motion', 'phaser'), path.join(sdk, 'openpixo-motion', 'phaser'), { recursive: true });
  const addon = path.join(sdk, 'openpixo-motion', 'godot', 'addons', 'pixo_motion');
  await mkdir(addon, { recursive: true });
  for (const name of GODOT_PLAYER_FILES) await writeFile(path.join(addon, name), name === 'pixo_motion.gd' ? 'class_name PixoMotion\nextends Sprite2D\n@export_file("*.pxmo") var file_path: String\n' : `# ${name}\n`);
});
afterAll(async () => { await rm(sdk, { recursive: true, force: true }); });

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-motion-'));
  db = openDatabase(root, { dataDir: root });
  for (const [id, name] of [['game', 'Foxhole'], ['other', 'Other']]) db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, 1, 1);
  sameOrigin = signedIn = available = true;
  balanceReads = 0;
  asked = []; downloads = []; painted = false; jobState = 'building'; baseUrl = `${ORIGIN}/files/c`; cloud = answer;
  files = new Map([['character.pxmo', PXMO], ['poster.png', POSTER]]);
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  facts = registerMotionRoutes(app, {
    db, sdkDir: sdk, paths: { RUNTIME_DATA_DIR: root, PROJECTS_DIR: path.join(root, 'projects') } as never,
    http: { requireLocalDaemonRequest: (_q: unknown, _s: unknown, next: () => void) => next(), isLocalSameOrigin: () => sameOrigin, resolvedPortRef: { current: 0 }, sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) } as never,
    authorizeProjectRequest: async () => true, authorizeProjectToolRequest: async () => ({}) as never,
    account: {
      characterOrigin: () => available ? ORIGIN : null, hasSession: async () => signedIn, creditsChanged: () => { balanceReads++; },
      character: async (route, method = 'GET', body) => {
        asked.push({ route, method, body });
        if (!signedIn) throw new AccountError('ACCOUNT_SIGNED_OUT');
        const value = cloud(route, method, body);
        return value instanceof Response ? value : Response.json(value);
      },
    },
    fetchFile: async (url, init) => {
      downloads.push(url);
      const name = new URL(url).pathname.split('/').at(-1)!, data = url.includes('/files/p/') ? (name === 'portrait.png' ? PAINTED : undefined) : files.get(name);
      if (init.headers.authorization !== 'Bearer file-token' || !data) return new Response(null, { status: 403 });
      return new Response(new Uint8Array(data));
    },
  });
  await new Promise<void>(done => { server = app.listen(0, '127.0.0.1', () => done()); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  await new Promise(done => { server.close(done); server.closeAllConnections(); });
  closeDatabase();
  await rm(root, { recursive: true, force: true });
});

async function call(route: string, method = 'GET', body?: unknown, token?: string): Promise<{ status: number; json: any; bytes: Buffer; headers: Headers }> {
  const form = body instanceof FormData;
  const response = await fetch(`${base}/api${route}`, { method, headers: { ...(body === undefined || form ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) });
  const bytes = Buffer.from(await response.arrayBuffer());
  let json: unknown = null;
  try { json = JSON.parse(bytes.toString()); } catch { /* a file */ }
  expect(bytes.toString('latin1')).not.toContain('SECRET');
  return { status: response.status, json, bytes, headers: response.headers };
}
const agent = (project = 'game'): string => toolTokenRegistry.mint({ runId: 'run-1', projectId: project, allowedEndpoints: ['/api/tools/media/generate'], allowedOperations: ['media:generate'] } as never).token;
const game = (...parts: string[]): string => path.join(root, 'projects', 'game', ...parts);
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);
async function phaserGame(): Promise<void> {
  await mkdir(game('src'), { recursive: true });
  await writeFile(game('package.json'), JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { phaser: '3.90.0' }, devDependencies: { vite: '7.0.0' } }));
  await writeFile(game('index.html'), '<!doctype html>');
}
const pictureForm = (data: Buffer, text = 'a fox knight'): FormData => {
  const form = new FormData();
  form.append('text', text);
  form.append('requestId', 'request-portrait-1');
  form.append('picture', new Blob([new Uint8Array(data)]), 'fox.png');
  return form;
};

describe('the service', () => {
  it('says whether there is one before anything else', async () => {
    expect((await call('/motion/service')).json).toEqual({ available: true, signedIn: true, service: { paused: false, priceVersion: 2, price: 60, portraitsPerDay: 10, portraitsLeft: 7 } });
    signedIn = false;
    expect((await call('/motion/service')).json).toEqual({ available: true, signedIn: false, service: null });
    available = false;
    expect((await call('/motion/service')).json).toEqual({ available: false, signedIn: false, service: null });
    for (const route of ['/motion/characters', '/motion/player.js']) expect((await call(route)).json).toMatchObject({ error: { code: 'MOTION_NOT_CONFIGURED' } });
    expect(asked).toHaveLength(1);
  });

  it('serves the player the games get, for the page', async () => {
    const player = await call('/motion/player.js');
    expect(player.headers.get('content-type')).toMatch(/^text\/javascript/u);
    expect(player.bytes.equals(await readFile(path.join(REAL_SDK, 'openpixo-motion', 'web', 'pixo-motion.min.js')))).toBe(true);
  });
});

describe('from a portrait to a moving character', () => {
  it('paints, waits, orders, waits and downloads the file once', async () => {
    expect((await call('/motion/portraits', 'POST', { text: ' a fox knight ', requestId: 'request-portrait-1', evil: 1 })).json).toEqual(portrait());
    expect(asked.at(-1)).toEqual({ route: 'motion/portraits', method: 'POST', body: { text: 'a fox knight', requestId: 'request-portrait-1' } });
    expect((await call(`/motion/portraits/${PORTRAIT}`)).json.state).toBe('painting');
    expect(await call(`/motion/portraits/${PORTRAIT}/picture`)).toMatchObject({ status: 409, json: { error: { code: 'MOTION_PORTRAIT_NOT_READY' } } });
    painted = true;
    const picture = await call(`/motion/portraits/${PORTRAIT}/picture`);
    expect(picture.headers.get('content-type')).toBe('image/png');
    expect(picture.bytes.equals(PAINTED)).toBe(true);
    await call(`/motion/portraits/${PORTRAIT}/picture`);
    // only the portrait, once, and nothing the app does not know
    expect(downloads).toEqual([`${ORIGIN}/files/p/portrait.png`]);

    expect((await call('/motion/jobs', 'POST', { portraitId: PORTRAIT, name: ' Fox Knight ', requestId: 'request-order-1', credits: 1 })).json).toEqual(job());
    expect(asked.at(-1)!.body).toEqual({ portraitId: PORTRAIT, name: 'Fox Knight', requestId: 'request-order-1' });
    expect(balanceReads).toBe(1);
    expect((await call(`/motion/jobs/${JOB}`)).json).toMatchObject({ state: 'building', progress: 0.4 });
    jobState = 'succeeded';
    expect((await call(`/motion/jobs/${JOB}`)).json).toMatchObject({ state: 'succeeded', creditsCharged: 60 });
    expect(balanceReads).toBe(2);

    expect((await call('/motion/characters')).json).toEqual({ characters: [character()], suggestions: [] });
    const file = await call(`/motion/characters/${CHARACTER}/file`);
    expect(file.bytes.equals(PXMO)).toBe(true);
    expect((await call(`/motion/characters/${CHARACTER}/poster`)).bytes.equals(POSTER)).toBe(true);
    expect((await call(`/motion/characters/${CHARACTER}/file?download=1`)).headers.get('content-disposition')).toContain('fox-knight.pxmo');
    expect(downloads.filter(d => d.includes('/files/c/')).sort()).toEqual([`${ORIGIN}/files/c/character.pxmo`, `${ORIGIN}/files/c/poster.png`]);
    expect(await exists(path.join(root, 'motion', 'characters', CHARACTER, 'character.pxmo'))).toBe(true);

    expect((await call(`/motion/characters/${CHARACTER}`, 'DELETE')).json).toEqual({ id: CHARACTER, deleted: true });
    expect(await exists(path.join(root, 'motion', 'characters', CHARACTER))).toBe(false);
  });

  it('takes a picture to start from, and only a real one', async () => {
    await call('/motion/portraits', 'POST', pictureForm(PNG));
    expect(asked.at(-1)!.body).toEqual({ text: 'a fox knight', picture: { type: 'image/png', data: PNG.toString('base64') }, requestId: 'request-portrait-1' });
    // the same as JSON, without words
    await call('/motion/portraits', 'POST', { text: '', picture: { type: 'image/gif', data: PNG.toString('base64') } });
    expect(asked.at(-1)!.body).toMatchObject({ text: '', picture: { type: 'image/png' }, requestId: expect.stringMatching(/\w{8}/u) });
    const before = asked.length;
    for (const body of [pictureForm(Buffer.from('<svg/>')), pictureForm(Buffer.alloc(8 * 1024 * 1024 + 1, 0xff)), { text: 'x', picture: { data: '***' } }]) {
      expect((await call('/motion/portraits', 'POST', body)).json.error.code).toBe('MOTION_PICTURE_INVALID');
    }
    expect(asked).toHaveLength(before);
  });

  it('refuses what makes no sense before the cloud is asked', async () => {
    for (const [route, method, body] of [
      ['/motion/portraits', 'POST', { text: 'x' }], ['/motion/portraits', 'POST', { text: 'x'.repeat(601) }], ['/motion/portraits', 'POST', { text: 'a fox', requestId: 'short' }],
      ['/motion/jobs', 'POST', { portraitId: PORTRAIT, name: '', requestId: 'request-1' }], ['/motion/jobs', 'POST', { portraitId: PORTRAIT, name: 'x'.repeat(41), requestId: 'request-1' }], ['/motion/jobs', 'POST', { portraitId: '../x', name: 'Fox', requestId: 'request-1' }],
      [`/motion/characters/${CHARACTER}`, 'PATCH', { name: ' ' }],
    ] as const) expect((await call(route, method, body)).status, JSON.stringify(body)).toBe(400);
    for (const route of ['/motion/characters/..%2fx', '/motion/portraits/x', `/motion/characters/a.b.c.d.e.f/file`]) expect((await call(route)).status, route).toBe(404);
    expect(asked).toEqual([]);
  });

  it('passes on the cloud\'s codes with its own words', async () => {
    for (const code of ['MOTION_PORTRAIT_LIMIT', 'MOTION_PORTRAIT_USED', 'INSUFFICIENT_CREDITS', 'MOTION_PAUSED']) {
      cloud = () => new Response(JSON.stringify({ error: { code, message: 'SECRET' } }), { status: 409 });
      expect((await call('/motion/jobs', 'POST', { portraitId: PORTRAIT, name: 'Fox', requestId: 'request-1' })).json.error).toMatchObject({ code, message: expect.stringMatching(/\w/u) });
    }
    for (const odd of [new Response('SECRET', { status: 500 }), Response.json({ error: { code: 'SECRET' } }, { status: 400 }), Response.json({ characters: [{ ...character(), id: '../x' }] }), Response.json({ characters: 'SECRET' }), new Response('not json')]) {
      cloud = () => odd;
      expect(await call('/motion/characters')).toMatchObject({ status: 503, json: { error: { code: 'CLOUD_UNAVAILABLE' } } });
    }
    // a reason this version does not know is told as the plain one
    cloud = () => ({ ...job({ state: 'failed', errorCode: 'MOTION_SECRET_STEP' as never }) });
    expect((await call(`/motion/jobs/${JOB}`)).json.errorCode).toBe('MOTION_BUILD_FAILED');
    signedIn = false;
    expect(await call('/motion/characters')).toMatchObject({ status: 401, json: { error: { code: 'ACCOUNT_SIGNED_OUT' } } });
  });

  it('downloads only from the service, and only what it said it would be', async () => {
    baseUrl = 'https://elsewhere.test/files/c';
    expect((await call(`/motion/characters/${CHARACTER}/file`)).json.error.code).toBe('CLOUD_UNAVAILABLE');
    expect(downloads).toEqual([]);
    baseUrl = `${ORIGIN}/files/c`;
    files.set('character.pxmo', Buffer.from('another file'));
    expect((await call(`/motion/characters/${CHARACTER}/file`)).json.error.code).toBe('MOTION_DOWNLOAD_FAILED');
    expect(downloads).toEqual([]);
    cloud = (route, method) => route.endsWith('/download') ? { id: CHARACTER, baseUrl, token: 'file-token', expiresAt: at, files: [{ name: 'character.pxmo', bytes: PXMO.length, sha256: sha(PXMO) }, { name: 'poster.png', bytes: 6, sha256: sha(Buffer.from('wrong!')) }] } : answer(route, method);
    files.set('character.pxmo', PXMO);
    expect((await call(`/motion/characters/${CHARACTER}/poster`)).json.error.code).toBe('MOTION_DOWNLOAD_FAILED');
    expect(await exists(path.join(root, 'motion', 'characters', CHARACTER))).toBe(false);
  });
});

describe('in a game', () => {
  it('puts the file and the Phaser player into a Phaser game, and leaves a player that was changed by hand alone', async () => {
    await phaserGame();
    const installed = await call(`/motion/characters/${CHARACTER}/install`, 'POST', { projectId: 'game' });
    expect(installed.json).toMatchObject({
      characterId: CHARACTER, slug: 'fox-knight', file: 'public/assets/characters/fox-knight.pxmo', engine: 'phaser', playerState: 'written',
      player: ['src/pixo-motion/pixo-motion.min.js', 'src/pixo-motion/pixo-motion-phaser.js'],
    });
    expect(installed.json.usage).toContain("this.load.binary('fox-knight', 'assets/characters/fox-knight.pxmo')");
    expect(installed.json.usage).toContain("await addPixoMotion(this, x, y, 'fox-knight'");
    expect((await readFile(game('public', 'assets', 'characters', 'fox-knight.pxmo'))).equals(PXMO)).toBe(true);
    expect((await readFile(game('src', 'pixo-motion', 'pixo-motion-phaser.js'))).equals(await readFile(path.join(REAL_SDK, 'openpixo-motion', 'phaser', 'pixo-motion-phaser.js')))).toBe(true);
    expect((await call(`/motion/characters/${CHARACTER}/install`, 'POST', { projectId: 'game' })).json.playerState).toBe('same');
    await writeFile(game('src', 'pixo-motion', 'pixo-motion-phaser.js'), '// mine');
    expect((await call(`/motion/characters/${CHARACTER}/install`, 'POST', { projectId: 'game' })).json.playerState).toBe('edited');
    expect(await readFile(game('src', 'pixo-motion', 'pixo-motion-phaser.js'), 'utf8')).toBe('// mine');
    expect(await facts.promptFacts('game')).toEqual({ installed: [{ slug: 'fox-knight', name: 'Fox Knight', file: 'public/assets/characters/fox-knight.pxmo' }] });
    // the file was downloaded once for all of it
    expect(downloads.filter(d => d.endsWith('character.pxmo'))).toHaveLength(1);
  });

  it('puts the addon into a Godot game and says how to use it', async () => {
    await mkdir(game(), { recursive: true });
    await writeFile(game('project.godot'), 'config_version=5\n');
    const installed = (await call(`/motion/characters/${CHARACTER}/install`, 'POST', { projectId: 'game' })).json;
    expect(installed).toMatchObject({ file: 'assets/characters/fox-knight.pxmo', engine: 'godot', player: GODOT_PLAYER_FILES.map(f => `addons/pixo_motion/${f}`) });
    expect(installed.usage).toContain('var hero := PixoMotion.new()');
    expect(installed.usage).toContain('hero.file_path = "res://assets/characters/fox-knight.pxmo"');
    for (const f of GODOT_PLAYER_FILES) expect(await exists(game('addons', 'pixo_motion', f)), f).toBe(true);
    expect(await exists(game('assets', 'characters', 'fox-knight.pxmo'))).toBe(true);
  });

  it('refuses a game without a player, and one that is not there', async () => {
    await mkdir(game(), { recursive: true });
    expect((await call(`/motion/characters/${CHARACTER}/install`, 'POST', { projectId: 'game' })).json.error.code).toBe('MOTION_INSTALL_FAILED');
    expect((await call(`/motion/characters/${CHARACTER}/install`, 'POST', { projectId: 'nothing' })).status).toBe(404);
  });
});

describe('an agent', () => {
  it('reads, downloads and installs into its own game, and proposes', async () => {
    const token = agent();
    expect((await call('/motion/characters', 'GET', undefined, token)).status).toBe(200);
    expect((await call(`/motion/characters/${CHARACTER}/file`, 'GET', undefined, token)).bytes.equals(PXMO)).toBe(true);
    await phaserGame();
    expect((await call(`/motion/characters/${CHARACTER}/install`, 'POST', { projectId: 'game' }, token)).status).toBe(200);
    expect((await call(`/motion/characters/${CHARACTER}/install`, 'POST', { projectId: 'other' }, token)).status).toBe(403);
    const said = await call('/motion/suggestions', 'POST', { projectId: 'game', text: 'a fox knight who guards the gate' }, token);
    expect(said.json).toMatchObject({ projectId: 'game', projectName: 'Foxhole', text: 'a fox knight who guards the gate' });
    expect((await call('/motion/characters')).json.suggestions).toEqual([said.json]);
    await call(`/motion/suggestions/${said.json.id}`, 'DELETE');
    expect((await call('/motion/characters')).json.suggestions).toEqual([]);
  });

  it('never paints, orders, renames or deletes', async () => {
    const token = agent();
    for (const [route, method, body] of [
      ['/motion/portraits', 'POST', { text: 'a fox knight' }], ['/motion/portraits', 'POST', pictureForm(PNG)], ['/motion/jobs', 'POST', { portraitId: PORTRAIT, name: 'Fox', requestId: 'request-1' }],
      [`/motion/characters/${CHARACTER}`, 'PATCH', { name: 'Fox' }], [`/motion/characters/${CHARACTER}`, 'DELETE'],
    ] as const) expect(await call(route, method, body, token), route).toMatchObject({ status: 403, json: { error: { code: 'MOTION_USER_ONLY' } } });
    // a page of another origin neither
    sameOrigin = false;
    expect((await call('/motion/jobs', 'POST', { portraitId: PORTRAIT, name: 'Fox', requestId: 'request-1' })).status).toBe(403);
    expect(asked).toEqual([]);
  });

  it('is told about moving characters only in a build that has them', async () => {
    expect(await facts.promptFacts('game')).toEqual({ installed: [] });
    expect([await facts.promptFacts(null), await facts.promptFacts('nothing')]).toEqual([null, null]);
    available = false;
    expect(await facts.promptFacts('game')).toBeNull();
  });
});
