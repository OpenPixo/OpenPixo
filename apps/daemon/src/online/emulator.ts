import { createHash, randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  ONLINE_DEFAULT_KEY, ONLINE_INITIAL_RATING, ONLINE_MAX_DOC_BYTES, ONLINE_MAX_INBOX_BYTES, ONLINE_MAX_QUERY_LIMIT,
  ONLINE_NAME_PATTERN, ONLINE_PROTOCOL_VERSION, onlinePlayerName,
  type OnlineDataResponse, type OnlineDoc, type OnlineErrorCode, type OnlineFailure, type OnlineInboxMessage, type OnlineMatchResult,
  type OnlinePlayer, type OnlineResponse, type OnlineSeedRequest, type OnlineSeedResponse, type OnlineSortField, type OnlineSortOrder,
} from '@openpixo/contracts';
import { isSafeId } from '../projects.js';

/**
 * The local test copy of a game's online backend (specs/current/online-features.md). It speaks
 * the hosted protocol and keeps the hosted per-game limits, so a game tested here behaves the
 * same once published. It is never metered or billed. One SQLite file per project, under the
 * daemon data root it is handed.
 */

/** Per-game limits, the hosted defaults. The hosted copy reads them from config; locally they are fixed. */
export const ONLINE_LOCAL_LIMITS = {
  maxCollections: 20,
  maxKeysPerPlayerPerCollection: 50,
  inboxKept: 50,
  requestsPerMinutePerPlayer: 60,
  matchTtlMs: 30 * 60_000,
  /** A caller is not handed the same opponent again within this long, while others are near. */
  pickRecentMs: 24 * 60 * 60_000,
  /** Nearest candidates `pick` looks at. */
  pickCandidates: 20,
  /** Nearest fresh candidates `pick` chooses among at random. */
  pickPool: 5,
  maxSeedPlayers: 500,
} as const;

const ELO_K = 32;

/** Same SQL as the hosted Durable Object. Changes must stay additive. */
const MIGRATIONS: Record<number, string> = {
  1: `
create table players (id text primary key, token_hash text not null unique, name_seed integer not null,
  created_at integer not null, last_seen_at integer not null);
create table docs (collection text not null, player text not null, key text not null, data text not null,
  bytes integer not null, score real, rating integer not null default 1000, updated_at integer not null,
  primary key (collection, player, key));
create index docs_score on docs (collection, key, score);
create index docs_rating on docs (collection, key, rating);
create table inbox (id integer primary key autoincrement, player text not null, from_player text not null,
  data text not null, created_at integer not null);
create table matches (id text primary key, player text not null, collection text not null,
  opponent text not null, key text not null, created_at integer not null, used integer not null default 0);
create table meta (k text primary key, v text not null);`,
  2: `
create index inbox_player on inbox (player);
create index matches_player on matches (player);`,
};

export class OnlineRefusal extends Error {
  constructor(readonly code: OnlineErrorCode, message: string) { super(message); }
  response(): OnlineFailure { return { ok: false, error: { code: this.code, message: this.message } }; }
}

const refuse = (code: OnlineErrorCode, message: string): never => { throw new OnlineRefusal(code, message); };

interface PlayerRow { id: string; name_seed: number }
interface DocRow { collection: string; player: string; key: string; data: string; score: number | null; rating: number; updated_at: number; name_seed: number }
interface MatchRow { id: string; player: string; collection: string; opponent: string; key: string; created_at: number; used: number }

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** `p` and 15 of [a-z0-9], as the hosted backend issues them. */
const newPlayerId = () => `p${Array.from({ length: 15 }, () => ID_ALPHABET[randomInt(0, ID_ALPHABET.length)]).join('')}`;
/** 40 characters; only its SHA-256 is stored. */
const newToken = () => randomBytes(30).toString('base64url');

function playerOf(row: PlayerRow): OnlinePlayer {
  return { id: row.id, ...onlinePlayerName(row.name_seed) };
}

