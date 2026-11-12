import { describe, expect, it } from 'vitest';
import type { OpenPixoLedgerEntry } from '@openpixo/contracts';
import { formatAccountDateTime, formatAccountDateTimeRange } from '../../../src/components/account/account-format';
import { ledgerRows } from '../../../src/components/account/ledger-rows';

function row(id: string, kind: OpenPixoLedgerEntry['kind'], amount: number, balanceAfter: number, createdAt: string, reference: string | null = null): OpenPixoLedgerEntry {
  return { id, kind, amount, balanceAfter, createdAt, reference };
}

describe('formatAccountDateTimeRange', () => {
  const at = (day: number, hour: number, minute: number) => new Date(2026, 10, day, hour, minute).toISOString();

  it('names the date once within a day, in the same form as a single time', () => {
    const range = formatAccountDateTimeRange(at(7, 8, 15), at(7, 9, 9), 'zh-CN');

    expect(range).toBe(`${formatAccountDateTime(at(7, 8, 15), 'zh-CN')} – 09:09`);
    expect(range.match(/11月7日/gu)).toHaveLength(1);
  });

  it('names both dates when the range crosses midnight', () => {
    const start = at(7, 23, 50);
    const end = at(8, 0, 10);

    expect(formatAccountDateTimeRange(start, end, 'en')).toBe(`${formatAccountDateTime(start, 'en')} – ${formatAccountDateTime(end, 'en')}`);
  });
});

describe('ledgerRows', () => {
  it('merges a run of hosted usage into one row with its total, range and latest balance', () => {
    const rows = ledgerRows([
      row('c', 'usage', -1, 97, '2026-11-07T10:20:00Z', 'request-c'),
      row('b', 'usage', -2, 98, '2026-11-07T10:10:00Z', 'request-b'),
      row('a', 'usage', -1, 100, '2026-11-07T10:00:00Z', 'request-a'),
    ]);

    expect(rows).toEqual([{
      id: 'c', kind: 'usage', amount: -4, balanceAfter: 97, count: 3,
      newestAt: '2026-11-07T10:20:00Z', oldestAt: '2026-11-07T10:00:00Z', reference: null,
    }]);
  });

  it('starts a new row after a long pause', () => {
    const rows = ledgerRows([
      row('b', 'usage', -1, 98, '2026-11-07T11:00:00Z'),
      row('a', 'usage', -1, 99, '2026-11-07T10:00:00Z'),
    ]);

    expect(rows.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('never merges across another kind, so every balance stays true', () => {
    const rows = ledgerRows([
      row('c', 'usage', -1, 503, '2026-11-07T10:02:00Z'),
      row('b', 'topup', 500, 504, '2026-11-07T10:01:00Z', 'ord_1'),
      row('a', 'usage', -1, 4, '2026-11-07T10:00:00Z'),
    ]);

    expect(rows.map((entry) => [entry.kind, entry.amount, entry.balanceAfter])).toEqual([
      ['usage', -1, 503], ['topup', 500, 504], ['usage', -1, 4],
    ]);
    expect(rows[1]!.reference).toBe('ord_1');
  });

  it('leaves other kinds one row each, even when they repeat', () => {
    const rows = ledgerRows([
      row('b', 'reserve', -4, 96, '2026-11-07T10:01:00Z', 'job-b'),
      row('a', 'reserve', -4, 100, '2026-11-07T10:00:00Z', 'job-a'),
    ]);

    expect(rows.map((entry) => [entry.id, entry.count, entry.reference])).toEqual([['b', 1, 'job-b'], ['a', 1, 'job-a']]);
  });

  it('drops rows that moved nothing, without letting them split a run', () => {
    const rows = ledgerRows([
      row('c', 'usage', -1, 98, '2026-11-07T10:02:00Z'),
      row('b', 'settle', 0, 99, '2026-11-07T10:01:00Z'),
      row('a', 'usage', -1, 99, '2026-11-07T10:00:00Z'),
    ]);

    expect(rows.map((entry) => [entry.kind, entry.amount, entry.count])).toEqual([['usage', -2, 2]]);
  });

  it('hides the internal request id on a lone usage row', () => {
    expect(ledgerRows([row('a', 'usage', -1, 99, '2026-11-07T10:00:00Z', 'request-a')])[0]!.reference).toBeNull();
  });

  it('keeps rows with an unreadable time apart instead of guessing', () => {
    const rows = ledgerRows([
      row('b', 'usage', -1, 98, 'not a time'),
      row('a', 'usage', -1, 99, '2026-11-07T10:00:00Z'),
    ]);

    expect(rows).toHaveLength(2);
  });
});
