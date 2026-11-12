/**
 * Online features for web games: leaderboards, saves, async battles and racing ghosts.
 * Added to a game with `pixo online add`; no dependencies.
 *
 *   const me = await online.me();                                   // { id, name, nameZh }
 *   await online.put('scores', { level: 3 }, { score: 1200 });
 *   const best = await online.top('scores', { limit: 10 });
 *   const match = await online.pick('teams');                       // someone else's saved team, or null
 *
 * Players are anonymous. Each one gets a generated name and a token kept in this game's
 * localStorage, so nobody signs in or types a name. Scores can be faked by a determined
 * player: this is for fun, not prizes.
 *
 * Only erasable TypeScript syntax is used: installing into a JavaScript project strips the types.
 */

const PROTOCOL_VERSION = 1;
const MAX_DOC_BYTES = 65_536;
const MAX_INBOX_BYTES = 2_048;
const MAX_QUERY_LIMIT = 100;
const NAME_PATTERN = /^[a-z0-9_-]{1,40}$/u;
const RETRY_DELAY_MS = 400;
const TOKEN_KEY = 'openpixo-online-token';

export type OnlineErrorCode =
  | 'read-only' | 'paused' | 'too-large' | 'too-fast' | 'bad-request' | 'not-found' | 'match-expired'
  | 'unauthorized' | 'protocol-mismatch' | 'unavailable'
  /** The game runs on this computer without a test link from `pixo online test`. */
  | 'emulator-missing'
  /** The `?pixoOnline=` link does not point at this computer. */
  | 'emulator-invalid'
  | 'no-page';

export interface OnlinePlayer {
  id: string;
  /** Generated, like `Brave Fox 42`. */
  name: string;
  /** The same name in Simplified Chinese, like `勇敢的狐狸 42`. */
  nameZh: string;
}

export interface OnlineDoc<T = unknown> {
  player: string;
  name: string;
  nameZh: string;
  collection: string;
  key: string;
  data: T;
  /** What the game submitted (lap time, points); null when it submitted none. */
  score: number | null;
  /** Starts at 1000 and changes only through recordMatch. */
  rating: number;
  /** ISO 8601. */
  updatedAt: string;
}

export interface OnlineMatch<T = unknown> {
  matchId: string;
  doc: OnlineDoc<T>;
}

export interface OnlineInboxMessage<T = unknown> {
  id: number;
  from: string;
  fromName: string;
  fromNameZh: string;
  data: T;
  createdAt: string;
}

export type OnlineSortField = 'score' | 'rating';
export type OnlineSortOrder = 'asc' | 'desc';
export type OnlineMatchResult = 'win' | 'loss' | 'draw';

const MESSAGES: Record<OnlineErrorCode, string> = {
  'read-only': 'Online saving is paused for this game right now. Scores and saves can still be viewed.',
  paused: 'Online features are not open yet. Try again later.',
  'too-large': 'That is too much to save online at once.',
  'too-fast': 'Slow down a little, then try again.',
  'bad-request': 'The game sent something the online service could not use.',
  'not-found': 'That player or entry is no longer online.',
  'match-expired': 'That match has expired. Find a new opponent.',
  unauthorized: 'Could not sign this player in. Refresh the page.',
  'protocol-mismatch': 'This copy of the game is out of date. Refresh the page.',
  unavailable: 'Online features are unavailable right now. Try again in a minute.',
  'emulator-missing': 'While the game runs on this computer, online features need a test link. Run "pixo online test" and open the link it prints.',
  'emulator-invalid': 'This test link does not point at this computer. Run "pixo online test" and open the link it prints.',
  'no-page': 'Online features need a web page to run in.',
};

/**
 * Thrown for every refusal. `code` is the machine-readable reason and `message` is safe to
 * show players. `detail` is the server's explanation, for the game's developer.
 */
export class OnlineError extends Error {
  readonly code: OnlineErrorCode;
  readonly detail: string | undefined;
  constructor(code: OnlineErrorCode, message?: string, detail?: string) {
    super(message ?? MESSAGES[code] ?? MESSAGES.unavailable);
    this.name = 'OnlineError';
    this.code = code;
    this.detail = detail;
  }
}

function pageUrl(): URL | null {
  const location = (globalThis as { location?: { href?: string } }).location;
  if (!location?.href) return null;
  try { return new URL(location.href); } catch { return null; }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

interface Backend {
  /** Requests go to `${base}/v1`. */
  base: string;
  /** Where this backend's player token is kept. A local port change keeps the same player. */
  tokenKey: string;
}

/** The order is in specs/current/online-features.md: test link, then hosted, then a loopback page explains itself. */
function chooseBackend(): Backend {
  const page = pageUrl();
  if (!page) throw new OnlineError('no-page');
  const emulator = page.searchParams.get('pixoOnline');
  if (emulator) {
    let parsed: URL | null = null;
    try { parsed = new URL(emulator); } catch { /* Reported below. */ }
    // A link must not be able to point a player's game at someone else's server.
    if (parsed && parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
      return { base: emulator.replace(/\/+$/u, ''), tokenKey: `${TOKEN_KEY}:local:${parsed.pathname.replace(/\/+$/u, '')}` };
    }
    if (isLoopbackHost(page.hostname)) throw new OnlineError('emulator-invalid');
  }
  if (isLoopbackHost(page.hostname)) throw new OnlineError('emulator-missing');
  return { base: '/__online', tokenKey: TOKEN_KEY };
}

interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): TokenStorage | null {
  // Reading `localStorage` itself throws where site data is blocked.
  try { return (globalThis as { localStorage?: TokenStorage }).localStorage ?? null; } catch { return null; }
}