function docOf(row: DocRow): OnlineDoc {
  return { player: row.player, ...onlinePlayerName(row.name_seed), collection: row.collection, key: row.key,
    data: JSON.parse(row.data) as unknown, score: row.score, rating: row.rating, updatedAt: new Date(row.updated_at).toISOString() };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function name(kind: 'collection' | 'key', value: unknown, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  return typeof value === 'string' && ONLINE_NAME_PATTERN.test(value) ? value
    : refuse('bad-request', `The ${kind} name must be 1 to 40 lowercase letters, digits, "_" or "-".`);
}

function sortField(value: unknown, fallback: OnlineSortField): OnlineSortField {
  if (value === undefined) return fallback;
  return value === 'score' || value === 'rating' ? value : refuse('bad-request', 'by must be "score" or "rating".');
}

function sortOrder(value: unknown): OnlineSortOrder {
  if (value === undefined) return 'desc';
  return value === 'asc' || value === 'desc' ? value : refuse('bad-request', 'order must be "asc" or "desc".');
}

function limit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, max) : refuse('bad-request', 'limit must be a whole number above 0.');
}

/** The serialized form and its UTF-8 size, or a refusal naming the limit. */
function serialize(value: unknown, max: number, what: string): { text: string; bytes: number } {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { /* Refused below. */ }
  if (text === undefined) return refuse('bad-request', `The ${what} must be JSON.`);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > max) return refuse('too-large', `The ${what} is ${bytes} bytes and the limit is ${max}.`);
  return { text, bytes };
}

/** Elo with K 32 as one integer change, so the two ratings move by the same amount. */
export function eloChange(yours: number, theirs: number, result: OnlineMatchResult): number {
  const expected = 1 / (1 + 10 ** ((theirs - yours) / 400));
  const actual = result === 'win' ? 1 : result === 'loss' ? 0 : 0.5;
  return Math.round(ELO_K * (actual - expected));
}

/** Column for a sort field. Both are fixed names, never caller text. */
const column = (by: OnlineSortField) => (by === 'score' ? 'score' : 'rating');

const DOC_SELECT = 'select d.collection, d.player, d.key, d.data, d.score, d.rating, d.updated_at, p.name_seed from docs d join players p on p.id = d.player';

export interface OnlineEmulatorOptions {
  /** The resolved daemon data root (RUNTIME_DATA_DIR). Databases live in its `online` folder. */
  dataDir: string;
  now?: () => number;
  /** Test seam; the hosted default otherwise. */
  requestsPerMinutePerPlayer?: number;
}

export class OnlineEmulator {
  private readonly databases = new Map<string, Database.Database>();
  /** Request times per project and player, for the per-player rate. Kept in memory like a hosted object's wake. */
  private readonly recent = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly root: string;

  constructor(private readonly options: OnlineEmulatorOptions) {
    if (!path.isAbsolute(options.dataDir)) throw new Error('OnlineEmulator needs the resolved daemon data root');
    this.root = path.join(options.dataDir, 'online');
    this.now = options.now ?? Date.now;
  }

  private file(projectId: string): string {
    if (!isSafeId(projectId)) throw new OnlineRefusal('not-found', 'Unknown project.');
    return path.join(this.root, `${projectId}.sqlite`);
  }

  private db(projectId: string): Database.Database {
    const open = this.databases.get(projectId);
    if (open) return open;
    const file = this.file(projectId);
    mkdirSync(this.root, { recursive: true });
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = OFF');
    migrate(db);
    this.databases.set(projectId, db);
    return db;
  }

