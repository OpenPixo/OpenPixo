/**
 * Online features (`pixo online`): a small backend per published web game for leaderboards,
 * saves, async battles and racing ghosts. See specs/current/online-features.md.
 *
 * The local emulator in the daemon and the hosted Durable Object speak exactly this protocol.
 */

export const ONLINE_PROTOCOL_VERSION = 1;
export const ONLINE_MAX_DOC_BYTES = 65_536;
export const ONLINE_MAX_INBOX_BYTES = 2_048;
export const ONLINE_MAX_QUERY_LIMIT = 100;
export const ONLINE_NAME_PATTERN = /^[a-z0-9_-]{1,40}$/u;
export const ONLINE_DEFAULT_KEY = 'main';
export const ONLINE_INITIAL_RATING = 1000;

export type OnlineSortField = 'score' | 'rating';
export type OnlineSortOrder = 'asc' | 'desc';

export interface OnlinePlayer {
  id: string;
  /** Generated, never typed by a player. English form. */
  name: string;
  /** The same name in Simplified Chinese. */
  nameZh: string;
}

export interface OnlineDoc {
  player: string;
  name: string;
  nameZh: string;
  collection: string;
  key: string;
  data: unknown;
  /** What the game submitted (lap time, points); null when it submitted none. */
  score: number | null;
  /** Starts at ONLINE_INITIAL_RATING; changes only through recordMatch. */
  rating: number;
  /** ISO 8601. */
  updatedAt: string;
}

export interface OnlineMatch {
  matchId: string;
  doc: OnlineDoc;
}

export interface OnlineInboxMessage {
  id: number;
  from: string;
  fromName: string;
  fromNameZh: string;
  data: unknown;
  createdAt: string;
}

export type OnlineMatchResult = 'win' | 'loss' | 'draw';

export type OnlineRequest =
  | { op: 'register'; v: number }
  | { op: 'me'; v: number }
  | { op: 'put'; v: number; collection: string; key?: string; data: unknown; score?: number | null }
  | { op: 'get'; v: number; collection: string; player: string; key?: string }
  | { op: 'top'; v: number; collection: string; key?: string; by?: OnlineSortField; order?: OnlineSortOrder; limit?: number }
  | { op: 'rank'; v: number; collection: string; key?: string; by?: OnlineSortField; order?: OnlineSortOrder }
  /** Defaults: by 'rating'. Near the caller's own document's value for that field. */
  | { op: 'pick'; v: number; collection: string; key?: string; by?: OnlineSortField }
  | { op: 'recordMatch'; v: number; matchId: string; result: OnlineMatchResult }
  | { op: 'send'; v: number; to: string; data: unknown }
  | { op: 'inbox'; v: number; limit?: number }
  | { op: 'remove'; v: number; collection: string; key?: string }
  | { op: 'forgetMe'; v: number };

export type OnlineOp = OnlineRequest['op'];

export type OnlineErrorCode =
  | 'read-only'
  | 'paused'
  | 'too-large'
  | 'too-fast'
  | 'bad-request'
  | 'not-found'
  | 'match-expired'
  | 'unauthorized'
  | 'protocol-mismatch'
  | 'unavailable';

export interface OnlineFailure {
  ok: false;
  error: { code: OnlineErrorCode; message: string };
}

/** Success payloads by op. `register` also returns the token the SDK keeps. */
export interface OnlineResults {
  register: { player: OnlinePlayer; token: string };
  me: { player: OnlinePlayer };
  put: { doc: OnlineDoc };
  get: { doc: OnlineDoc | null };
  top: { docs: OnlineDoc[] };
  rank: { rank: number; total: number } | { rank: null; total: number };
  pick: { match: OnlineMatch | null };
  recordMatch: { you: number; opponent: number };
  send: { sent: true };
  inbox: { messages: OnlineInboxMessage[] };
  remove: { removed: boolean };
  forgetMe: { forgotten: true };
}

export type OnlineResponse<O extends OnlineOp = OnlineOp> = ({ ok: true } & OnlineResults[O]) | OnlineFailure;

/** What the hosted backend enforces until its next report to the cloud. */
export type OnlineState = 'ok' | 'read-only' | 'paused';

// Creator-facing status: daemon HTTP, CLI and the Share dialog.

export interface OnlineUsage {
  /** Calendar month, UTC, `YYYY-MM`. */
  month: string;
  state: OnlineState;
  /** Why the state is not ok, for the creator. */
  stateReason?: 'no-plan' | 'requests-cap' | 'storage-cap' | 'paused';
  /** This game this month. */
  gameRequests: number;
  gameBytes: number;
  players: number;
  /** All of the account's games this month, against the plan. */
  accountRequests: number;
  accountBytes: number;
  maxRequests: number;
  maxBytes: number;
  /** Document count per collection. */
  collections: Record<string, number>;
  /** Set when the game had no online request for 90 days; its data is deleted at this time (ISO). */
  idleDeleteAt?: string;
}

