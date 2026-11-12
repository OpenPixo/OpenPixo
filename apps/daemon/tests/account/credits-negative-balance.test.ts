import { describe, expect, it } from 'vitest';
import { creditsLedger, creditsSummary } from '../../src/account/credits.js';

// The cloud lets a balance go below zero when a refund or dispute takes back credits that
// were already spent. The account must still be able to read it, not see a load failure.
describe('a balance below zero after a refund', () => {
  it('reads the summary', () => {
    expect(creditsSummary({ available: -4, reserved: 0, subscription: null }))
      .toEqual({ available: -4, reserved: 0, subscription: null });
  });

  it('reads the history entry that took it below zero', () => {
    const { entries } = creditsLedger({
      entries: [{ id: 'entry-3', kind: 'refund', amount: -1000, balanceAfter: -4, createdAt: '2026-11-05T13:11:39.000Z', reference: 'order-1' }],
      nextCursor: null,
    });
    expect(entries[0]).toMatchObject({ amount: -1000, balanceAfter: -4 });
  });

  it('still refuses a reserved amount below zero, which the cloud never sends', () => {
    expect(() => creditsSummary({ available: 0, reserved: -1, subscription: null })).toThrow();
  });
});