  /** Answers one wire request. Never throws: every refusal is an `OnlineFailure`. */
  handle(projectId: string, request: unknown, token: string | null): OnlineResponse {
    try {
      const body = record(request);
      if (body.v !== ONLINE_PROTOCOL_VERSION) refuse('protocol-mismatch', `This emulator speaks protocol ${ONLINE_PROTOCOL_VERSION}.`);
      const db = this.db(projectId);
      if (body.op === 'register') return { ok: true, ...this.register(db) };
      const player = this.authenticate(db, projectId, token);
      return { ok: true, ...db.transaction(() => this.run(db, player, body))() } as OnlineResponse;
    } catch (error) {
      if (error instanceof OnlineRefusal) return error.response();
      console.error('[online] local emulator request failed:', error);
      return new OnlineRefusal('unavailable', 'The local online test failed. Check the OpenPixo log.').response();
    }
  }

  private register(db: Database.Database): { player: OnlinePlayer; token: string } {
    const token = newToken();
    const row = this.insertPlayer(db, hashToken(token));
    return { player: playerOf(row), token };
  }

  private insertPlayer(db: Database.Database, tokenHash: string): PlayerRow {
    const now = this.now();
    const row = { id: newPlayerId(), name_seed: randomInt(0, 2 ** 31) };
    db.prepare('insert into players (id, token_hash, name_seed, created_at, last_seen_at) values (?, ?, ?, ?, ?)').run(row.id, tokenHash, row.name_seed, now, now);
    return row;
  }

  private authenticate(db: Database.Database, projectId: string, token: string | null): PlayerRow {
    const row = token ? db.prepare('select id, name_seed from players where token_hash = ?').get(hashToken(token)) as PlayerRow | undefined : undefined;
    if (!row) return refuse('unauthorized', 'Unknown player token. Register again.');
    const now = this.now();
    const key = `${projectId}\u0000${row.id}`;
    const times = (this.recent.get(key) ?? []).filter(time => time > now - 60_000);
    const cap = this.options.requestsPerMinutePerPlayer ?? ONLINE_LOCAL_LIMITS.requestsPerMinutePerPlayer;
    if (times.length >= cap) { this.recent.set(key, times); refuse('too-fast', `A player can make ${cap} requests a minute.`); }
    times.push(now);
    this.recent.set(key, times);
    db.prepare('update players set last_seen_at = ? where id = ?').run(now, row.id);
    return row;
  }

  private doc(db: Database.Database, collection: string, player: string, key: string): DocRow | undefined {
    return db.prepare(`${DOC_SELECT} where d.collection = ? and d.player = ? and d.key = ?`).get(collection, player, key) as DocRow | undefined;
  }

