import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ONLINE_MAX_DOC_BYTES, ONLINE_MAX_INBOX_BYTES, onlinePlayerName, type OnlineDoc, type OnlineResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eloChange, ONLINE_LOCAL_LIMITS, OnlineEmulator } from '../../src/online/emulator.js';

/** Conformance with specs/current/online-features.md, which the hosted backend implements too. */

let dataDir: string;
let clock: number;
let emulator: OnlineEmulator;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'openpixo-online-'));
  clock = Date.UTC(2026, 10, 9, 12);
  emulator = new OnlineEmulator({ dataDir, now: () => clock, requestsPerMinutePerPlayer: 10_000 });
});

afterEach(async () => {
  emulator.dispose();
  await rm(dataDir, { recursive: true, force: true });
});

type Ok = Record<string, any> & { ok: true };
const send = (token: string | null, body: Record<string, unknown>, project = 'game'): OnlineResponse =>
  emulator.handle(project, { v: 1, ...body }, token);
function ok(token: string | null, body: Record<string, unknown>, project?: string): Ok {
  const reply = send(token, body, project);
  if (!reply.ok) throw new Error(`${String(body.op)} refused: ${reply.error.code} ${reply.error.message}`);
  return reply as Ok;
}
function refused(token: string | null, body: Record<string, unknown>): string {
  const reply = send(token, body);
  if (reply.ok) throw new Error(`${String(body.op)} was accepted`);
  expect(reply.error.message).toEqual(expect.any(String));
  return reply.error.code;
}
const register = (project?: string) => ok(null, { op: 'register' }, project) as Ok & { token: string; player: { id: string; name: string; nameZh: string } };

