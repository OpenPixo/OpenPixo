import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { CHARACTER_ERROR_CODES, CHARACTER_SAMPLES, type AnimatedCharacter, type CharacterJob } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountError } from '../../src/account/errors.js';
import { registerCharacterRoutes, type CharacterFacts } from '../../src/character/routes.js';
import { closeDatabase, openDatabase } from '../../src/db.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

const ORIGIN = 'https://characters.test';
const ID = '11111111-2222-4333-8444-555555555555', OTHER = '22222222-2222-4333-8444-555555555555', JOB = '33333333-2222-4333-8444-555555555555', BRIEF = '44444444-2222-4333-8444-555555555555';
const SDK = fileURLToPath(new URL('../../../../game-sdk', import.meta.url));
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const at = '2026-11-25T00:00:00.000Z';

const character = (change: Partial<AnimatedCharacter> = {}): AnimatedCharacter => ({
  id: ID, name: 'Mail Carrier', body: 'angular', style: 'ink', state: 'ready', revision: 1, items: { sets: [{ id: 'set0', label: 'Ice hunter' }], weapons: [{ id: 'weapon0', label: 'Pick' }, { id: 'weapon3', label: 'Sign' }], capes: [], shields: [] },
  outfits: [{ name: 'Patrol', wear: { head: 'set0', weapon: 'weapon0' }, start: true }], motions: [{ name: 'idle', builtIn: true, shown: '', tuning: {} }, { name: 'attack', builtIn: true, shown: '', tuning: { speed: 1.1 } }],
  changed: false, job: null, createdAt: at, updatedAt: at, ...change,
});
const job = (change: Partial<CharacterJob> = {}): CharacterJob => ({ id: JOB, characterId: ID, kind: 'character', state: 'drawing', creditsReserved: 80, creditsCharged: null, delivered: null, errorCode: null, createdAt: at, updatedAt: at, ...change });
const brief = { briefId: BRIEF, kind: 'character', characterId: null, name: 'Mail Carrier', body: 'angular', style: 'ink', shown: { look: 'a carrier', clothes: '', colours: '', gear: '', note: '' }, parts: [{ part: 'hero', credits: 40 }, { part: 'armor', credits: 20 }], credits: 60, available: 500, expiresAt: at };
const gear = { designs: [{ id: 'armor0', kind: 'armor', style: 'ink', madeFor: ID, sets: [{ id: 'set0', label: 'Ice hunter' }], weapons: [], capes: [], shields: [], createdAt: at }], motions: [{ name: 'dodge', shown: 'Dodge', characters: [ID] }] };
/** What the cloud would never send, in every answer. */
const SECRET = { form: 'SECRET', spec: 'SECRET', prompt: 'SECRET', bucketKey: 'SECRET' };

let facts: CharacterFacts, root: string, db: ReturnType<typeof openDatabase>, server: Server, base: string, sameOrigin: boolean, signedIn: boolean, available: boolean, balanceReads: number;
let asked: { route: string; method: string; body: unknown }[], open: string[], sample: boolean, downloads: string[], revision: number, files: Map<string, Buffer>, cloud: (route: string, method: string, body: unknown) => unknown;

const PACKED = { items: { head: ['set0'], body: ['set0'], arm: ['set0'], leg: ['set0'], weapon: ['weapon0', 'weapon3'], cape: [], start: {} }, motions: { idle: {}, attack: {} }, outfits: [{ name: 'Patrol', wear: {} }] };
const packageFiles = (n: number): Map<string, Buffer> => new Map([
  ['hero.json', Buffer.from(JSON.stringify({ format: 'pixo-hero', version: 1, n, ...PACKED }))], ['hero.bin', Buffer.from(`positions ${n}`)], ['portrait.png', Buffer.from('portrait')], ['icon-set0.png', Buffer.from('icon')], ['set0-head.png', Buffer.from('head')],
]);