  private run(db: Database.Database, me: PlayerRow, body: Record<string, unknown>): Record<string, unknown> {
    switch (body.op) {
      case 'me': return { player: playerOf(me) };
      case 'put': return this.put(db, me, body);
      case 'get': {
        const collection = name('collection', body.collection);
        const key = name('key', body.key, ONLINE_DEFAULT_KEY);
        if (typeof body.player !== 'string' || !body.player) refuse('bad-request', 'get needs a player id.');
        const row = this.doc(db, collection, body.player as string, key);
        return { doc: row ? docOf(row) : null };
      }
      case 'top': {
        const collection = name('collection', body.collection);
        const key = name('key', body.key, ONLINE_DEFAULT_KEY);
        const by = column(sortField(body.by, 'score'));
        const order = sortOrder(body.order);
        const count = limit(body.limit, 10, ONLINE_MAX_QUERY_LIMIT);
        // Ties go to whoever got there first.
        const rows = db.prepare(`${DOC_SELECT} where d.collection = ? and d.key = ? and d.${by} is not null
          order by d.${by} ${order}, d.updated_at asc, d.player asc limit ?`).all(collection, key, count) as DocRow[];
        return { docs: rows.map(docOf) };
      }
      case 'rank': return this.rank(db, me, body);
      case 'pick': return this.pick(db, me, body);
      case 'recordMatch': return this.recordMatch(db, me, body);
      case 'send': {
        if (typeof body.to !== 'string' || !body.to) refuse('bad-request', 'send needs a player id in "to".');
        const to = body.to as string;
        if (to === me.id) refuse('bad-request', 'A player cannot send a message to themselves.');
        if (body.data === undefined) refuse('bad-request', 'send needs data.');
        const { text } = serialize(body.data, ONLINE_MAX_INBOX_BYTES, 'message');
        if (!db.prepare('select 1 from players where id = ?').get(to)) refuse('not-found', 'No player has that id.');
        db.prepare('insert into inbox (player, from_player, data, created_at) values (?, ?, ?, ?)').run(to, me.id, text, this.now());
        // Only the newest messages are kept, so an inbox nobody reads stays small.
        db.prepare(`delete from inbox where player = ? and id not in (select id from inbox where player = ? order by id desc limit ?)`)
          .run(to, to, ONLINE_LOCAL_LIMITS.inboxKept);
        return { sent: true };
      }
      case 'inbox': {
        const count = limit(body.limit, ONLINE_LOCAL_LIMITS.inboxKept, ONLINE_LOCAL_LIMITS.inboxKept);
        const rows = db.prepare(`select i.id, i.from_player, i.data, i.created_at, p.name_seed from inbox i
          left join players p on p.id = i.from_player where i.player = ? order by i.id desc limit ?`).all(me.id, count) as
          { id: number; from_player: string; data: string; created_at: number; name_seed: number | null }[];
        const messages: OnlineInboxMessage[] = rows.map(row => {
          const names = onlinePlayerName(row.name_seed ?? 0);
          return { id: row.id, from: row.from_player, fromName: names.name, fromNameZh: names.nameZh,
            data: JSON.parse(row.data) as unknown, createdAt: new Date(row.created_at).toISOString() };
        });
        return { messages };
      }
      case 'remove': {
        const collection = name('collection', body.collection);
        const key = name('key', body.key, ONLINE_DEFAULT_KEY);
        const result = db.prepare('delete from docs where collection = ? and player = ? and key = ?').run(collection, me.id, key);
        return { removed: result.changes > 0 };
      }
      case 'forgetMe':
        forgetPlayer(db, me.id);
        return { forgotten: true };
      default:
        return refuse('bad-request', 'Unknown op.');
    }
  }

  private put(db: Database.Database, me: PlayerRow, body: Record<string, unknown>): Record<string, unknown> {
    const collection = name('collection', body.collection);
    const key = name('key', body.key, ONLINE_DEFAULT_KEY);
    if (body.data === undefined) refuse('bad-request', 'put needs data.');
    const score = body.score;
    if (score !== undefined && score !== null && (typeof score !== 'number' || !Number.isFinite(score))) refuse('bad-request', 'score must be a finite number or null.');
    const { text, bytes } = serialize(body.data, ONLINE_MAX_DOC_BYTES, 'document');
    const existing = this.doc(db, collection, me.id, key);
    if (!existing) {
      const known = db.prepare('select 1 from docs where collection = ? limit 1').get(collection);
      const collections = (db.prepare('select count(distinct collection) as n from docs').get() as { n: number }).n;
      if (!known && collections >= ONLINE_LOCAL_LIMITS.maxCollections) refuse('too-large', `A game can have at most ${ONLINE_LOCAL_LIMITS.maxCollections} collections.`);
      const keys = (db.prepare('select count(*) as n from docs where collection = ? and player = ?').get(collection, me.id) as { n: number }).n;
      if (keys >= ONLINE_LOCAL_LIMITS.maxKeysPerPlayerPerCollection) refuse('too-large', `A player can have at most ${ONLINE_LOCAL_LIMITS.maxKeysPerPlayerPerCollection} keys in one collection.`);
    }
    // A put replaces the data and the score; the rating belongs to recordMatch.
    db.prepare(`insert into docs (collection, player, key, data, bytes, score, rating, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (collection, player, key) do update set data = excluded.data, bytes = excluded.bytes, score = excluded.score, updated_at = excluded.updated_at`)
      .run(collection, me.id, key, text, bytes, typeof score === 'number' ? score : null, ONLINE_INITIAL_RATING, this.now());
    return { doc: docOf(this.doc(db, collection, me.id, key)!) };
  }

