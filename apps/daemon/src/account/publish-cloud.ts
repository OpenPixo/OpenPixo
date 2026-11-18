import type { OnlineAccountUsage, PublishedGame, PublishedGameState, PublishPlan, RoomsUsage, ShareListResponse } from '@openpixo/contracts';
import { onlineUsage } from './online-cloud.js';
import { cloudServiceError } from './errors.js';
import { record } from './supabase.js';

/** What `publish-begin` takes. No `shareId` opens a new link. */
export interface PublishBeginInput {
  shareId?: string;
  title: string;
  acceptTerms?: boolean;
  /**
   * The creator agreed to the one-time extra-game charge; true only from a creator request. Publish jobs
   * always send it, false included: the cloud reads its absence as an older app.
   */
  payExtraGame?: boolean;
  files: { path: string; size: number; sha256: string }[];
}

/** The upload session `publish-begin` opens. The token never leaves the daemon. */
export interface PublishBeginResult {
  shareId: string;
  version: number;
  uploadBaseUrl: string;
  uploadToken: string;
  url: string;
}

export interface ShareStatusResult {
  game: PublishedGame | null;
  usage: RoomsUsage | null;
  paused: { publish: boolean; rooms: boolean };
  termsAccepted: boolean;
  termsUrl: string;
  limits: { maxPlayers: number; creditsPerPlayerHour: number };
  /** Absent from a cloud without plan limits. */
  publishPlan?: PublishPlan;
}

export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

function invalid(): never { throw cloudServiceError(); }
function text(value: unknown, max = 2048): string {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : invalid();
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function date(value: unknown): string {
  const result = text(value, 64);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}
/** Links, upload targets and the rules page are opened or written to, so only web URLs pass. */
function httpUrl(value: unknown): string {
  const raw = text(value);
  try {
    const url = new URL(raw);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) invalid();
    return raw;
  } catch { return invalid(); }
}
function shareId(value: unknown): string {
  const id = text(value, 128);
  return SHARE_ID_PATTERN.test(id) ? id : invalid();
}
function gameState(value: unknown): PublishedGameState {
  return value === 'live' || value === 'under_review' || value === 'removed' ? value : invalid();
}

function publishedGame(value: unknown): PublishedGame {
  const item = record(value);
  return { shareId: shareId(item.shareId), url: httpUrl(item.url), title: text(item.title, 500), version: count(item.version),
    state: gameState(item.state), publishedAt: date(item.publishedAt), updatedAt: date(item.updatedAt),
    playsThisMonth: count(item.playsThisMonth),
    ...(typeof item.removedReason === 'string' && item.removedReason ? { removedReason: text(item.removedReason) } : {}),
    ...(item.extraPaid === true ? { extraPaid: true } : {}) };
}

function roomsUsage(value: unknown): RoomsUsage {
  const item = record(value);
  return { month: /^\d{4}-\d{2}$/u.test(text(item.month, 7)) ? item.month as string : invalid(),
    freeMinutesTotal: count(item.freeMinutesTotal), freeMinutesUsed: count(item.freeMinutesUsed),
    playerMinutes: count(item.playerMinutes), creditsCharged: count(item.creditsCharged),
    monthlyCreditLimit: count(item.monthlyCreditLimit), openRooms: count(item.openRooms) };
}

// Select fields explicitly: a cloud response must never forward session/debug fields to clients.
export function publishBeginResponse(value: unknown): PublishBeginResult {
  const item = record(value);
  const version = count(item.version);
  return { shareId: shareId(item.shareId), version: version > 0 ? version : invalid(), uploadBaseUrl: httpUrl(item.uploadBaseUrl),
    uploadToken: text(item.uploadToken, 16_384), url: httpUrl(item.url) };
}

export function publishFinishResponse(value: unknown): PublishedGame {
  return publishedGame(record(value).game);
}