function checkName(kind: 'collection' | 'key', value: unknown): string {
  if (typeof value !== 'string' || !NAME_PATTERN.test(value)) {
    throw new OnlineError('bad-request', undefined, `The ${kind} name ${JSON.stringify(value)} must be 1 to 40 lowercase letters, digits, "_" or "-".`);
  }
  return value;
}

function jsonBytes(value: unknown, max: number, what: string): void {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { /* Reported below. */ }
  if (text === undefined) throw new OnlineError('bad-request', undefined, `The ${what} must be plain JSON data.`);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > max) throw new OnlineError('too-large', undefined, `The ${what} is ${bytes} bytes and the limit is ${max}. Save less, or split it up.`);
}

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

type Reply = { ok: true } & Record<string, unknown> | { ok: false; error: { code: OnlineErrorCode; message: string } };

class OnlineClient {
  private backend: Backend | null = null;
  private token: string | null = null;
  private player: OnlinePlayer | null = null;
  private registering: Promise<void> | null = null;

  private chosen(): Backend {
    if (!this.backend) {
      this.backend = chooseBackend();
      try { this.token = storage()?.getItem(this.backend.tokenKey) ?? null; } catch { this.token = null; }
    }
    return this.backend;
  }

  private keepToken(token: string | null): void {
    this.token = token;
    const key = this.chosen().tokenKey;
    try {
      if (token) storage()?.setItem(key, token);
      else storage()?.removeItem(key);
    } catch { /* Private windows can refuse storage; the player lasts for this page. */ }
  }

  /** One request, retried once when the service is briefly unavailable. */
  private async post(body: Record<string, unknown>, auth: boolean): Promise<Reply> {
    const { base } = this.chosen();
    for (let attempt = 0; ; attempt += 1) {
      let reply: Reply | null = null;
      try {
        const response = await fetch(`${base}/v1`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth && this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
          body: JSON.stringify({ v: PROTOCOL_VERSION, ...body }) });
        reply = await response.json().catch(() => null) as Reply | null;
      } catch { reply = null; }
      if (!reply || typeof reply !== 'object' || typeof reply.ok !== 'boolean') {
        reply = { ok: false, error: { code: 'unavailable', message: 'No answer from the online service.' } };
      }
      if (!reply.ok && reply.error?.code === 'unavailable' && attempt === 0) { await sleep(RETRY_DELAY_MS); continue; }
      return reply;
    }
  }

  private async register(): Promise<void> {
    this.registering ??= (async () => {
      try {
        const reply = await this.post({ op: 'register' }, false);
        if (!reply.ok) throw failure(reply);
        this.player = reply.player as OnlinePlayer;
        this.keepToken(reply.token as string);
      } finally { this.registering = null; }
    })();
    return this.registering;
  }

  /** Signs the player in on first use. A token the backend no longer knows gets a new player, once. */
  async call<T>(body: Record<string, unknown>): Promise<T> {
    this.chosen();
    if (!this.token) await this.register();
    let reply = await this.post(body, true);
    if (!reply.ok && reply.error?.code === 'unauthorized') {
      this.keepToken(null);
      this.player = null;
      await this.register();
      reply = await this.post(body, true);
    }
    if (!reply.ok) throw failure(reply);
    return reply as unknown as T;
  }

  async me(): Promise<OnlinePlayer> {
    if (this.player && this.token) return { ...this.player };
    const { player } = await this.call<{ player: OnlinePlayer }>({ op: 'me' });
    this.player = player;
    return { ...player };
  }

  async forget(): Promise<void> {
    await this.call({ op: 'forgetMe' });
    this.player = null;
    this.keepToken(null);
  }
}

function failure(reply: Extract<Reply, { ok: false }>): OnlineError {
  const code = reply.error?.code;
  const known = typeof code === 'string' && code in MESSAGES ? code : 'unavailable';
  return new OnlineError(known, undefined, typeof reply.error?.message === 'string' ? reply.error.message : undefined);
}

const client = new OnlineClient();

function optionalKey(key: unknown): string | undefined {
  return key === undefined ? undefined : checkName('key', key);
}

function limit(value: unknown, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new OnlineError('bad-request', undefined, 'limit must be a whole number above 0.');
  return Math.min(value, max);
}