  private rank(db: Database.Database, me: PlayerRow, body: Record<string, unknown>): Record<string, unknown> {
    const collection = name('collection', body.collection);
    const key = name('key', body.key, ONLINE_DEFAULT_KEY);
    const by = column(sortField(body.by, 'score'));
    const order = sortOrder(body.order);
    const total = (db.prepare(`select count(*) as n from docs where collection = ? and key = ? and ${by} is not null`).get(collection, key) as { n: number }).n;
    const mine = this.doc(db, collection, me.id, key);
    const value = mine?.[by];
    if (!mine || value === null || value === undefined) return { rank: null, total };
    // The same order as `top`: better value, then earlier update, then player id.
    const better = order === 'desc' ? '>' : '<';
    const ahead = (db.prepare(`select count(*) as n from docs where collection = ? and key = ? and ${by} is not null and
      (${by} ${better} ? or (${by} = ? and (updated_at < ? or (updated_at = ? and player < ?))))`)
      .get(collection, key, value, value, mine.updated_at, mine.updated_at, me.id) as { n: number }).n;
    return { rank: ahead + 1, total };
  }

  private pick(db: Database.Database, me: PlayerRow, body: Record<string, unknown>): Record<string, unknown> {
    const collection = name('collection', body.collection);
    const key = name('key', body.key, ONLINE_DEFAULT_KEY);
    const by = column(sortField(body.by, 'rating'));
    const mine = this.doc(db, collection, me.id, key);
    // Without an entry of its own the caller stands where every new player starts.
    const reference = (by === 'rating' ? mine?.rating ?? ONLINE_INITIAL_RATING : mine?.score) ?? null;
    const now = this.now();
    // The 20 nearest, then at random among the 5 nearest of those not handed to this caller in the
    // last day; when every one was, the 5 nearest again. Same rule as the hosted backend.
    const nearest = db.prepare(`${DOC_SELECT} where d.collection = ? and d.key = ? and d.player != ? and d.${by} is not null
      order by ${reference === null ? '' : `abs(d.${by} - ?), `}random() limit ?`)
      .all(...[collection, key, me.id, ...(reference === null ? [] : [reference]), ONLINE_LOCAL_LIMITS.pickCandidates]) as DocRow[];
    if (!nearest.length) return { match: null };
    const recent = new Set((db.prepare('select opponent from matches where player = ? and collection = ? and key = ? and created_at > ?')
      .all(me.id, collection, key, now - ONLINE_LOCAL_LIMITS.pickRecentMs) as { opponent: string }[]).map(row => row.opponent));
    const fresh = nearest.filter(row => !recent.has(row.player));
    const pool = (fresh.length ? fresh : nearest).slice(0, ONLINE_LOCAL_LIMITS.pickPool);
    const chosen = pool[randomInt(0, pool.length)]!;
    const matchId = randomBytes(16).toString('base64url');
    db.prepare('insert into matches (id, player, collection, opponent, key, created_at, used) values (?, ?, ?, ?, ?, ?, 0)')
      .run(matchId, me.id, collection, chosen.player, key, now);
    // Kept a day, for the not-recently rule; recordMatch accepts only the last 30 minutes.
    db.prepare('delete from matches where created_at <= ?').run(now - ONLINE_LOCAL_LIMITS.pickRecentMs);
    return { match: { matchId, doc: docOf(chosen) } };
  }

