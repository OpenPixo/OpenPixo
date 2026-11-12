import { describe, expect, it } from 'vitest';
import { creditsLedger } from '../../src/account/credits.js';
import { ledgerKindLabel } from '../../src/account/credits-cli.js';

describe('credit history with live room charges', () => {
  it('keeps a multiplayer charge readable alongside other entries', () => {
    const { entries } = creditsLedger({
      entries: [
        { id: 'entry-2', kind: 'multiplayer', amount: -7, balanceAfter: 993, createdAt: '2026-11-04T10:00:00.000Z', reference: 'room-1' },
        { id: 'entry-1', kind: 'topup', amount: 1000, balanceAfter: 1000, createdAt: '2026-11-04T09:00:00.000Z', reference: null },
      ],
      nextCursor: null,
    });
    expect(entries.map(entry => entry.kind)).toEqual(['multiplayer', 'topup']);
    expect(entries[0]?.amount).toBe(-7);
  });

  it('names a room charge in plain words in pixo credits history', () => {
    expect(ledgerKindLabel('multiplayer')).toBe('Live rooms / 联机房间');
    expect(ledgerKindLabel('topup')).toBe('topup');
  });
});
