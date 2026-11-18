import type { PublishedGameEntry, PublishedGamesResponse } from '@openpixo/contracts';

/**
 * Pure decisions behind the 游戏管理 page (GameHubView). Every public link on the account comes from
 * the cloud's share-list, so a link whose project was deleted or published elsewhere shows too.
 */

export type GameHubFilter = 'all' | 'multiplayer' | 'orphans';

/**
 * A game counts as multiplayer once players have used its online features or its rooms. The cloud
 * cannot see which SDKs a game carries, so a game whose code has them but that nobody played yet is
 * not counted.
 */
export function isMultiplayerGame(entry: PublishedGameEntry): boolean {
  const { online, rooms } = entry;
  return Boolean(online && (online.players > 0 || online.gameRequests > 0)) || rooms.playerMinutes > 0 || rooms.openRooms > 0;
}

export function filterGames(games: PublishedGameEntry[], filter: GameHubFilter): PublishedGameEntry[] {
  if (filter === 'multiplayer') return games.filter(isMultiplayerGame);
  if (filter === 'orphans') return games.filter(entry => entry.project === null);
  return games;
}

export interface GameHubSummary {
  /** Null without a plan (no subscription): links stay live but new ones need one. */
  plan: { live: number; max: number; extra: number } | null;
  planRequired: boolean;
  /** Free player-hours this month, account-wide. */
  roomsFree: { usedMinutes: number; totalMinutes: number } | null;
  roomsPaused: boolean;
  roomsCredits: number;
  openRooms: number;
  online: NonNullable<PublishedGamesResponse['account']>['onlineAccount'];
  onlinePaused: boolean;
  totalPlays: number;
}

export function summarize(list: PublishedGamesResponse): GameHubSummary {
  const plan = list.account?.publishPlan;
  // The account's own room month: games removed since still count for what they used.
  const rooms = list.account?.roomsAccount;
  return {
    plan: plan && !plan.planRequired ? { live: plan.liveGames, max: plan.maxLiveGames, extra: plan.extraGames ?? 0 } : null,
    planRequired: Boolean(plan?.planRequired),
    roomsFree: rooms ? { usedMinutes: rooms.freeMinutesUsed, totalMinutes: rooms.freeMinutesTotal } : null,
    roomsPaused: Boolean(list.account?.paused.rooms),
    roomsCredits: rooms?.creditsCharged ?? 0,
    openRooms: rooms?.openRooms ?? 0,
    online: list.account?.onlineAccount ?? null,
    onlinePaused: Boolean(list.account?.paused.online),
    totalPlays: list.games.reduce((sum, entry) => sum + entry.game.playsThisMonth, 0),
  };
}

/** Whole hours, rounded down for what is left so a creator is never told they have time they do not. */
export function hoursLeft(usedMinutes: number, totalMinutes: number): { left: number; total: number } {
  return { left: Math.max(0, Math.floor((totalMinutes - usedMinutes) / 60)), total: Math.floor(totalMinutes / 60) };
}

/** At or above this share of the plan's online allowance the page warns; below it, the numbers stay out of sight. */
export const ONLINE_WARN_SHARE = 0.8;

/**
 * How much of the plan's online allowance the account has used, as a whole percent, the larger of
 * requests and storage. Creators are not asked to read request counts or bytes: the page only speaks
 * up when this gets close to full.
 */
export function onlineUsedPercent(online: { requests: number; bytes: number; maxRequests: number; maxBytes: number }): number {
  const share = Math.max(online.maxRequests ? online.requests / online.maxRequests : 0, online.maxBytes ? online.bytes / online.maxBytes : 0);
  return Math.min(100, Math.floor(share * 100));
}

export const TILE_TONES = ['violet', 'green', 'amber', 'blue', 'red'] as const;
export type TileTone = (typeof TILE_TONES)[number];

/** A stable theme colour for a game's tile, so the same game always looks the same. */
export function tileTone(shareId: string): TileTone {
  let hash = 0;
  for (const char of shareId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TILE_TONES[hash % TILE_TONES.length]!;
}

/** The first letter or character of a title, for the tile. */
export function tileLetter(title: string): string {
  const first = [...title.trim()][0];
  return first ? first.toLocaleUpperCase() : '?';
}

/** Player-hours, at most one decimal, from the minutes the cloud counts. */
export function playerHours(minutes: number): number {
  return Math.round(minutes / 6) / 10;
}

/** The limit the creator typed, or null when it is not a whole number the cloud accepts. */
export function parseLimit(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,8}$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= 10_000_000 ? value : null;
}