  private recordMatch(db: Database.Database, me: PlayerRow, body: Record<string, unknown>): Record<string, unknown> {
    if (typeof body.matchId !== 'string' || !body.matchId) refuse('bad-request', 'recordMatch needs a matchId from pick.');
    const result = body.result;
    if (result !== 'win' && result !== 'loss' && result !== 'draw') refuse('bad-request', 'result must be "win", "loss" or "draw".');
    const match = db.prepare('select * from matches where id = ?').get(body.matchId) as MatchRow | undefined;
    if (!match || match.player !== me.id || match.used || match.created_at <= this.now() - ONLINE_LOCAL_LIMITS.matchTtlMs) {
      return refuse('match-expired', 'That match is unknown, used, older than 30 minutes or was handed to another player.');
    }
    const yours = this.doc(db, match.collection, me.id, match.key);
    if (!yours) return refuse('not-found', 'Save your own entry before playing a match.');
    const theirs = this.doc(db, match.collection, match.opponent, match.key);
    if (!theirs) return refuse('not-found', 'That player is no longer here.');
    const change = eloChange(yours.rating, theirs.rating, result as OnlineMatchResult);
    const update = db.prepare('update docs set rating = ? where collection = ? and player = ? and key = ?');
    update.run(yours.rating + change, match.collection, me.id, match.key);
    update.run(theirs.rating - change, match.collection, match.opponent, match.key);
    db.prepare('update matches set used = 1 where id = ?').run(match.id);
    return { you: yours.rating + change, opponent: theirs.rating - change };
  }

  /** Player and document counts for the creator. Opens nothing when the project has no data yet. */
  summary(projectId: string): { players: number; collections: Record<string, number> } {
    const db = this.existing(projectId);
    if (!db) return { players: 0, collections: {} };
    const players = (db.prepare('select count(*) as n from players').get() as { n: number }).n;
    const rows = db.prepare('select collection, count(*) as n from docs group by collection order by collection').all() as { collection: string; n: number }[];
    return { players, collections: Object.fromEntries(rows.map(row => [row.collection, row.n])) };
  }

  data(projectId: string, collection?: string): OnlineDataResponse {
    const summary = this.summary(projectId);
    if (collection === undefined) return summary;
    name('collection', collection);
    const db = this.existing(projectId);
    const rows = db ? db.prepare(`${DOC_SELECT} where d.collection = ? order by d.updated_at desc, d.player asc limit ?`).all(collection, ONLINE_MAX_QUERY_LIMIT) as DocRow[] : [];
    return { ...summary, docs: rows.map(docOf) };
  }

  private existing(projectId: string): Database.Database | null {
    if (this.databases.has(projectId)) return this.db(projectId);
    return existsSync(this.file(projectId)) ? this.db(projectId) : null;
  }

  /**
   * Fake players with generated names. Each gets an entry in every target collection: a copy of
   * `data`, or of the newest real entry there, with a varied score and rating, so one creator
   * can test leaderboards, ghosts and matchmaking alone.
   */
  seed(projectId: string, request: OnlineSeedRequest): OnlineSeedResponse {
    const players = request.players ?? 20;
    if (!Number.isInteger(players) || players < 1 || players > ONLINE_LOCAL_LIMITS.maxSeedPlayers) {
      refuse('bad-request', `players must be a whole number from 1 to ${ONLINE_LOCAL_LIMITS.maxSeedPlayers}.`);
    }
    const collection = request.collection === undefined ? undefined : name('collection', request.collection);
    const key = request.key === undefined ? undefined : name('key', request.key);
    if (key !== undefined && collection === undefined) refuse('bad-request', 'Name the collection the key belongs to.');
    const db = this.db(projectId);
    return db.transaction(() => {
      const targets = seedTargets(db, collection, key);
      if (!targets.length && request.data !== undefined) refuse('bad-request', 'Name the collection to fill with the copied data.');
      const templates = targets.map(target => {
        const newest = db.prepare('select data, score from docs where collection = ? and key = ? order by updated_at desc limit 1')
          .get(target.collection, target.key) as { data: string; score: number | null } | undefined;
        const data = request.data !== undefined ? serialize(request.data, ONLINE_MAX_DOC_BYTES, 'seed data')
          : newest ? { text: newest.data, bytes: Buffer.byteLength(newest.data, 'utf8') } : serialize({}, ONLINE_MAX_DOC_BYTES, 'seed data');
        // Without a real entry to copy there is no score scale to follow, so points spread around 500.
        const baseScore = newest ? newest.score : 500;
        return { ...target, data, baseScore };
      });
      const existingCollections = new Set((db.prepare('select distinct collection from docs').all() as { collection: string }[]).map(row => row.collection));
      const newCollections = new Set(templates.map(template => template.collection).filter(item => !existingCollections.has(item)));
      if (existingCollections.size + newCollections.size > ONLINE_LOCAL_LIMITS.maxCollections) {
        refuse('too-large', `A game can have at most ${ONLINE_LOCAL_LIMITS.maxCollections} collections.`);
      }
      const insert = db.prepare('insert into docs (collection, player, key, data, bytes, score, rating, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)');
      const now = this.now();
      let docs = 0;
      for (let index = 0; index < players; index += 1) {
        const player = this.insertPlayer(db, hashToken(newToken()));
        for (const template of templates) {
          const score = template.baseScore === null ? null : varied(template.baseScore);
          const rating = ONLINE_INITIAL_RATING + randomInt(-200, 201);
          // Spread over the last day so newest-first lists look like real play.
          insert.run(template.collection, player.id, template.key, template.data.text, template.data.bytes, score, rating, now - randomInt(0, 86_400_000));
          docs += 1;
        }
      }
      return { players, docs };
    })();
  }

