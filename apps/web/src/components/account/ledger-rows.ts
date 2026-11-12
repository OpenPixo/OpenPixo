import type { OpenPixoLedgerEntry, OpenPixoLedgerKind } from '@openpixo/contracts';

/** A longer pause than this means the user came back later, so it starts a new row. */
export const LEDGER_USAGE_PAUSE_MS = 30 * 60 * 1000;

/** One line of the activity list: a ledger entry, or a run of hosted usage shown as one. */
export interface LedgerRow {
  /** The newest entry's id. */
  id: string;
  kind: OpenPixoLedgerKind;
  amount: number;
  balanceAfter: number;
  /** How many ledger entries this row stands for. */
  count: number;
  newestAt: string;
  oldestAt: string;
  reference: string | null;
}

function pauseBetween(newerIso: string, olderIso: string): number {
  return Date.parse(newerIso) - Date.parse(olderIso);
}

/**
 * Turns ledger entries, newest first, into what the activity list shows.
 *
 * The cloud writes a hosted usage entry for each model request that crossed a
 * whole credit, so one conversation leaves a long run of -1. Only entries with
 * nothing else between them merge, which keeps every row's balance true: it is
 * the balance after the row's newest entry, and the row's amount explains the
 * whole change since the row below.
 */
export function ledgerRows(entries: readonly OpenPixoLedgerEntry[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const entry of entries) {
    if (entry.amount === 0) continue;
    const current = rows[rows.length - 1];
    if (entry.kind === 'usage' && current?.kind === 'usage' && pauseBetween(current.oldestAt, entry.createdAt) <= LEDGER_USAGE_PAUSE_MS) {
      current.amount += entry.amount;
      current.count += 1;
      current.oldestAt = entry.createdAt;
      continue;
    }
    rows.push({
      id: entry.id,
      kind: entry.kind,
      amount: entry.amount,
      balanceAfter: entry.balanceAfter,
      count: 1,
      newestAt: entry.createdAt,
      oldestAt: entry.createdAt,
      // A usage reference is an internal request id, not something to quote to support.
      reference: entry.kind === 'usage' ? null : entry.reference,
    });
  }
  return rows;
}
