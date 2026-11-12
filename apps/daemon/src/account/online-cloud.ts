import { ONLINE_NAME_PATTERN, type OnlineState, type OnlineUsage } from '@openpixo/contracts';
import { cloudServiceError } from './errors.js';
import { record } from './supabase.js';

/**
 * Creator calls for a published game's online features (specs/current/online-features.md):
 * `GET online-status?shareId=` and `POST online-reset { shareId }`, with the signed-in user's JWT.
 * Fields are selected explicitly so nothing else the cloud sends reaches a client.
 */

function invalid(): never { throw cloudServiceError(); }
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function state(value: unknown): OnlineState {
  return value === 'ok' || value === 'read-only' || value === 'paused' ? value : invalid();
}
const REASONS = ['no-plan', 'requests-cap', 'storage-cap', 'paused'] as const;
function reason(value: unknown): NonNullable<OnlineUsage['stateReason']> {
  return REASONS.includes(value as typeof REASONS[number]) ? value as typeof REASONS[number] : invalid();
}
function collections(value: unknown): Record<string, number> {
  const entries = Object.entries(record(value));
  if (entries.length > 100) invalid();
  return Object.fromEntries(entries.map(([name, n]) => [ONLINE_NAME_PATTERN.test(name) ? name : invalid(), count(n)]));
}
function isoDate(value: unknown): string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)) ? value : invalid();
}

export function onlineUsage(value: unknown): OnlineUsage {
  const item = record(value);
  const month = typeof item.month === 'string' && /^\d{4}-\d{2}$/u.test(item.month) ? item.month : invalid();
  return { month, state: state(item.state), ...(item.stateReason == null ? {} : { stateReason: reason(item.stateReason) }),
    gameRequests: count(item.gameRequests), gameBytes: count(item.gameBytes), players: count(item.players),
    accountRequests: count(item.accountRequests), accountBytes: count(item.accountBytes),
    maxRequests: count(item.maxRequests), maxBytes: count(item.maxBytes), collections: collections(item.collections),
    ...(item.idleDeleteAt == null ? {} : { idleDeleteAt: isoDate(item.idleDeleteAt) }) };
}

export function onlineStatusResponse(value: unknown): OnlineUsage | null {
  const usage = record(value).usage;
  return usage == null ? null : onlineUsage(usage);
}

/** `{ ok: true }`, or an empty 204. */
export function onlineResetResponse(value: unknown): void {
  if (value !== null && record(value).ok !== true) invalid();
}