function publishPlan(value: unknown): PublishPlan {
  const item = record(value);
  return { planRequired: bool(item.planRequired), sku: item.sku == null ? null : text(item.sku, 128),
    maxLiveGames: count(item.maxLiveGames), maxGameBytes: count(item.maxGameBytes), liveGames: count(item.liveGames),
    // A cloud without extra games sends neither.
    ...(item.extraGameCredits == null ? {} : { extraGameCredits: count(item.extraGameCredits) }),
    ...(item.extraGames == null ? {} : { extraGames: count(item.extraGames) }) };
}

export function shareStatusResponse(value: unknown): ShareStatusResult {
  const item = record(value);
  const paused = record(item.paused);
  const limits = record(item.limits);
  return { game: item.game == null ? null : publishedGame(item.game), usage: item.usage == null ? null : roomsUsage(item.usage),
    paused: { publish: bool(paused.publish), rooms: bool(paused.rooms) }, termsAccepted: bool(item.termsAccepted),
    // The rules page is an owner step before launch, so an empty value is valid until then.
    termsUrl: item.termsUrl == null || item.termsUrl === '' ? '' : httpUrl(item.termsUrl), limits: { maxPlayers: count(limits.maxPlayers), creditsPerPlayerHour: count(limits.creditsPerPlayerHour) },
    ...(item.publishPlan == null ? {} : { publishPlan: publishPlan(item.publishPlan) }) };
}

export function shareLimitResponse(value: unknown): RoomsUsage {
  return roomsUsage(record(value).usage);
}

const ONLINE_STATES = ['ok', 'read-only', 'paused'] as const;
const ONLINE_REASONS = ['no-plan', 'requests-cap', 'storage-cap', 'paused'] as const;

function onlineAccount(value: unknown): OnlineAccountUsage {
  const item = record(value);
  const month = typeof item.month === 'string' && /^\d{4}-\d{2}$/u.test(item.month) ? item.month : invalid();
  const state = ONLINE_STATES.includes(item.state as typeof ONLINE_STATES[number]) ? item.state as OnlineAccountUsage['state'] : invalid();
  const reason = item.stateReason == null ? undefined
    : ONLINE_REASONS.includes(item.stateReason as typeof ONLINE_REASONS[number]) ? item.stateReason as NonNullable<OnlineAccountUsage['stateReason']> : invalid();
  return { month, state, ...(reason ? { stateReason: reason } : {}), requests: count(item.requests), bytes: count(item.bytes),
    maxRequests: count(item.maxRequests), maxBytes: count(item.maxBytes) };
}

function roomsAccount(value: unknown): ShareListResponse['roomsAccount'] {
  const item = record(value);
  return { month: typeof item.month === 'string' && /^\d{4}-\d{2}$/u.test(item.month) ? item.month : invalid(),
    freeMinutesTotal: count(item.freeMinutesTotal), freeMinutesUsed: count(item.freeMinutesUsed),
    creditsCharged: count(item.creditsCharged), openRooms: count(item.openRooms) };
}

/** `GET share-list`: every link on the account. A cloud answer of more than 1,000 games is not believed. */
export function shareListResponse(value: unknown): ShareListResponse {
  const item = record(value);
  const paused = record(item.paused);
  const limits = record(item.limits);
  const games = Array.isArray(item.games) && item.games.length <= 1000 ? item.games : invalid();
  return {
    games: games.map(entry => {
      const row = record(entry);
      return { game: publishedGame(row.game), rooms: roomsUsage(row.rooms), online: row.online == null ? null : onlineUsage(row.online) };
    }),
    paused: { publish: bool(paused.publish), rooms: bool(paused.rooms), online: bool(paused.online) },
    limits: { maxPlayers: count(limits.maxPlayers), creditsPerPlayerHour: count(limits.creditsPerPlayerHour) },
    publishPlan: publishPlan(item.publishPlan),
    onlineAccount: item.onlineAccount == null ? null : onlineAccount(item.onlineAccount),
    roomsAccount: roomsAccount(item.roomsAccount),
  };
}