describe('players', () => {
  it('registers anonymous players with generated names and knows them by token', () => {
    const first = register();
    expect(first.player).toEqual({ id: expect.any(String), name: expect.stringMatching(/^\w+ \w+ \d+$/u), nameZh: expect.any(String) });
    expect(first.player.id).toMatch(/^p[a-z0-9]{15}$/u);
    expect(first.token).toHaveLength(40);
    // Only the token's hash is kept.
    const stored = emulator['db']('game').prepare('select token_hash from players where id = ?').get(first.player.id) as { token_hash: string };
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(stored.token_hash).not.toContain(first.token);
    expect(ok(first.token, { op: 'me' }).player).toEqual(first.player);
    expect(register().player.id).not.toBe(first.player.id);
  });

  it('refuses a missing or unknown token and a different protocol', () => {
    expect(refused(null, { op: 'me' })).toBe('unauthorized');
    expect(refused('nope', { op: 'me' })).toBe('unauthorized');
    const { token } = register();
    expect(emulator.handle('game', { v: 2, op: 'me' }, token)).toMatchObject({ ok: false, error: { code: 'protocol-mismatch' } });
    expect(refused(token, { op: 'launch' })).toBe('bad-request');
  });

  it('keeps each project apart', () => {
    const { token } = register('one');
    ok(token, { op: 'put', collection: 'scores', data: 1, score: 5 }, 'one');
    expect(send(token, { op: 'me' }, 'two')).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(emulator.summary('two')).toEqual({ players: 0, collections: {} });
    expect(emulator.summary('one')).toEqual({ players: 1, collections: { scores: 1 } });
  });

  it('stores one SQLite file per project under the data root it was given', async () => {
    register('game-a');
    expect(await readdir(path.join(dataDir, 'online'))).toContain('game-a.sqlite');
    expect(() => emulator.handle('../escape', { v: 1, op: 'register' }, null)).not.toThrow();
    expect(emulator.handle('../escape', { v: 1, op: 'register' }, null)).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('limits each player to 60 requests a minute', () => {
    emulator.dispose();
    emulator = new OnlineEmulator({ dataDir, now: () => clock });
    const { token } = register();
    for (let index = 0; index < ONLINE_LOCAL_LIMITS.requestsPerMinutePerPlayer; index += 1) ok(token, { op: 'me' });
    expect(refused(token, { op: 'me' })).toBe('too-fast');
    clock += 60_001;
    expect(ok(token, { op: 'me' }).ok).toBe(true);
  });
});

describe('documents', () => {
  it('puts, gets and replaces a document, with key main by default', () => {
    const me = register();
    const { doc } = ok(me.token, { op: 'put', collection: 'saves', data: { level: 3 } });
    expect(doc).toEqual({ player: me.player.id, name: me.player.name, nameZh: me.player.nameZh, collection: 'saves', key: 'main',
      data: { level: 3 }, score: null, rating: 1000, updatedAt: new Date(clock).toISOString() } satisfies OnlineDoc);
    clock += 1000;
    ok(me.token, { op: 'put', collection: 'saves', data: { level: 4 }, score: 12.5 });
    const other = register();
    expect(ok(other.token, { op: 'get', collection: 'saves', player: me.player.id }).doc).toMatchObject({ data: { level: 4 }, score: 12.5, updatedAt: new Date(clock).toISOString() });
    expect(ok(other.token, { op: 'get', collection: 'saves', player: me.player.id, key: 'slot-2' }).doc).toBeNull();
  });

  it('removes a document and reports whether there was one', () => {
    const { token } = register();
    ok(token, { op: 'put', collection: 'saves', key: 'slot-1', data: 1 });
    expect(ok(token, { op: 'remove', collection: 'saves', key: 'slot-1' }).removed).toBe(true);
    expect(ok(token, { op: 'remove', collection: 'saves', key: 'slot-1' }).removed).toBe(false);
  });

  it.each([
    [{ collection: 'Scores', data: 1 }], [{ collection: 's'.repeat(41), data: 1 }], [{ collection: 'ok', key: 'a b', data: 1 }],
    [{ collection: 'ok' }], [{ collection: 'ok', data: 1, score: 'high' }], [{ collection: 'ok', data: 1, score: Number.NaN }],
  ])('refuses the put %j as a bad request', body => {
    const { token } = register();
    expect(refused(token, { op: 'put', ...body })).toBe('bad-request');
  });

  it('holds a document to 64 KB serialized', () => {
    const { token } = register();
    const fits = 'x'.repeat(ONLINE_MAX_DOC_BYTES - 2);
    expect(ok(token, { op: 'put', collection: 'big', data: fits }).doc.data).toBe(fits);
    expect(refused(token, { op: 'put', collection: 'big', data: `${fits}x` })).toBe('too-large');
    // Bytes, not characters.
    expect(refused(token, { op: 'put', collection: 'big', data: '狐'.repeat(22_000) })).toBe('too-large');
  });

  it('allows 20 collections per game and 50 keys per player per collection', () => {
    const { token } = register();
    for (let index = 0; index < ONLINE_LOCAL_LIMITS.maxCollections; index += 1) ok(token, { op: 'put', collection: `c${index}`, data: 1 });
    expect(refused(token, { op: 'put', collection: 'one-more', data: 1 })).toBe('too-large');
    for (let index = 1; index < ONLINE_LOCAL_LIMITS.maxKeysPerPlayerPerCollection; index += 1) ok(token, { op: 'put', collection: 'c0', key: `k${index}`, data: 1 });
    expect(refused(token, { op: 'put', collection: 'c0', key: 'k-over', data: 1 })).toBe('too-large');
    // Replacing an existing key is not a new one.
    expect(ok(token, { op: 'put', collection: 'c0', key: 'k1', data: 2 }).doc.data).toBe(2);
    // Another player still has room in the same collection.
    expect(ok(register().token, { op: 'put', collection: 'c0', data: 1 }).ok).toBe(true);
  });
});

describe('top and rank', () => {
  function board(scores: (number | null)[]) {
    return scores.map(score => {
      const player = register();
      clock += 1;
      ok(player.token, { op: 'put', collection: 'laps', key: 'track-1', data: { score }, ...(score === null ? {} : { score }) });
      return player;
    });
  }

  it('orders by score, highest first by default, leaving out entries without a score', () => {
    board([10, 30, null, 20]);
    const viewer = register();
    const docs = ok(viewer.token, { op: 'top', collection: 'laps', key: 'track-1' }).docs as OnlineDoc[];
    expect(docs.map(doc => doc.score)).toEqual([30, 20, 10]);
    const asc = ok(viewer.token, { op: 'top', collection: 'laps', key: 'track-1', order: 'asc', limit: 2 }).docs as OnlineDoc[];
    expect(asc.map(doc => doc.score)).toEqual([10, 20]);
  });

  it('gives a tie to whoever got there first, the same way in top and rank', () => {
    const [early, late] = board([50, 50]);
    expect((ok(early!.token, { op: 'top', collection: 'laps', key: 'track-1' }).docs as OnlineDoc[]).map(doc => doc.player)).toEqual([early!.player.id, late!.player.id]);
    expect(ok(early!.token, { op: 'rank', collection: 'laps', key: 'track-1' })).toMatchObject({ rank: 1, total: 2 });
    expect(ok(late!.token, { op: 'rank', collection: 'laps', key: 'track-1' })).toMatchObject({ rank: 2, total: 2 });
  });

  it('ranks the caller, ascending for lap times, and has no rank without an entry', () => {
    const players = board([83.2, 79.9, 90.1]);
    expect(ok(players[0]!.token, { op: 'rank', collection: 'laps', key: 'track-1', order: 'asc' })).toEqual({ ok: true, rank: 2, total: 3 });
    expect(ok(players[0]!.token, { op: 'rank', collection: 'laps', key: 'track-1' })).toEqual({ ok: true, rank: 2, total: 3 });
    expect(ok(players[2]!.token, { op: 'rank', collection: 'laps', key: 'track-1', order: 'asc' })).toEqual({ ok: true, rank: 3, total: 3 });
    expect(ok(register().token, { op: 'rank', collection: 'laps', key: 'track-1' })).toEqual({ ok: true, rank: null, total: 3 });
  });

  it('caps a query at 100 results and refuses a bad limit, field or order', () => {
    board(Array.from({ length: 105 }, (_, index) => index));
    const { token } = register();
    expect(ok(token, { op: 'top', collection: 'laps', key: 'track-1', limit: 500 }).docs).toHaveLength(100);
    expect(refused(token, { op: 'top', collection: 'laps', key: 'track-1', limit: 0 })).toBe('bad-request');
    expect(refused(token, { op: 'top', collection: 'laps', key: 'track-1', limit: 2.5 })).toBe('bad-request');
    expect(refused(token, { op: 'top', collection: 'laps', by: 'name' })).toBe('bad-request');
    expect(refused(token, { op: 'rank', collection: 'laps', order: 'up' })).toBe('bad-request');
  });

  it('sorts by rating when asked', () => {
    const players = board([1, 2, 3]);
    const { token } = register();
    const docs = ok(token, { op: 'top', collection: 'laps', key: 'track-1', by: 'rating' }).docs as OnlineDoc[];
    expect(docs).toHaveLength(3);
    expect(docs.every(doc => doc.rating === 1000)).toBe(true);
    expect(players).toHaveLength(3);
  });
});

describe('pick and recordMatch', () => {
  function team(rating?: number) {
    const player = register();
    ok(player.token, { op: 'put', collection: 'teams', data: { units: ['knight'] } });
    if (rating !== undefined) {
      // Ratings only move through matches; set one directly for the test.
      emulator['db']('game').prepare('update docs set rating = ? where player = ?').run(rating, player.player.id);
    }
    return player;
  }

  it('hands out another player near the caller, never the caller, or null', () => {
    const me = team();
    expect(ok(me.token, { op: 'pick', collection: 'teams' }).match).toBeNull();
    // Two pools' worth of close opponents and more far away: only close ones are handed out, none twice.
    const near = new Set(Array.from({ length: ONLINE_LOCAL_LIMITS.pickPool * 2 }, (_, index) => team(990 + index * 2).player.id));
    for (let index = 0; index < ONLINE_LOCAL_LIMITS.pickCandidates; index += 1) team(1600 + index);
    const handed = new Set<string>();
    for (let round = 0; round < ONLINE_LOCAL_LIMITS.pickPool; round += 1) {
      const { match } = ok(me.token, { op: 'pick', collection: 'teams' });
      expect(match).toEqual({ matchId: expect.any(String), doc: expect.objectContaining({ collection: 'teams', key: 'main', data: { units: ['knight'] } }) });
      expect(match.doc.player).not.toBe(me.player.id);
      expect(near.has(match.doc.player)).toBe(true);
      expect(handed.has(match.doc.player)).toBe(false);
      handed.add(match.doc.player);
    }
  });

  it('takes the 5 nearest of those not handed out in the last day', () => {
    const me = team(1000);
    const ranked = [1001, 1002, 1003, 1004, 1005, 1006].map(rating => team(rating).player.id);
    // The nearest five were all handed out an hour ago; the sixth is the only fresh one near.
    const db = emulator['db']('game');
    for (const opponent of ranked.slice(0, 5)) {
      db.prepare('insert into matches (id, player, collection, opponent, key, created_at, used) values (?, ?, ?, ?, ?, ?, 1)')
        .run(`old-${opponent}`, me.player.id, 'teams', opponent, 'main', clock - 60 * 60_000);
    }
    expect(ok(me.token, { op: 'pick', collection: 'teams' }).match.doc.player).toBe(ranked[5]);
    clock += ONLINE_LOCAL_LIMITS.pickRecentMs;
    db.prepare('delete from matches where id not like ?').run('old-%');
    const later = new Set(Array.from({ length: 12 }, () => ok(me.token, { op: 'pick', collection: 'teams' }).match.doc.player));
    expect([...later].some(id => ranked.slice(0, 5).includes(id))).toBe(true);
  });

  it('prefers players it has not handed out recently', () => {
    const me = team();
    const a = team(1000);
    const b = team(1000);
    const first = ok(me.token, { op: 'pick', collection: 'teams' }).match.doc.player;
    const second = ok(me.token, { op: 'pick', collection: 'teams' }).match.doc.player;
    expect(new Set([first, second])).toEqual(new Set([a.player.id, b.player.id]));
    // Everyone was picked recently, even an hour later: it falls back to the nearest rather than finding nobody.
    clock += 60 * 60_000;
    expect([a.player.id, b.player.id]).toContain(ok(me.token, { op: 'pick', collection: 'teams' }).match.doc.player);
  });

  it('picks by score near the caller\'s own score', () => {
    const me = register();
    ok(me.token, { op: 'put', collection: 'runs', data: 1, score: 500 });
    const close = new Set(Array.from({ length: ONLINE_LOCAL_LIMITS.pickPool * 2 }, (_, index) => {
      const player = register();
      ok(player.token, { op: 'put', collection: 'runs', data: 1, score: 495 + index });
      return player.player.id;
    }));
    for (let index = 0; index < ONLINE_LOCAL_LIMITS.pickPool; index += 1) ok(register().token, { op: 'put', collection: 'runs', data: 1, score: 5000 + index });
    for (let round = 0; round < ONLINE_LOCAL_LIMITS.pickPool; round += 1) expect(close.has(ok(me.token, { op: 'pick', collection: 'runs', by: 'score' }).match.doc.player)).toBe(true);
  });

  it('updates both ratings with Elo, K 32, in whole numbers, once', () => {
    const me = team();
    const them = team();
    const { match } = ok(me.token, { op: 'pick', collection: 'teams' });
    expect(ok(me.token, { op: 'recordMatch', matchId: match.matchId, result: 'win' })).toEqual({ ok: true, you: 1016, opponent: 984 });
    expect(ok(them.token, { op: 'get', collection: 'teams', player: them.player.id }).doc.rating).toBe(984);
    expect(ok(me.token, { op: 'get', collection: 'teams', player: me.player.id }).doc.rating).toBe(1016);
    expect(refused(me.token, { op: 'recordMatch', matchId: match.matchId, result: 'win' })).toBe('match-expired');
  });

  it.each([
    [1000, 1000, 'win', 16], [1000, 1000, 'loss', -16], [1000, 1000, 'draw', 0],
    [1200, 1000, 'win', 8], [1000, 1200, 'win', 24], [1000, 1200, 'draw', 8], [1400, 1000, 'loss', -29],
  ] as const)('Elo change for %i against %i on a %s is %i', (yours, theirs, result, change) => {
    expect(eloChange(yours, theirs, result)).toBe(change);
  });

  it('refuses a match after 30 minutes, from another player, unknown, or with a bad result', () => {
    const me = team();
    team();
    const other = team();
    const { match } = ok(me.token, { op: 'pick', collection: 'teams' });
    expect(refused(other.token, { op: 'recordMatch', matchId: match.matchId, result: 'win' })).toBe('match-expired');
    expect(refused(me.token, { op: 'recordMatch', matchId: 'made-up', result: 'win' })).toBe('match-expired');
    expect(refused(me.token, { op: 'recordMatch', matchId: match.matchId, result: 'victory' })).toBe('bad-request');
    clock += 30 * 60_000;
    expect(refused(me.token, { op: 'recordMatch', matchId: match.matchId, result: 'win' })).toBe('match-expired');
  });

  it('needs the caller\'s own entry to record a match', () => {
    const me = register();
    team();
    const { match } = ok(me.token, { op: 'pick', collection: 'teams' });
    expect(match).not.toBeNull();
    expect(refused(me.token, { op: 'recordMatch', matchId: match.matchId, result: 'loss' })).toBe('not-found');
  });

  it('does not let put change a rating', () => {
    const me = team();
    const them = team();
    const { match } = ok(me.token, { op: 'pick', collection: 'teams' });
    ok(me.token, { op: 'recordMatch', matchId: match.matchId, result: 'loss' });
    ok(them.token, { op: 'put', collection: 'teams', data: { units: [] }, rating: 5000 });
    expect(ok(them.token, { op: 'get', collection: 'teams', player: them.player.id }).doc.rating).toBe(1016);
  });
});

describe('inbox', () => {
  it('delivers newest first with the sender\'s names', () => {
    const me = register();
    const friend = register();
    ok(friend.token, { op: 'send', to: me.player.id, data: { kind: 'attacked', won: false } });
    clock += 1;
    ok(friend.token, { op: 'send', to: me.player.id, data: { kind: 'attacked', won: true } });
    const { messages } = ok(me.token, { op: 'inbox' });
    expect(messages).toEqual([
      { id: expect.any(Number), from: friend.player.id, fromName: friend.player.name, fromNameZh: friend.player.nameZh, data: { kind: 'attacked', won: true }, createdAt: new Date(clock).toISOString() },
      expect.objectContaining({ data: { kind: 'attacked', won: false } }),
    ]);
    expect(ok(me.token, { op: 'inbox', limit: 1 }).messages).toHaveLength(1);
  });

  it('keeps the newest 50 per player and holds a message to 2 KB', () => {
    const me = register();
    const friend = register();
    for (let index = 0; index < 55; index += 1) ok(friend.token, { op: 'send', to: me.player.id, data: index });
    const { messages } = ok(me.token, { op: 'inbox', limit: 100 });
    expect(messages).toHaveLength(ONLINE_LOCAL_LIMITS.inboxKept);
    expect(messages[0].data).toBe(54);
    expect(messages.at(-1).data).toBe(5);
    expect(refused(friend.token, { op: 'send', to: me.player.id, data: 'x'.repeat(ONLINE_MAX_INBOX_BYTES) })).toBe('too-large');
    expect(refused(friend.token, { op: 'send', to: 'nobody', data: 1 })).toBe('not-found');
    expect(refused(friend.token, { op: 'send', data: 1 })).toBe('bad-request');
    expect(refused(friend.token, { op: 'send', to: friend.player.id, data: 1 })).toBe('bad-request');
  });
});

describe('forgetMe', () => {
  it('deletes the player, their documents, inbox, messages they sent and matches', () => {
    const me = register();
    const other = register();
    ok(me.token, { op: 'put', collection: 'teams', data: 1 });
    ok(other.token, { op: 'put', collection: 'teams', data: 1 });
    ok(me.token, { op: 'send', to: other.player.id, data: 'hi' });
    ok(other.token, { op: 'send', to: me.player.id, data: 'hello' });
    const { match } = ok(other.token, { op: 'pick', collection: 'teams' });
    expect(ok(me.token, { op: 'forgetMe' })).toEqual({ ok: true, forgotten: true });
    expect(refused(me.token, { op: 'me' })).toBe('unauthorized');
    expect(ok(other.token, { op: 'get', collection: 'teams', player: me.player.id }).doc).toBeNull();
    expect(ok(other.token, { op: 'inbox' }).messages).toEqual([]);
    expect(refused(other.token, { op: 'recordMatch', matchId: match.matchId, result: 'win' })).toBe('match-expired');
    expect(emulator.summary('game')).toEqual({ players: 1, collections: { teams: 1 } });
  });
});

describe('creator tools', () => {
  it('seeds fake players copying the newest real entry, with varied scores and ratings', () => {
    const me = register();
    ok(me.token, { op: 'put', collection: 'ghosts', key: 'track-1', data: { frames: [1, 2, 3] }, score: 80 });
    expect(emulator.seed('game', { players: 20 })).toEqual({ players: 20, docs: 20 });
    const { docs, players, collections } = emulator.data('game', 'ghosts');
    expect(players).toBe(21);
    expect(collections).toEqual({ ghosts: 21 });
    const fakes = docs!.filter(doc => doc.player !== me.player.id);
    expect(fakes.every(doc => doc.key === 'track-1' && JSON.stringify(doc.data) === '{"frames":[1,2,3]}')).toBe(true);
    expect(fakes.every(doc => typeof doc.score === 'number' && doc.score >= 48 && doc.score <= 112)).toBe(true);
    expect(new Set(fakes.map(doc => doc.rating)).size).toBeGreaterThan(1);
    // Fake players can be picked and beaten like real ones.
    const { match } = ok(me.token, { op: 'pick', collection: 'ghosts', key: 'track-1' });
    expect(ok(me.token, { op: 'recordMatch', matchId: match.matchId, result: 'win' }).ok).toBe(true);
  });

  it('seeds a named collection from given data, and players only when nothing is saved yet', () => {
    expect(emulator.seed('game', { players: 3 })).toEqual({ players: 3, docs: 0 });
    expect(emulator.seed('game', { players: 2, collection: 'teams', data: { units: ['archer'] } })).toEqual({ players: 2, docs: 2 });
    expect(emulator.data('game', 'teams').docs!.map(doc => doc.data)).toEqual([{ units: ['archer'] }, { units: ['archer'] }]);
    expect(emulator.seed('game', { players: 1, collection: 'scores', key: 'level-2' })).toEqual({ players: 1, docs: 1 });
    expect(emulator.summary('game')).toEqual({ players: 6, collections: { scores: 1, teams: 2 } });
  });

  it('refuses a bad seed', () => {
    expect(() => emulator.seed('game', { players: 0 })).toThrow('players must be');
    expect(() => emulator.seed('game', { players: 1, key: 'main' })).toThrow('Name the collection');
    expect(() => emulator.seed('game', { players: 1, data: { a: 1 } })).toThrow('Name the collection');
    expect(() => emulator.seed('game', { players: 1, collection: 'big', data: 'x'.repeat(ONLINE_MAX_DOC_BYTES) })).toThrow('limit is');
  });

  it('lists the newest 100 entries of a collection and resets everything', () => {
    emulator.seed('game', { players: 120, collection: 'scores' });
    const listed = emulator.data('game', 'scores').docs!;
    expect(listed).toHaveLength(100);
    expect(listed.map(doc => doc.updatedAt)).toEqual([...listed.map(doc => doc.updatedAt)].sort().reverse());
    const { token } = register();
    emulator.reset('game');
    expect(existsSync(path.join(dataDir, 'online', 'game.sqlite'))).toBe(false);
    expect(emulator.summary('game')).toEqual({ players: 0, collections: {} });
    expect(refused(token, { op: 'me' })).toBe('unauthorized');
  });

  it('reads a project with no data without creating a file', () => {
    expect(emulator.data('empty')).toEqual({ players: 0, collections: {} });
    expect(existsSync(path.join(dataDir, 'online', 'empty.sqlite'))).toBe(false);
  });

  it('migrates a fresh database to the current schema version', () => {
    register();
    const db = emulator['db']('game');
    expect(db.prepare("select v from meta where k = 'schema_version'").get()).toEqual({ v: '2' });
    const indexes = (db.prepare("select name from sqlite_master where type = 'index' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map(row => row.name);
    expect(indexes).toEqual(['docs_rating', 'docs_score', 'inbox_player', 'matches_player']);
    const tables = (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map(row => row.name);
    expect(tables).toEqual(['docs', 'inbox', 'matches', 'meta', 'players']);
    emulator.dispose();
    emulator = new OnlineEmulator({ dataDir, now: () => clock });
    expect(emulator.summary('game').players).toBe(1);
  });

  it('names players with the shared generator', () => {
    const { player } = register();
    const seed = (emulator['db']('game').prepare('select name_seed from players where id = ?').get(player.id) as { name_seed: number }).name_seed;
    expect({ name: player.name, nameZh: player.nameZh }).toEqual(onlinePlayerName(seed));
  });
});

it('upgrades a version 1 database in place', async () => {
  emulator.dispose();
  const Database = (await import('better-sqlite3')).default;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.join(dataDir, 'online'), { recursive: true });
  const old = new Database(path.join(dataDir, 'online', 'old.sqlite'));
  old.exec(`create table players (id text primary key, token_hash text not null unique, name_seed integer not null, created_at integer not null, last_seen_at integer not null);
create table docs (collection text not null, player text not null, key text not null, data text not null, bytes integer not null, score real, rating integer not null default 1000, updated_at integer not null, primary key (collection, player, key));
create index docs_score on docs (collection, key, score);
create index docs_rating on docs (collection, key, rating);
create table inbox (id integer primary key autoincrement, player text not null, from_player text not null, data text not null, created_at integer not null);
create table matches (id text primary key, player text not null, collection text not null, opponent text not null, key text not null, created_at integer not null, used integer not null default 0);
create table meta (k text primary key, v text not null);
insert into meta (k, v) values ('schema_version', '1');
insert into players values ('pold', 'hash', 7, 1, 1);`);
  old.close();
  emulator = new OnlineEmulator({ dataDir, now: () => clock });
  expect(emulator.summary('old').players).toBe(1);
  const db = emulator['db']('old');
  expect(db.prepare("select v from meta where k = 'schema_version'").get()).toEqual({ v: '2' });
  expect(db.prepare("select name from sqlite_master where name = 'inbox_player'").get()).toBeTruthy();
});