  /** Deletes this project's local test data. */
  reset(projectId: string): void {
    const file = this.file(projectId);
    this.databases.get(projectId)?.close();
    this.databases.delete(projectId);
    for (const key of this.recent.keys()) if (key.startsWith(`${projectId}\u0000`)) this.recent.delete(key);
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
  }

  dispose(): void {
    for (const db of this.databases.values()) db.close();
    this.databases.clear();
  }
}

function migrate(db: Database.Database): void {
  db.exec('create table if not exists meta (k text primary key, v text not null)');
  const row = db.prepare("select v from meta where k = 'schema_version'").get() as { v: string } | undefined;
  let version = row ? Number(row.v) : 0;
  while (MIGRATIONS[version + 1]) {
    const next = version + 1;
    db.transaction(() => {
      // Version 1 creates `meta` too; it already exists to hold the version.
      db.exec(next === 1 ? MIGRATIONS[1]!.replace(/create table meta[^;]*;/u, '') : MIGRATIONS[next]!);
      db.prepare("insert into meta (k, v) values ('schema_version', ?) on conflict (k) do update set v = excluded.v").run(String(next));
    })();
    version = next;
  }
}

function forgetPlayer(db: Database.Database, id: string): void {
  db.prepare('delete from docs where player = ?').run(id);
  db.prepare('delete from inbox where player = ? or from_player = ?').run(id, id);
  db.prepare('delete from matches where player = ? or opponent = ?').run(id, id);
  db.prepare('delete from players where id = ?').run(id);
}

/** Where fake players get entries: the named place, or every collection and key the game already uses. */
function seedTargets(db: Database.Database, collection: string | undefined, key: string | undefined): { collection: string; key: string }[] {
  if (collection !== undefined && key !== undefined) return [{ collection, key }];
  const rows = (collection === undefined
    ? db.prepare('select distinct collection, key from docs order by collection, key').all()
    : db.prepare('select distinct collection, key from docs where collection = ? order by key').all(collection)) as { collection: string; key: string }[];
  if (rows.length) return rows;
  return collection === undefined ? [] : [{ collection, key: ONLINE_DEFAULT_KEY }];
}

/** Within 40% either side, keeping whole numbers whole. */
function varied(base: number): number {
  const factor = 0.6 + Math.random() * 0.8;
  const value = base === 0 ? randomInt(0, 100) : base * factor;
  return Number.isInteger(base) ? Math.round(value) : Math.round(value * 1000) / 1000;
}