function answer(route: string, method: string): unknown {
  if (route === 'service') return { ...SECRET, paused: false, priceVersion: 1, prices: { hero: 40, armor: 20, gear: 20, motion: 5 }, tuning: {} };
  if (route === 'characters') return { characters: [{ ...character({ revision }), ...SECRET }] };
  if (route === 'briefs') return { ...brief, ...SECRET };
  if (route === 'jobs' || route.endsWith('/pack')) return { ...job(), ...SECRET };
  if (route === `jobs/${JOB}`) return { ...job({ state: 'succeeded', creditsCharged: 60, delivered: ['hero'] }), ...SECRET };
  if (route === 'gear' || route.startsWith('gear/set') || route.startsWith('gear/motions')) return { ...gear, ...SECRET };
  if (route === 'gear/download') return { baseUrl: `${ORIGIN}/files/gear`, token: 'gear-token', expiresAt: at, files: [{ name: 'set0.png', bytes: 4, sha256: sha(Buffer.from('icon')) }] };
  if (route.endsWith('/download')) return { characterId: ID, revision, baseUrl: `${ORIGIN}/files/${ID}/${revision}`, token: 'package-token', expiresAt: at, files: [...files].map(([name, b]) => ({ name, bytes: b.length, sha256: sha(b) })) };
  if (method === 'DELETE' && route === `characters/${ID}`) return { id: ID, deleted: true };
  if (route.startsWith(`characters/${ID}`)) return { ...character({ revision }), ...SECRET };
  return new Response(JSON.stringify({ error: { code: 'CHARACTER_NOT_FOUND', message: 'SECRET' } }), { status: 404 });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-characters-'));
  db = openDatabase(root, { dataDir: root });
  for (const [id, name] of [['game', 'Frostline'], ['other', 'Other']]) db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, 1, 1);
  sameOrigin = signedIn = available = true;
  balanceReads = 0;
  asked = []; open = []; sample = true; downloads = []; revision = 1; files = packageFiles(1); cloud = answer;
  const app = express();
  app.use(express.json());
  facts = registerCharacterRoutes(app, {
    db, packPollMs: 1, sdkDir: SDK, paths: { RUNTIME_DATA_DIR: root, PROJECTS_DIR: path.join(root, 'projects') } as never,
    http: { requireLocalDaemonRequest: (_q: unknown, _s: unknown, next: () => void) => next(), isLocalSameOrigin: () => sameOrigin, resolvedPortRef: { current: 0 }, sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) } as never,
    authorizeProjectRequest: async () => true, authorizeProjectToolRequest: async () => ({}) as never,
    account: {
      characterOrigin: () => available ? ORIGIN : null, hasSession: async () => signedIn, creditsChanged: () => { balanceReads++; },
      character: async (route, method = 'GET', body) => {
        asked.push({ route, method, body });
        if (!signedIn) throw new AccountError('ACCOUNT_SIGNED_OUT');
        const value = cloud(route, method, body);
        return value instanceof Response ? value : value instanceof Uint8Array ? new Response(value as Uint8Array<ArrayBuffer>) : Response.json(value);
      },
      // as the cloud answers without an account: the sample, or nothing
      characterSample: async (route, method = 'GET') => {
        open.push(`${method} ${route}`);
        const of = /^sample\/([0-9a-f-]+)(\/download)?$/u.exec(route), id = of?.[1] ?? (route === 'sample?language=zh' ? CHARACTER_SAMPLES.zh : route === 'sample?language=en' ? CHARACTER_SAMPLES.en : '');
        if (!sample || !Object.values<string>(CHARACTER_SAMPLES).includes(id)) return new Response(JSON.stringify({ error: { code: 'CHARACTER_NOT_FOUND', message: 'SECRET' } }), { status: 404 });
        if (of?.[2]) return Response.json({ characterId: id, revision: 1, baseUrl: `${ORIGIN}/files/${id}/1`, token: 'package-token', expiresAt: at, files: [...files].map(([name, b]) => ({ name, bytes: b.length, sha256: sha(b) })) });
        return Response.json({ ...character({ id, name: id === CHARACTER_SAMPLES.zh ? '沼地拾荒人' : 'Marsh Scavenger' }), ...SECRET });
      },
    },
    fetchFile: async (url, init) => {
      downloads.push(url);
      const name = new URL(url).pathname.split('/').at(-1)!, token = init.headers.authorization, data = url.includes('/files/gear/') ? Buffer.from('icon') : files.get(name);
      if (token !== (url.includes('/files/gear/') ? 'Bearer gear-token' : 'Bearer package-token') || !data) return new Response(null, { status: 403 });
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

async function call(route: string, method = 'GET', body?: unknown, token?: string): Promise<{ status: number; json: any; bytes: Buffer }> {
  const response = await fetch(`${base}/api${route}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const bytes = Buffer.from(await response.arrayBuffer());
  let json: unknown = null;
  try { json = JSON.parse(bytes.toString()); } catch { /* a file */ }
  expect(bytes.toString('latin1')).not.toContain('SECRET');
  return { status: response.status, json, bytes };
}
const agent = (project = 'game'): string => toolTokenRegistry.mint({ runId: 'run-1', projectId: project, allowedEndpoints: ['/api/tools/media/generate'], allowedOperations: ['media:generate'] } as never).token;
const game = (...parts: string[]): string => path.join(root, 'projects', 'game', ...parts);
async function webGame(): Promise<void> {
  await mkdir(game('src'), { recursive: true });
  await writeFile(game('package.json'), JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { phaser: '3.90.0' }, devDependencies: { vite: '7.0.0', typescript: '5.9.0' } }));
  await writeFile(game('index.html'), '<!doctype html>');
}
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

describe('characters of the account', () => {
  it('says whether there is a service before anything else', async () => {
    expect((await call('/characters/service')).json).toEqual({ available: true, signedIn: true, service: { paused: false, priceVersion: 1, prices: { hero: 40, armor: 20, gear: 20, motion: 5 } } });
    signedIn = false;
    expect((await call('/characters/service')).json).toEqual({ available: true, signedIn: false, service: null });
    available = false;
    expect((await call('/characters/service')).json).toEqual({ available: false, signedIn: false, service: null });
    expect((await call('/characters')).json).toMatchObject({ error: { code: 'CHARACTER_NOT_CONFIGURED' } });
    expect(asked).toHaveLength(1);
  });

  it('lists them with the games they are in, and only fields it knows', async () => {
    expect((await call('/characters')).json).toEqual({ characters: [{ ...character(), games: [] }], suggestions: [] });
    await webGame();
    await call('/projects/game/heroes', 'POST', { characterId: ID });
    revision = 2;
    expect((await call('/characters')).json.characters[0]).toMatchObject({ revision: 2, games: [{ projectId: 'game', projectName: 'Frostline', slug: 'mail-carrier', revision: 1 }] });
    // a game whose folder lost it has it no more
    await rm(game('public', 'characters', 'mail-carrier'), { recursive: true });
    expect((await call(`/characters/${ID}`)).json.games).toEqual([]);
  });

  it('orders with a price that was shown, and lets the balance be read again', async () => {
    expect((await call('/characters/briefs', 'POST', { kind: 'character', text: ' a mail carrier ', armor: true, evil: 1 })).json).toEqual(brief);
    expect(asked.at(-1)).toEqual({ route: 'briefs', method: 'POST', body: { kind: 'character', text: 'a mail carrier', armor: true, gear: false } });
    expect((await call('/characters/orders', 'POST', { briefId: BRIEF, requestId: 'request-1', credits: 1 })).json).toEqual(job());
    expect(asked.at(-1)!.body).toEqual({ briefId: BRIEF, requestId: 'request-1' });
    expect(balanceReads).toBe(1);
    expect((await call(`/characters/jobs/${JOB}`)).json).toMatchObject({ state: 'succeeded', creditsCharged: 60 });
    expect(balanceReads).toBe(2);
    // said once
    await call(`/characters/jobs/${JOB}`);
    expect(balanceReads).toBe(2);
    await call('/characters/briefs', 'POST', { kind: 'armor', characterId: ID, text: 'iron plates', design: 'armor3' });
    expect(asked.at(-1)!.body).toEqual({ kind: 'armor', characterId: ID, text: 'iron plates', armor: false, gear: false });
  });

  it('lets the balance be read again when the list shows that an order ended', async () => {
    cloud = (route, method) => route === 'characters' ? { characters: [character({ state: 'making', job: job() })] } : answer(route, method);
    await call('/characters');
    await call('/characters');
    expect(balanceReads).toBe(0);
    cloud = (route, method) => route === 'characters' ? { characters: [character({ state: 'failed', job: job({ state: 'failed', errorCode: 'CHARACTER_DRAWING_FAILED' }) })] } : answer(route, method);
    await call('/characters');
    await call('/characters');
    expect(balanceReads).toBe(1);
    // free packing moves nothing
    cloud = (route, method) => route === 'characters' ? { characters: [character({ job: job({ kind: 'pack', state: 'packing' }) })] } : answer(route, method);
    await call('/characters');
    cloud = answer;
    await call('/characters');
    expect(balanceReads).toBe(1);
  });

  it('refuses what makes no sense before the cloud is asked', async () => {
    for (const [route, method, body] of [
      ['/characters/briefs', 'POST', { kind: 'boss' }], ['/characters/briefs', 'POST', { kind: 'character', text: 'x' }], ['/characters/briefs', 'POST', { kind: 'character', text: 'x'.repeat(601) }], ['/characters/briefs', 'POST', { kind: 'armor', text: 'iron' }],
      ['/characters/briefs', 'POST', { kind: 'fit', characterId: ID, design: 'armor0', text: 'iron' }], ['/characters/briefs', 'POST', { kind: 'character', text: 'a cook', style: 'photo' }], ['/characters/orders', 'POST', { briefId: BRIEF, requestId: 'short' }], ['/characters/orders', 'POST', { requestId: 'request-1' }],
      [`/characters/${ID}`, 'PATCH', {}], [`/characters/${ID}`, 'PATCH', { name: ' ' }], [`/characters/${ID}`, 'PATCH', { gear: ['../x'] }], [`/characters/${ID}`, 'PATCH', { outfits: [{ name: '' }] }], ['/characters/gear/set0', 'PATCH', { label: '' }],
    ] as const) expect((await call(route, method, body)).status, JSON.stringify(body)).toBe(400);
    for (const [route, method, body] of [['/characters/not-an-id'], [`/characters/${ID}/motions/Bad`, 'PUT', { tuning: {} }], ['/characters/gear/weapon', 'DELETE'], ['/characters/gear/icons/..%2fx.png']] as const) expect((await call(route, method, body)).status, route).toBe(404);
    expect(asked).toEqual([]);
  });

  it('passes on the cloud\'s codes with its own words', async () => {
    for (const code of ['CHARACTER_BUSY', 'CHARACTER_FULL', 'INSUFFICIENT_CREDITS', 'CHARACTER_PAUSED']) {
      cloud = () => new Response(JSON.stringify({ error: { code, message: 'SECRET' } }), { status: 409 });
      expect((await call(`/characters/${ID}`, 'PATCH', { gear: ['set0'] })).json.error).toMatchObject({ code, message: expect.stringMatching(/\w/u) });
    }
    for (const odd of [new Response('SECRET', { status: 500 }), Response.json({ error: { code: 'SECRET' } }, { status: 400 }), Response.json({ ...character(), id: '../x' }), Response.json({ characters: 'SECRET' }), new Response('not json')]) {
      cloud = () => odd;
      expect(await call('/characters')).toMatchObject({ status: 503, json: { error: { code: 'CLOUD_UNAVAILABLE' } } });
    }
    signedIn = false;
    expect(await call('/characters')).toMatchObject({ status: 401, json: { error: { code: 'ACCOUNT_SIGNED_OUT' } } });
    expect(new Set(CHARACTER_ERROR_CODES).size).toBe(CHARACTER_ERROR_CODES.length);
  });

  it('passes on the kinds of gear that were picked, and no others', async () => {
    await call('/characters/briefs', 'POST', { kind: 'character', text: 'a cook', gear: true, types: ['bow', 'shield', 'bow'] });
    expect(asked.at(-1)?.body).toMatchObject({ kind: 'character', gear: true, types: ['bow', 'shield'] });
    const before = asked.length;
    for (const types of ['bow', ['cannon'], [5], Array(9).fill('bow')]) expect((await call('/characters/briefs', 'POST', { kind: 'gear', characterId: ID, text: 'a cook', types })).status).toBe(400);
    expect(asked).toHaveLength(before);
    // a shield goes along into a preview
    cloud = route => route.endsWith('/tune') ? new Response(new Uint8Array([1])) : answer(route, 'GET');
    await call(`/characters/${ID}/tune`, 'POST', { motion: 'attack', tuning: {}, wear: { weapon: 'weapon1', shield: 'shield2', cape: '../x' } });
    expect(asked.at(-1)?.body).toMatchObject({ wear: { weapon: 'weapon1', cape: null, shield: 'shield2' } });
  });

  it('keeps sliders, outfits and gear to what they can be', async () => {
    await call(`/characters/${ID}/motions/attack`, 'PUT', { tuning: { speed: 9, windup: 'x', evil: 1 } });
    expect(asked.at(-1)).toEqual({ route: `characters/${ID}/motions/attack`, method: 'PUT', body: { tuning: { speed: 1.35 } } });
    await call(`/characters/${ID}`, 'PATCH', { outfits: [{ name: 'A', wear: { head: 'set0', evil: 'x', cape: '../x' }, start: true }, { name: 'B', start: true }], gear: ['set0', 'weapon3'] });
    expect(asked.at(-1)!.body).toEqual({ outfits: [{ name: 'A', wear: { head: 'set0' }, start: true }, { name: 'B', wear: {} }], gear: ['set0', 'weapon3'] });
    cloud = route => route.endsWith('/tune') ? new Uint8Array([1, 2, 3]) : answer(route, 'GET');
    const shown = await call(`/characters/${ID}/tune`, 'POST', { motion: 'attack', tuning: { windup: 2 }, wear: { weapon: 'weapon3', head: 'set0' } });
    expect([...shown.bytes]).toEqual([1, 2, 3]);
    expect(asked.at(-1)!.body).toEqual({ motion: 'attack', tuning: { windup: 1.8 }, wear: { weapon: 'weapon3', cape: null, shield: null } });
  });

  it('lets an agent read and change what is free, and nothing that costs, renames or deletes', async () => {
    const token = agent();
    for (const [route, method, body] of [['/characters'], ['/characters/gear'], [`/characters/${ID}`], [`/characters/${ID}`, 'PATCH', { gear: ['set0'] }], [`/characters/${ID}/motions/attack`, 'PUT', { tuning: {} }], [`/characters/${ID}/pack`, 'POST', {}]] as const) expect((await call(route, method, body, token)).status, route).toBe(200);
    const before = asked.length;
    for (const [route, method, body] of [
      ['/characters/briefs', 'POST', { kind: 'character', text: 'a cook' }], ['/characters/orders', 'POST', { briefId: BRIEF, requestId: 'request-1' }], [`/characters/${ID}`, 'DELETE'], [`/characters/${ID}`, 'PATCH', { name: 'Mine' }], ['/characters/gear/set0', 'DELETE'], ['/characters/gear/motions/dodge', 'DELETE'],
    ] as const) expect(await call(route, method, body, token), route).toMatchObject({ status: 403, json: { error: { code: 'CHARACTER_USER_ONLY' } } });
    // a token that is none of ours, and a page that is not ours
    expect((await call('/characters', 'GET', undefined, 'pixott_fake')).status).toBe(403);
    sameOrigin = false;
    expect((await call('/characters/orders', 'POST', { briefId: BRIEF, requestId: 'request-1' })).status).toBe(403);
    expect((await call(`/characters/${ID}`, 'PATCH', { gear: [] })).status).toBe(403);
    expect(asked).toHaveLength(before);
  });
});

describe('packages on this computer', () => {
  const file = (name: string, n = 1): ReturnType<typeof call> => call(`/characters/${ID}/package/${n}/${name}`);

  it('are downloaded once, checked, and served by their revision', async () => {
    const all = await Promise.all(['hero.json', 'hero.bin', 'portrait.png'].map(n => file(n)));
    expect(all.map(r => r.status)).toEqual([200, 200, 200]);
    expect(all[1]!.bytes.toString()).toBe('positions 1');
    expect(downloads).toHaveLength(files.size);
    expect(asked.filter(a => a.route.endsWith('/download'))).toHaveLength(1);
    for (const bad of ['nothing.png', '.whole', '..%2f..%2frecords.json', 'a.exe']) expect((await file(bad)).status, bad).toBe(404);
    expect((await file('hero.json', 7)).status).toBe(404);
    // the next one fetches only what is different
    revision = 2; files = packageFiles(2); downloads = [];
    expect((await file('hero.bin', 2)).bytes.toString()).toBe('positions 2');
    expect(downloads.map(u => u.split('/').at(-1)).sort()).toEqual(['hero.bin', 'hero.json']);
    expect((await file('portrait.png', 2)).bytes.toString()).toBe('portrait');
    expect((await file('hero.bin', 1)).bytes.toString()).toBe('positions 1');
    revision = 3; files = packageFiles(3);
    await file('hero.bin', 3);
    expect((await readdir(path.join(root, 'characters', 'packages', ID))).sort()).toEqual(['2', '3']);
  });

  it('are not there at all when a file is not what it should be', async () => {
    const good = answer;
    cloud = (route, method) => route.endsWith('/download') ? { ...good(route, method) as object, files: [...files].map(([name, b]) => ({ name, bytes: b.length, sha256: sha(Buffer.from(name === 'hero.bin' ? 'other' : b)) })) } : good(route, method);
    expect(await file('hero.json')).toMatchObject({ status: 502, json: { error: { code: 'CHARACTER_DOWNLOAD_FAILED' } } });
    expect(await readdir(path.join(root, 'characters', 'packages', ID))).toEqual([]);
    cloud = answer;
    expect((await file('hero.json')).status).toBe(200);
  });

  it('come from the character service alone, under names that cannot leave the folder', async () => {
    const one = { name: 'hero.json', bytes: 5, sha256: sha(Buffer.from('x')) };
    for (const change of [
      { baseUrl: 'https://evil.test/files' }, { baseUrl: `${ORIGIN}.evil.test/files` }, { baseUrl: 'not a url' }, { baseUrl: `${ORIGIN}/files?x=1` }, { files: [{ ...one, name: '../hero.json' }] }, { files: [{ ...one, name: 'run.exe' }] }, { files: [one, { ...one, name: 'HERO.json' }] },
      { files: [{ ...one, bytes: 1e9 }] }, { files: [{ ...one, sha256: 'x' }] }, { revision: 0 },
    ]) {
      cloud = (route, method) => route.endsWith('/download') ? { ...answer(route, method) as object, ...change } : answer(route, method);
      expect((await file('hero.json')).status, JSON.stringify(change)).toBe(503);
    }
    expect(downloads).toEqual([]);
  });

  it('keeps small pictures by what is in them, so another account\'s are never shown', async () => {
    expect((await call('/characters/gear/icons/set0.png')).bytes.toString()).toBe('icon');
    expect((await call('/characters/gear/icons/set0.png')).status).toBe(200);
    expect(downloads).toEqual([`${ORIGIN}/files/gear/set0.png`]);
    expect((await call('/characters/gear/icons/set9.png')).status).toBe(404);
    expect(await readdir(path.join(root, 'characters', 'icons'))).toEqual([`${sha(Buffer.from('icon'))}.png`]);
  });

  it('goes with a deleted character', async () => {
    await file('hero.json');
    expect((await call(`/characters/${ID}`, 'DELETE')).json).toEqual({ id: ID, deleted: true });
    expect(await exists(path.join(root, 'characters', 'packages', ID))).toBe(false);
  });
});

describe('the free sample', () => {
  it('is there for everyone, can be put into a game, and no account is asked for it', async () => {
    signedIn = false;
    const id = CHARACTER_SAMPLES.zh;
    expect((await call('/characters/sample?language=zh-CN')).json.character).toMatchObject({ id, name: '沼地拾荒人', games: [] });
    expect((await call('/characters/sample')).json.character.id).toBe(CHARACTER_SAMPLES.en);
    expect((await call('/characters/sample?language=..%2F..%2Fcharacters')).json.character.id).toBe(CHARACTER_SAMPLES.en);
    expect((await call(`/characters/${id}`)).json.name).toBe('沼地拾荒人');
    expect((await call(`/characters/${id}/package/1/portrait.png`)).bytes.toString()).toBe('portrait');
    await webGame();
    expect((await call('/projects/game/heroes', 'POST', { characterId: id })).json).toMatchObject({ characterId: id, folder: expect.stringContaining('public/characters/'), playerState: 'written' });
    const { games } = (await call('/characters/sample?language=zh-CN')).json.character, guide = await readFile(game('public', 'characters', games[0].slug, 'README.md'), 'utf8');
    expect(games).toEqual([{ projectId: 'game', projectName: 'Frostline', slug: expect.any(String), revision: 1 }]);
    // its ids are not those of an account
    expect(guide).toContain('Its pieces are its own');
    expect(guide).not.toContain('one inventory serves them all');
    expect(asked).toEqual([]);
    expect(open).toContain(`POST sample/${id}/download`);
    // the account's own stay behind the sign-in
    expect((await call(`/characters/${ID}`)).json.error.code).toBe('ACCOUNT_SIGNED_OUT');
  });

  it('is nobody\'s: nothing of it can be changed', async () => {
    const id = CHARACTER_SAMPLES.en;
    for (const [route, method, body] of [['', 'PATCH', { name: 'Mine' }], ['', 'DELETE', undefined], ['/pack', 'POST', {}], ['/tune', 'POST', { motion: 'run', tuning: {} }], ['/motions/run', 'PUT', { tuning: {} }], ['/motions/run', 'DELETE', undefined]] as const) {
      expect((await call(`/characters/${id}${route}`, method, body)).json.error, `${method} ${route}`).toMatchObject({ code: 'CHARACTER_REQUEST_INVALID', message: expect.stringContaining('free sample cannot be changed') });
    }
    expect((await call('/characters/briefs', 'POST', { kind: 'motion', characterId: id, text: 'waves' })).json.error.message).toContain('free sample');
    expect(asked).toEqual([]);
  });

  it('is one character in both languages: a game has it once, and knows it in either', async () => {
    await webGame();
    await call('/projects/game/heroes', 'POST', { characterId: CHARACTER_SAMPLES.en });
    const zh = (await call('/characters/sample?language=zh')).json.character;
    expect([zh.id, zh.games.map((g: any) => g.slug)]).toEqual([CHARACTER_SAMPLES.zh, ['marsh-scavenger']]);
    expect((await call('/projects/game/heroes', 'POST', { characterId: CHARACTER_SAMPLES.zh })).json).toMatchObject({ slug: 'marsh-scavenger', characterId: CHARACTER_SAMPLES.zh });
    expect((await call('/projects/game/heroes')).json.characters).toHaveLength(1);
    // an own character of that name is another one
    await call('/projects/game/heroes', 'POST', { characterId: ID, slug: 'mail' });
    expect((await call('/projects/game/heroes')).json.characters.map((c: any) => c.slug).sort()).toEqual(['mail', 'marsh-scavenger']);
  });

  it('is told to a run, also when nobody is signed in', async () => {
    await webGame();
    signedIn = false;
    expect(await facts.promptFacts('game')).toBeNull();
    await call('/projects/game/heroes', 'POST', { characterId: CHARACTER_SAMPLES.en });
    expect(await facts.promptFacts('game')).toEqual({ account: false, installed: [{ slug: 'marsh-scavenger', name: 'Marsh Scavenger', folder: 'public/characters/marsh-scavenger', sample: true }] });
  });

  it('may be missing, and without a service nothing is asked', async () => {
    sample = false;
    expect((await call('/characters/sample')).json).toEqual({ character: null });
    available = false;
    open = [];
    expect((await call('/characters/sample')).json).toEqual({ character: null });
    expect(open).toEqual([]);
  });
});

describe('characters in a game', () => {
  const install = (body: Record<string, unknown> = {}, token?: string, project = 'game'): ReturnType<typeof call> => call(`/projects/${project}/heroes`, 'POST', { characterId: ID, ...body }, token);

  it('puts the package and the player into a web game, and brings them up to date', async () => {
    await webGame();
    const first = (await install()).json;
    expect(first).toEqual({ characterId: ID, slug: 'mail-carrier', name: 'Mail Carrier', revision: 1, folder: 'public/characters/mail-carrier', player: 'src/pixo-character.ts', engine: 'web', playerState: 'written' });
    const folder = game('public', 'characters', 'mail-carrier');
    expect((await readdir(folder)).sort()).toEqual(['README.md', 'character.json', 'hero.bin', 'hero.json', 'icon-set0.png', 'portrait.png', 'set0-head.png']);
    expect(JSON.parse(await readFile(path.join(folder, 'character.json'), 'utf8'))).toMatchObject({ format: 'pixo-character', characterId: ID, revision: 1, outfits: [{ name: 'Patrol' }], motions: ['idle', 'attack'] });
    const guide = await readFile(path.join(folder, 'README.md'), 'utf8');
    expect(guide).toContain('There is no jumping motion unless one is listed');
    for (const said of ['`set0` (Ice hunter)', '`weapon3` (Sign)', '`attack`', '`Patrol` (worn at the start)', 'characters/mail-carrier', './pixo-character']) expect(guide).toContain(said);
    const player = await readFile(game('src', 'pixo-character.ts'), 'utf8');
    expect(player).toContain('export class PixoCharacterPack');
    expect((await call('/projects/game/heroes')).json.characters).toEqual([{ characterId: ID, slug: 'mail-carrier', name: 'Mail Carrier', revision: 1, folder: 'public/characters/mail-carrier', player: 'src/pixo-character.ts', engine: 'web' }]);
    // again, with a newer package: nothing of the old one stays, and the folder keeps its name
    await writeFile(path.join(folder, 'left-over.png'), 'x');
    revision = 2; files = packageFiles(2);
    cloud = (route, method) => route === `characters/${ID}` ? character({ name: 'Postmaster', revision: 2 }) : answer(route, method);
    expect((await install()).json).toMatchObject({ slug: 'mail-carrier', revision: 2, playerState: 'same' });
    expect(await exists(path.join(folder, 'left-over.png'))).toBe(false);
    expect((await readdir(game('public', 'characters'))).sort()).toEqual(['mail-carrier']);
  });

  it('packs what was saved first, and tells the game only what is in the package', async () => {
    await webGame();
    let packed = false;
    const saved = { items: { sets: [{ id: 'set0', label: 'Ice hunter' }], weapons: [{ id: 'weapon0', label: 'Pick' }, { id: 'weapon9', label: 'Later' }], capes: [], shields: [{ id: 'shield3', label: 'Unpacked' }] }, motions: [...character().motions, { name: 'dodge', builtIn: false, shown: 'Rolls', tuning: {} }], outfits: [{ name: 'Patrol', wear: {} }, { name: 'Later', wear: {} }] };
    cloud = (route, method) => {
      if (route === `characters/${ID}`) return character({ ...saved, changed: !packed, revision: packed ? 2 : 1 });
      if (route.endsWith('/pack')) { packed = true; revision = 2; files = packageFiles(2); return job({ kind: 'pack' }); }
      if (route === `jobs/${JOB}`) return job({ kind: 'pack', state: 'succeeded', creditsReserved: 0, creditsCharged: 0, delivered: [] });
      return answer(route, method);
    };
    expect((await install({}, agent())).json).toMatchObject({ revision: 2 });
    expect(asked.filter(a => a.route.endsWith('/pack'))).toHaveLength(1);
    const card = JSON.parse(await readFile(game('public', 'characters', 'mail-carrier', 'character.json'), 'utf8')), guide = await readFile(game('public', 'characters', 'mail-carrier', 'README.md'), 'utf8');
    expect([card.items.weapons.map((w: any) => w.id), card.motions, card.outfits.map((o: any) => o.name)]).toEqual([['weapon0'], ['idle', 'attack'], ['Patrol']]);
    for (const later of ['weapon9', 'dodge', 'Later', 'shield']) expect(guide).not.toContain(later);
    packed = false;
    const before = cloud;
    cloud = (route, method, body) => route === `jobs/${JOB}` ? job({ kind: 'pack', state: 'failed', errorCode: 'CHARACTER_PACKING_FAILED' }) : before(route, method, body);
    expect((await install()).json.error.code).toBe('CHARACTER_PACKING_FAILED');
  });

  it('tells the game how weapons of other types and shields are used', async () => {
    await webGame();
    cloud = (route, method) => route === `characters/${ID}` ? { ...character(), items: { ...character().items, weapons: [{ id: 'weapon0', label: 'Pick' }, { id: 'weapon3', label: 'Antler', type: 'bow' }, { id: 'weapon4', label: 'Odd', type: 'whip' }], shields: [{ id: 'shield0', label: 'Lid' }] } } : answer(route, method);
    files = new Map([...packageFiles(1), ['hero.json', Buffer.from(JSON.stringify({ format: 'pixo-hero', version: 1, ...PACKED, items: { ...PACKED.items, weapon: ['weapon0', 'weapon3', 'weapon4'], shield: ['shield0'] } }))]]);
    await install();
    const folder = game('public', 'characters', 'mail-carrier'), guide = await readFile(path.join(folder, 'README.md'), 'utf8');
    for (const said of ['`weapon3` (Antler, bow)', '`weapon4` (Odd)', '`shield0` (Lid)', 'for the slot `shield`', 'with a bow in the hands `attack` shoots', '`hero.shot()`', '`guard`']) expect(guide).toContain(said);
    expect(JSON.parse(await readFile(path.join(folder, 'character.json'), 'utf8')).items.weapons).toEqual([{ id: 'weapon0', label: 'Pick' }, { id: 'weapon3', label: 'Antler', type: 'bow' }, { id: 'weapon4', label: 'Odd' }]);
    // a package without any of it says nothing of it
    cloud = answer; revision = 2; files = packageFiles(2);
    await install();
    for (const left of ['shot()', 'guard', 'punches']) expect(await readFile(path.join(folder, 'README.md'), 'utf8')).not.toContain(left);
  });

  it('leaves a player alone that was changed by hand', async () => {
    await webGame();
    await install();
    const player = game('src', 'pixo-character.ts'), text = await readFile(player, 'utf8');
    await writeFile(player, `${text}\n// mine\n`);
    expect((await install()).json.playerState).toBe('edited');
    expect(await readFile(player, 'utf8')).toContain('// mine');
    await writeFile(player, 'not ours');
    expect((await install()).json.playerState).toBe('edited');
    // an older one of ours is replaced
    const body = 'export const old = 1;\n';
    await writeFile(player, `// Plays OpenPixo characters.\n// openpixo-character sha256=${sha(Buffer.from(body))}\n${body}`);
    expect((await install()).json.playerState).toBe('written');
  });

  it('writes JavaScript for a game without TypeScript', async () => {
    await mkdir(game(), { recursive: true });
    await writeFile(game('package.json'), JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { phaser: '3.90.0' } }));
    await writeFile(game('index.html'), '<!doctype html>');
    expect((await install()).json).toMatchObject({ folder: 'public/characters/mail-carrier', player: 'pixo-character.js' });
    const text = await readFile(game('pixo-character.js'), 'utf8');
    expect(text).not.toMatch(/interface PixoData|: Promise<PixoCharacterPack>/u);
    expect(text).toContain('class PixoCharacterPack');
  });

  it('has Godot leave the files as they are', async () => {
    await mkdir(game(), { recursive: true });
    await writeFile(game('project.godot'), 'config_version=5\n');
    expect((await install()).json).toMatchObject({ folder: 'characters/mail-carrier', player: 'characters/pixo_character.gd', engine: 'godot' });
    expect(await readFile(game('characters', 'mail-carrier', 'portrait.png.import'), 'utf8')).toBe('[remap]\n\nimporter="keep"\n');
    // Godot exports no files of kinds it does not know
    expect(JSON.parse(await readFile(game('characters', 'mail-carrier', 'hero-bin.json'), 'utf8'))).toEqual({ format: 'pixo-hero-bin', data: Buffer.from('positions 1').toString('base64') });
    expect((await readdir(game('characters', 'mail-carrier'))).filter(n => /\.(?:bin|json\.import)$/u.test(n))).toEqual([]);
    expect(await readFile(game('characters', 'pixo_character.gd'), 'utf8')).toMatch(/^# Plays OpenPixo characters[^\n]*\n# openpixo-character sha256=[0-9a-f]{64}\n[\s\S]*class_name PixoCharacter/u);
    expect(await readFile(game('characters', 'mail-carrier', 'README.md'), 'utf8')).toContain('hero.open("res://characters/mail-carrier")');
  });

  it('knows where Unity keeps files a game reads', async () => {
    await mkdir(game('ProjectSettings'), { recursive: true });
    await mkdir(game('Assets'), { recursive: true });
    await writeFile(game('ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.1f1\n');
    expect((await install()).json).toMatchObject({ folder: 'Assets/StreamingAssets/Characters/mail-carrier', player: 'Assets/OpenPixo/PixoCharacter.cs', engine: 'unity' });
    // phones and browsers have no folder to read, and two characters in one place must not mix their parts
    const guide = await readFile(game('Assets', 'StreamingAssets', 'Characters', 'mail-carrier', 'README.md'), 'utf8');
    for (const said of ['hero.Order = 5', 'UnityWebRequest', 'hero.Open(name => bytes[name])']) expect(guide).toContain(said);
    expect(await readFile(game('Assets', 'OpenPixo', 'PixoCharacter.cs'), 'utf8')).toContain('[RequireComponent(typeof(SortingGroup))]');
  });

  it('never replaces a folder that is something else, and gives two characters of one name two folders', async () => {
    await webGame();
    await mkdir(game('public', 'characters', 'mail-carrier'), { recursive: true });
    await writeFile(game('public', 'characters', 'mail-carrier', 'mine.txt'), 'x');
    expect((await install()).json.slug).toBe('mail-carrier-2');
    expect(await exists(game('public', 'characters', 'mail-carrier', 'mine.txt'))).toBe(true);
    expect((await install({ slug: 'mail-carrier' })).json.error.code).toBe('CHARACTER_INSTALL_FAILED');
    expect((await install({ slug: '../x' })).status).toBe(400);
    // another name moves it
    expect((await install({ slug: 'postman' })).json.slug).toBe('postman');
    expect((await call('/projects/game/heroes')).json.characters.map((c: any) => c.slug)).toEqual(['postman']);
    cloud = (route, method) => route === `characters/${ID}` ? character({ name: '邮差' }) : answer(route, method);
    await call('/projects/game/heroes/postman', 'DELETE');
    expect((await install()).json.slug).toBe('character-111111');
    expect((await call('/projects/game/heroes/mail-carrier', 'DELETE')).status).toBe(404);
  });

  it('says what to do when there is no engine, or none with a player', async () => {
    expect((await install()).json.error).toMatchObject({ code: 'CHARACTER_INSTALL_FAILED', message: expect.stringContaining('Set the game up first') });
    await mkdir(game(), { recursive: true });
    await writeFile(game('Game.rmmzproject'), 'RPGMZ 1.8.0');
    await mkdir(game('js'), { recursive: true });
    expect((await install()).json.error).toMatchObject({ code: 'CHARACTER_INSTALL_FAILED', message: expect.stringContaining('Godot, Unity and web games') });
  });

  it('tells a run what is in its game, and nothing when the user cannot have characters', async () => {
    await webGame();
    expect(await facts.promptFacts('game')).toEqual({ installed: [], account: true });
    await install();
    const installed = [{ slug: 'mail-carrier', name: 'Mail Carrier', folder: 'public/characters/mail-carrier' }];
    expect(await facts.promptFacts('game')).toEqual({ installed, account: true });
    expect([await facts.promptFacts(null), await facts.promptFacts('nothing')]).toEqual([null, null]);
    // what is in the game is still there for someone who signed out; a game with nothing in it is told nothing
    signedIn = false;
    expect(await facts.promptFacts('game')).toEqual({ installed, account: false });
    expect(await facts.promptFacts('other')).toBeNull();
    signedIn = true; available = false;
    expect(await facts.promptFacts('game')).toBeNull();
  });

  it('lets an agent work in its own game, once its plan is approved, and propose a character', async () => {
    await webGame();
    expect((await install({}, agent())).status).toBe(200);
    expect((await install({}, agent('other'))).status).toBe(403);
    const said = await call('/projects/game/heroes/suggest', 'POST', { text: 'a grumpy beekeeper', armor: true, gear: true, style: 'cute' }, agent());
    expect(said.json).toMatchObject({ projectId: 'game', projectName: 'Frostline', text: 'a grumpy beekeeper', style: 'cute', armor: true, gear: true });
    await call('/projects/game/heroes/suggest', 'POST', { text: 'a grumpy beekeeper', armor: false }, agent());
    expect((await call('/characters')).json.suggestions).toMatchObject([{ id: said.json.id, armor: false }]);
    // nothing was ordered or even priced
    expect(asked.some(a => a.route === 'briefs' || a.route === 'jobs')).toBe(false);
    expect((await call(`/characters/suggestions/${said.json.id}`, 'DELETE')).status).toBe(200);
    expect((await call('/characters')).json.suggestions).toEqual([]);
    db.prepare('UPDATE projects SET metadata_json = ? WHERE id = ?').run(JSON.stringify({ kind: 'prototype', gamePlan: { status: 'planning' } }), 'game');
    expect(await install({}, agent())).toMatchObject({ status: 403, json: { error: { code: 'CHARACTER_USER_ONLY' } } });
    expect((await install()).status).toBe(200);
  });
});
