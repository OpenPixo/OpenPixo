import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineEmulator } from '../../src/online/emulator.js';
import { ONLINE_SDK_RELATIVE_PATH, renderOnlineSdk } from '../../src/online/sdk-install.js';
import { localOnlineEmulatorUrl, registerLocalOnlineEmulator } from '../../src/routes/online-local.js';

const SDK_DIR = path.resolve(import.meta.dirname, '../../../../game-sdk');

/** The public surface, typed here so this runs the real installed JavaScript and not a TypeScript import. */
interface Online {
  me(): Promise<{ id: string; name: string; nameZh: string }>;
  put(collection: string, data: unknown, options?: { key?: string; score?: number | null }): Promise<any>;
  get(collection: string, options?: { player?: string; key?: string }): Promise<any>;
  top(collection: string, options?: Record<string, unknown>): Promise<any[]>;
  rank(collection: string, options?: Record<string, unknown>): Promise<{ rank: number; total: number } | null>;
  pick(collection: string, options?: Record<string, unknown>): Promise<any>;
  recordMatch(match: unknown, result: string): Promise<{ you: number; opponent: number }>;
  send(player: string, data: unknown): Promise<void>;
  inbox(options?: { limit?: number }): Promise<any[]>;
  remove(collection: string, options?: { key?: string }): Promise<boolean>;
  forgetMe(): Promise<void>;
}
interface Sdk { online: Online; OnlineError: new (code: string) => Error & { code: string; detail?: string } }

let file: string;
let directory: string;
let dataDir: string;
let server: Server;
let base: string;
let emulator: OnlineEmulator;
let loads = 0;

/** A fresh copy of the SDK module, as a second browser would have. */
const load = async () => await import(/* @vite-ignore */ `${pathToFileURL(file).href}?copy=${loads += 1}`) as Sdk;

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, values };
}

function page(href: string, storage = memoryStorage()) {
  vi.stubGlobal('location', { href });
  vi.stubGlobal('localStorage', storage);
  return storage;
}

const testPage = (project = 'game') => `http://127.0.0.1:5173/?pixoOnline=${encodeURIComponent(localOnlineEmulatorUrl(Number(new URL(base).port), project))}`;

async function caught(promise: Promise<unknown>): Promise<Error & { code: string; detail?: string }> {
  try { await promise; } catch (error) { return error as Error & { code: string }; }
  throw new Error('expected a refusal');
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'openpixo-online-sdk-'));
  file = path.join(directory, 'openpixo-online.mjs');
  await writeFile(file, renderOnlineSdk(await readFile(path.join(SDK_DIR, ONLINE_SDK_RELATIVE_PATH), 'utf8'), 'js'));
});

afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'openpixo-online-sdk-data-'));
  emulator = new OnlineEmulator({ dataDir });
  const app = express();
  registerLocalOnlineEmulator(app, { emulator, hasProject: id => id === 'game' || id === 'other' });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
  emulator.dispose();
  await rm(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('online over the local emulator', () => {
  it('registers on first use and keeps the player in localStorage', async () => {
    const storage = page(testPage());
    const { online } = await load();
    const me = await online.me();
    expect(me).toEqual({ id: expect.any(String), name: expect.stringMatching(/^\w+ \w+ \d+$/u), nameZh: expect.any(String) });
    expect([...storage.values.keys()]).toEqual(['openpixo-online-token:local:/api/online/local/game']);
    const again = await load();
    expect((await again.online.me()).id).toBe(me.id);
  });

  it('keeps the same player when the daemon port changes', async () => {
    const storage = page(testPage());
    const id = (await (await load()).online.me()).id;
    page(testPage().replace(/127\.0\.0\.1%3A\d+/u, `localhost%3A${new URL(base).port}`), storage);
    expect((await (await load()).online.me()).id).toBe(id);
  });

  it('runs a leaderboard: put, top, rank and get', async () => {
    page(testPage());
    const { online } = await load();
    const me = await online.me();
    const doc = await online.put('ghosts', { frames: [1, 2] }, { key: 'track-1', score: 83.21 });
    expect(doc).toMatchObject({ player: me.id, name: me.name, collection: 'ghosts', key: 'track-1', score: 83.21, rating: 1000 });
    emulator.seed('game', { players: 5 });
    const best = await online.top('ghosts', { key: 'track-1', by: 'score', order: 'asc', limit: 10 });
    expect(best).toHaveLength(6);
    expect(best.map(item => item.score)).toEqual([...best.map(item => item.score)].sort((a, b) => a - b));
    expect(await online.rank('ghosts', { key: 'track-1', by: 'score', order: 'asc' })).toEqual({ rank: expect.any(Number), total: 6 });
    expect(await online.rank('ghosts', { key: 'track-2' })).toBeNull();
    expect((await online.get('ghosts', { player: best[0].player, key: 'track-1' })).data).toEqual({ frames: [1, 2] });
    expect((await online.get('ghosts', { key: 'track-1' })).player).toBe(me.id);
    expect(await online.remove('ghosts', { key: 'track-1' })).toBe(true);
    expect(await online.get('ghosts', { key: 'track-1' })).toBeNull();
  });

  it('plays an async battle between two browsers: pick, recordMatch, send and inbox', async () => {
    page(testPage());
    const defender = await load();
    const defenderId = (await defender.online.me()).id;
    await defender.online.put('teams', { units: ['knight', 'archer'] });

    page(testPage());
    const attacker = await load();
    await attacker.online.put('teams', { units: ['mage'] });
    const match = await attacker.online.pick('teams', { by: 'rating' });
    expect(match).toMatchObject({ matchId: expect.any(String), doc: { player: defenderId, data: { units: ['knight', 'archer'] } } });
    expect(await attacker.online.recordMatch(match, 'win')).toEqual({ you: 1016, opponent: 984 });
    expect((await caught(attacker.online.recordMatch(match, 'win'))).code).toBe('match-expired');
    await attacker.online.send(match.doc.player, { kind: 'attacked', won: false });

    const news = await defender.online.inbox();
    expect(news).toEqual([expect.objectContaining({ data: { kind: 'attacked', won: false }, fromName: expect.any(String) })]);
    expect((await defender.online.get('teams')).rating).toBe(984);
  });

  it('starts a new player after forgetMe, and after the test data is reset', async () => {
    const storage = page(testPage());
    const { online } = await load();
    const first = (await online.me()).id;
    await online.put('saves', { level: 2 });
    await online.forgetMe();
    expect(storage.values.size).toBe(0);
    const second = (await online.me()).id;
    expect(second).not.toBe(first);
    emulator.reset('game');
    // The emulator no longer knows the token; the SDK registers again instead of failing.
    expect(await online.get('saves')).toBeNull();
    expect((await online.me()).id).not.toBe(second);
  });

  it('throws OnlineError with a player-facing message and the server detail', async () => {
    page(testPage());
    const { online, OnlineError } = await load();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const badName = await caught(online.put('High Scores', 1));
    expect(badName).toBeInstanceOf(OnlineError);
    expect(badName).toMatchObject({ code: 'bad-request', message: expect.stringContaining('could not use'), detail: expect.stringContaining('lowercase') });
    expect((await caught(online.put('big', 'x'.repeat(70_000)))).code).toBe('too-large');
    expect((await caught(online.send('someone', 'x'.repeat(3_000)))).code).toBe('too-large');
    expect(fetchSpy).not.toHaveBeenCalled();
    const unknown = await caught(online.send('nobody', { hi: 1 }));
    expect(unknown).toMatchObject({ code: 'not-found', message: 'That player or entry is no longer online.', detail: 'No player has that id.' });
  });

  it('retries an unavailable service once', async () => {
    page(testPage());
    const { online } = await load();
    await online.me();
    const real = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('network down'))
      .mockImplementation((...args) => real(...args));
    expect(await online.put('saves', 1)).toMatchObject({ data: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockReset();
    fetchSpy.mockRejectedValue(new TypeError('network down'));
    expect((await caught(online.top('saves'))).code).toBe('unavailable');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('choosing a backend', () => {
  it('explains a loopback page without a test link', async () => {
    page('http://localhost:5173/');
    const error = await caught((await load()).online.me());
    expect(error).toMatchObject({ code: 'emulator-missing', message: expect.stringContaining('pixo online test') });
  });

  it('will not send a local game to a server elsewhere', async () => {
    page(`http://127.0.0.1:5173/?pixoOnline=${encodeURIComponent('https://evil.example/api/online/local/game')}`);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await caught((await load()).online.me())).code).toBe('emulator-invalid');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses the game\'s own origin once published', async () => {
    page('https://abc123.play.example/index.html');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { op: string };
      return Response.json(body.op === 'register'
        ? { ok: true, player: { id: 'p1', name: 'Brave Fox 1', nameZh: '勇敢的狐狸 1' }, token: 'secret' }
        : { ok: false, error: { code: 'read-only', message: 'Monthly allowance used.' } }, { status: body.op === 'register' ? 200 : 403 });
    });
    const { online } = await load();
    const error = await caught(online.put('scores', 1, { score: 5 }));
    expect(error).toMatchObject({ code: 'read-only', message: expect.stringContaining('can still be viewed') });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/__online/v1', '/__online/v1']);
    expect(fetchSpy.mock.calls[1]![1]).toMatchObject({ headers: { Authorization: 'Bearer secret' } });
    expect(JSON.parse(String(fetchSpy.mock.calls[1]![1]!.body))).toEqual({ v: 1, op: 'put', collection: 'scores', data: 1, score: 5 });
  });

  it('reads a paused backend 503 body, even at registration, without retrying', async () => {
    page('https://abc123.play.example/');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ ok: false, error: { code: 'paused', message: 'Online features are paused.' } }, { status: 503 }));
    const error = await caught((await load()).online.top('scores'));
    expect(error).toMatchObject({ code: 'paused', message: 'Online features are not open yet. Try again later.', detail: 'Online features are paused.' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps projects apart on the same dev server', async () => {
    page(testPage('game'));
    await (await load()).online.put('scores', 1, { score: 1 });
    page(testPage('other'));
    expect(await (await load()).online.top('scores')).toEqual([]);
  });
});
