import { describe, expect, it } from 'vitest';
import type { OpenPixoLedgerEntry, OpenPixoLedgerKind } from '@openpixo/contracts';
import { usageDays } from '../../../src/components/account/usage-days';

const NOW = new Date(2026, 10, 21, 15, 0).getTime();

function at(daysAgo: number, hour = 12): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function entry(id: string, kind: OpenPixoLedgerKind, amount: number, createdAt: string): OpenPixoLedgerEntry {
  return { id, kind, amount, balanceAfter: 0, createdAt, reference: null };
}

describe('usageDays', () => {
  it('sums what was used per local day, today last, and ignores grants and top-ups', () => {
    const result = usageDays([
      entry('a', 'usage', -3, at(0, 9)),
      entry('b', 'usage', -2, at(0, 8)),
      entry('c', 'topup', 500, at(1)),
      entry('d', 'reserve', -40, at(2)),
      entry('e', 'release', 10, at(2)),
      entry('f', 'subscription_grant', 2500, at(3)),
      entry('g', 'purchase', -600, at(10)),
    ], 7, NOW, false);

    expect(result.days).toHaveLength(7);
    expect(result.days.map((day) => day.credits)).toEqual([0, 0, 0, 0, 30, 0, 5]);
    expect(result.total).toBe(35);
    expect(result.activeDays).toBe(2);
    expect(result.coveredFrom).toBeNull();
  });

  it('never shows a day as negative when a release lands after its hold', () => {
    const result = usageDays([entry('r', 'release', 20, at(0)), entry('h', 'reserve', -20, at(1))], 7, NOW, false);
    expect(result.days.at(-1)!.credits).toBe(0);
    expect(result.days.at(-2)!.credits).toBe(20);
  });

  it('says from when it counts when older records were not read yet', () => {
    const result = usageDays([entry('a', 'usage', -1, at(0)), entry('b', 'usage', -1, at(3))], 30, NOW, true);
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() - 2);
    expected.setHours(0, 0, 0, 0);
    expect(result.coveredFrom).toBe(expected.getTime());
  });

  it('counts the whole range once the read reaches past its first day', () => {
    const result = usageDays([entry('a', 'usage', -1, at(0)), entry('b', 'usage', -1, at(9))], 7, NOW, true);
    expect(result.coveredFrom).toBeNull();
  });
});