export const online = {
  /** This player. Registers them the first time. */
  me(): Promise<OnlinePlayer> {
    return client.me();
  },

  /** Saves `data` as this player's entry in `collection` under `key` (default `main`), replacing what was there. */
  async put<T>(collection: string, data: T, options: { key?: string; score?: number | null } = {}): Promise<OnlineDoc<T>> {
    checkName('collection', collection);
    const key = optionalKey(options.key);
    jsonBytes(data, MAX_DOC_BYTES, 'saved data');
    if (options.score !== undefined && options.score !== null && (typeof options.score !== 'number' || !Number.isFinite(options.score))) {
      throw new OnlineError('bad-request', undefined, 'score must be a finite number or null.');
    }
    const { doc } = await client.call<{ doc: OnlineDoc<T> }>({ op: 'put', collection, ...(key ? { key } : {}), data,
      ...(options.score !== undefined ? { score: options.score } : {}) });
    return doc;
  },

  /** One player's entry; this player's own when `player` is left out. Null when there is none. */
  async get<T>(collection: string, options: { player?: string; key?: string } = {}): Promise<OnlineDoc<T> | null> {
    checkName('collection', collection);
    const key = optionalKey(options.key);
    const player = options.player ?? (await client.me()).id;
    const { doc } = await client.call<{ doc: OnlineDoc<T> | null }>({ op: 'get', collection, player, ...(key ? { key } : {}) });
    return doc;
  },

  /** The best entries. Defaults: by `score`, highest first, 10 of them (at most 100). */
  async top<T>(collection: string, options: { key?: string; by?: OnlineSortField; order?: OnlineSortOrder; limit?: number } = {}): Promise<OnlineDoc<T>[]> {
    checkName('collection', collection);
    const key = optionalKey(options.key);
    const count = limit(options.limit, MAX_QUERY_LIMIT);
    const { docs } = await client.call<{ docs: OnlineDoc<T>[] }>({ op: 'top', collection, ...(key ? { key } : {}),
      ...(options.by ? { by: options.by } : {}), ...(options.order ? { order: options.order } : {}), ...(count ? { limit: count } : {}) });
    return docs;
  },

  /** This player's place, sorted the same way as `top`. Null when they have no entry there. */
  async rank(collection: string, options: { key?: string; by?: OnlineSortField; order?: OnlineSortOrder } = {}): Promise<{ rank: number; total: number } | null> {
    checkName('collection', collection);
    const key = optionalKey(options.key);
    const result = await client.call<{ rank: number | null; total: number }>({ op: 'rank', collection, ...(key ? { key } : {}),
      ...(options.by ? { by: options.by } : {}), ...(options.order ? { order: options.order } : {}) });
    return result.rank === null ? null : { rank: result.rank, total: result.total };
  },

  /**
   * Another player's entry near this player's own `rating` (default) or `score`, preferring
   * players not picked recently. Null when nobody else has one. Pass the result to recordMatch.
   */
  async pick<T>(collection: string, options: { key?: string; by?: OnlineSortField } = {}): Promise<OnlineMatch<T> | null> {
    checkName('collection', collection);
    const key = optionalKey(options.key);
    const { match } = await client.call<{ match: OnlineMatch<T> | null }>({ op: 'pick', collection, ...(key ? { key } : {}),
      ...(options.by ? { by: options.by } : {}) });
    return match;
  },

  /**
   * The result for this player of a match from `pick`, within 30 minutes and once. Updates both
   * players' ratings and returns them. This player needs their own entry in that collection.
   */
  async recordMatch(match: OnlineMatch | string, result: OnlineMatchResult): Promise<{ you: number; opponent: number }> {
    const matchId = typeof match === 'string' ? match : match?.matchId;
    if (typeof matchId !== 'string' || !matchId) throw new OnlineError('bad-request', undefined, 'recordMatch needs the match from pick().');
    if (result !== 'win' && result !== 'loss' && result !== 'draw') throw new OnlineError('bad-request', undefined, 'result must be "win", "loss" or "draw".');
    const { you, opponent } = await client.call<{ you: number; opponent: number }>({ op: 'recordMatch', matchId, result });
    return { you, opponent };
  },

  /** Puts a short message (at most 2 KB) in another player's inbox. Only the newest 50 are kept. */
  async send(player: string, data: unknown): Promise<void> {
    if (typeof player !== 'string' || !player) throw new OnlineError('bad-request', undefined, 'send needs a player id.');
    jsonBytes(data, MAX_INBOX_BYTES, 'message');
    await client.call({ op: 'send', to: player, data });
  },

  /** This player's messages, newest first. */
  async inbox<T>(options: { limit?: number } = {}): Promise<OnlineInboxMessage<T>[]> {
    const count = limit(options.limit, 50);
    const { messages } = await client.call<{ messages: OnlineInboxMessage<T>[] }>({ op: 'inbox', ...(count ? { limit: count } : {}) });
    return messages;
  },

  /** Deletes this player's entry. True when there was one. */
  async remove(collection: string, options: { key?: string } = {}): Promise<boolean> {
    checkName('collection', collection);
    const key = optionalKey(options.key);
    const { removed } = await client.call<{ removed: boolean }>({ op: 'remove', collection, ...(key ? { key } : {}) });
    return removed;
  },

  /** Deletes this player and everything they saved. The next call starts a new player. */
  forgetMe(): Promise<void> {
    return client.forget();
  },
};
