import type { OpenPixoLedgerEntry, OpenPixoLedgerKind } from '@openpixo/contracts';

/** Ledger kinds that move credits because something was made or bought; a hold and its release cancel out. */
const SPEND_KINDS: ReadonlySet<OpenPixoLedgerKind> = new Set<OpenPixoLedgerKind>([
  'reserve', 'settle', 'release', 'usage', 'purchase', 'multiplayer',
]);

export interface UsageDay {
  /** Local midnight that starts the day, in ms. */
  start: number;
  /** Credits used that day, never negative. */
  credits: number;
}

export interface UsageDays {
  days: UsageDay[];
  total: number;
  /** How many days used any credits. */
  activeDays: number;
  /**
   * Local midnight of the oldest day the loaded entries fully cover, when that
   * is later than the first day shown: older records exist but were not read.
   */
  coveredFrom: number | null;
}

function localMidnight(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Credits used per local day over the last `count` days, today last, from the
 * ledger entries read so far (newest first). Only spend kinds count; grants,
 * top-ups, refunds and plan expiry are not usage. `hasOlder` says whether the
 * ledger has entries older than those read, which decides `coveredFrom`.
 */
export function usageDays(entries: readonly OpenPixoLedgerEntry[], count: number, now: number, hasOlder: boolean): UsageDays {
  const today = localMidnight(now);
  const days: UsageDay[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    // Step through dates rather than subtracting 24 h, so a daylight-saving day stays one day.
    const date = new Date(today);
    date.setDate(date.getDate() - back);
    days.push({ start: date.getTime(), credits: 0 });
  }
  const first = days[0]!.start;
  const index = new Map(days.map((day, position) => [day.start, position]));
  let oldestRead = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const at = Date.parse(entry.createdAt);
    if (Number.isNaN(at)) continue;
    oldestRead = Math.min(oldestRead, at);
    if (!SPEND_KINDS.has(entry.kind) || at < first) continue;
    const position = index.get(localMidnight(at));
    if (position !== undefined) days[position]!.credits -= entry.amount;
  }
  let total = 0;
  let activeDays = 0;
  for (const day of days) {
    // A release can land the day after its hold; a day never shows negative use.
    day.credits = Math.max(0, day.credits);
    total += day.credits;
    if (day.credits > 0) activeDays += 1;
  }
  let coveredFrom: number | null = null;
  if (hasOlder && Number.isFinite(oldestRead) && oldestRead > first) {
    // The oldest read entry's day may also hold unread entries, so coverage starts the day after.
    const next = new Date(localMidnight(oldestRead));
    next.setDate(next.getDate() + 1);
    coveredFrom = Math.min(today, next.getTime());
  }
  return { days, total, activeDays, coveredFrom };
}