export interface OnlineStatusResponse {
  sdkInstalled: boolean;
  sdkPath?: string;
  /** Null until the game is published and the account can be read. */
  usage: OnlineUsage | null;
  /** True when signed out or offline, so `usage` could not be asked. */
  cloudUnknown?: boolean;
  /** The local emulator's data for this project. */
  local: { players: number; collections: Record<string, number> };
}

export interface OnlineInstallResponse {
  sdkPath: string;
  changed: boolean;
}

export interface OnlineTestRequest {
  /** A loopback URL of a dev server the caller already started (agents pass this). */
  gameUrl?: string;
}

export interface OnlineTestResponse {
  url: string;
  emulatorUrl: string;
}

export interface OnlineSeedRequest {
  players?: number;
  collection?: string;
  key?: string;
  /** A document `data` to copy; otherwise the shape of an existing document in the collection. */
  data?: unknown;
}

export interface OnlineSeedResponse {
  players: number;
  docs: number;
}

export interface OnlineDataResponse {
  players: number;
  collections: Record<string, number>;
  /** Present when one collection was asked for: newest first, at most 100. */
  docs?: OnlineDoc[];
}

// Daemon to cloud (Supabase functions, signed-in user's JWT).
// GET online-status?shareId=  -> { usage: OnlineUsage | null }
// POST online-reset { shareId } -> { ok: true }
export interface OnlineCloudStatusResponse {
  usage: OnlineUsage | null;
}

export interface OnlineCloudResetRequest {
  shareId: string;
}

// Generated player names. The hosted backend keeps a byte-for-byte copy of this list and function,
// so a player has the same name in the local emulator's tests and on the public link.

/** English and Simplified Chinese pairs, in a fixed order: never reorder, only append. */
export const ONLINE_NAME_ADJECTIVES: ReadonlyArray<readonly [string, string]> = [
  ['Brave', '勇敢的'], ['Swift', '敏捷的'], ['Clever', '聪明的'], ['Lucky', '幸运的'],
  ['Mighty', '强大的'], ['Quiet', '安静的'], ['Sunny', '阳光的'], ['Bold', '大胆的'],
  ['Happy', '快乐的'], ['Gentle', '温柔的'], ['Wild', '狂野的'], ['Calm', '冷静的'],
  ['Fierce', '凶猛的'], ['Jolly', '欢乐的'], ['Nimble', '灵巧的'], ['Proud', '骄傲的'],
  ['Rapid', '飞快的'], ['Shiny', '闪亮的'], ['Sleepy', '困倦的'], ['Tiny', '小小的'],
  ['Giant', '巨大的'], ['Witty', '机智的'], ['Cosmic', '宇宙的'], ['Frosty', '冰霜的'],
  ['Fiery', '火热的'], ['Misty', '朦胧的'], ['Stormy', '风暴的'], ['Golden', '金色的'],
  ['Silver', '银色的'], ['Cheeky', '调皮的'], ['Daring', '无畏的'], ['Merry', '愉快的'],
];

export const ONLINE_NAME_ANIMALS: ReadonlyArray<readonly [string, string]> = [
  ['Fox', '狐狸'], ['Panda', '熊猫'], ['Tiger', '老虎'], ['Otter', '水獭'],
  ['Falcon', '猎鹰'], ['Wolf', '狼'], ['Rabbit', '兔子'], ['Dragon', '龙'],
  ['Turtle', '乌龟'], ['Owl', '猫头鹰'], ['Koala', '考拉'], ['Penguin', '企鹅'],
  ['Lion', '狮子'], ['Dolphin', '海豚'], ['Bear', '熊'], ['Hawk', '鹰'],
  ['Cat', '猫'], ['Dog', '狗'], ['Deer', '鹿'], ['Crane', '鹤'],
  ['Shark', '鲨鱼'], ['Whale', '鲸鱼'], ['Lynx', '猞猁'], ['Badger', '獾'],
  ['Raven', '乌鸦'], ['Gecko', '壁虎'], ['Horse', '马'], ['Monkey', '猴子'],
  ['Squirrel', '松鼠'], ['Hedgehog', '刺猬'], ['Sparrow', '麻雀'], ['Yak', '牦牛'],
];

/**
 * The name for a player's `name_seed`, a non-negative integer below 2^31 the backend picks at
 * registration. `Brave Fox 42` / `勇敢的狐狸 42`.
 */
export function onlinePlayerName(seed: number): { name: string; nameZh: string } {
  const s = Math.abs(Math.trunc(seed)) % 2_147_483_648;
  const adjective = ONLINE_NAME_ADJECTIVES[s % ONLINE_NAME_ADJECTIVES.length]!;
  const animal = ONLINE_NAME_ANIMALS[Math.floor(s / ONLINE_NAME_ADJECTIVES.length) % ONLINE_NAME_ANIMALS.length]!;
  const number = (Math.floor(s / (ONLINE_NAME_ADJECTIVES.length * ONLINE_NAME_ANIMALS.length)) % 99) + 1;
  return { name: `${adjective[0]} ${animal[0]} ${number}`, nameZh: `${adjective[1]}${animal[1]} ${number}` };
}
