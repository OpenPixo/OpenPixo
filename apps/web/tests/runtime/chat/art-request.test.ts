/**
 * Owner decision 2026-11-11: a project that asks before spending shows an art card the
 * user approves with one click. These pin where the card is cut out of the prose and
 * when it can be approved; the syntax itself is the contract's (`api/art-request`).
 */
import { describe, expect, it } from 'vitest';
import type { ArtBudgetResponse } from '@openpixo/contracts';
import { artSpendingMode, unclaimedApprovalCredits } from '../../../src/runtime/chat/art-budget';
import {
  artRequestStatus,
  lastArtRequest,
  splitOnArtRequests,
  stripTrailingOpenArtRequest,
} from '../../../src/runtime/chat/art-request';

const CARD = '<art-request credits="32">\n- Hero design: 1 image\n- Hero idle, run, jump, hurt: 4 images\n</art-request>';
const budget = { limitCredits: 100, spentCredits: 12, reservedCredits: 0, usedCredits: 12, remainingCredits: 88 };
const state = (over: Partial<ArtBudgetResponse> = {}): ArtBudgetResponse => ({ budget, runActive: false, ...over });

describe('cutting art cards out of a reply', () => {
  it('puts the card where it was and keeps the prose around it', () => {
    const parts = splitOnArtRequests(`Here is the art I'd make.\n\n${CARD}`);
    expect(parts).toEqual([
      { kind: 'text', text: "Here is the art I'd make.\n\n" },
      { kind: 'art-request', card: { credits: 32, items: ['Hero design: 1 image', 'Hero idle, run, jump, hurt: 4 images'], hiddenItems: 0 } },
    ]);
  });

  it('hides a block that is not a valid card instead of showing it as text', () => {
    const parts = splitOnArtRequests('Before\n<art-request credits="0">\n- x\n</art-request>\nAfter');
    expect(parts.map((part) => part.kind)).toEqual(['text', 'art-request', 'text']);
    expect(parts[1]).toEqual({ kind: 'art-request', card: null });
    expect(parts.map((part) => (part.kind === 'text' ? part.text : '')).join('')).not.toContain('art-request');
  });

  it('leaves a card quoted in code alone', () => {
    const text = `The syntax:\n\n\`\`\`\n${CARD}\n\`\`\`\n`;
    expect(splitOnArtRequests(text)).toEqual([{ kind: 'text', text }]);
    expect(lastArtRequest(text)).toBeNull();
  });

  it('approves only the last valid card of a reply', () => {
    const text = `${CARD.replace('32', '8')}\nthen\n${CARD}`;
    expect(lastArtRequest(text)?.credits).toBe(32);
  });

  it.each([
    ['an opened card', `Making a list.\n<art-request credits="32">\n- Hero design: 1`, 'Making a list.\n'],
    ['a half-typed opener', 'Making a list.\n<art-re', 'Making a list.\n'],
    ['the opener with no attributes yet', 'Making a list.\n<art-request', 'Making a list.\n'],
  ])('keeps %s out of the prose while streaming', (_name, text, visible) => {
    expect(stripTrailingOpenArtRequest(text)).toEqual({ text: visible, hadOpenCard: true });
  });

  it('leaves a finished card and ordinary text alone while streaming', () => {
    expect(stripTrailingOpenArtRequest(`Done.\n${CARD}`)).toEqual({ text: `Done.\n${CARD}`, hadOpenCard: false });
    expect(stripTrailingOpenArtRequest('a < b')).toEqual({ text: 'a < b', hadOpenCard: false });
  });
});

describe('whether an art card can be approved', () => {
  const card = { credits: 32, items: ['Hero design: 1 image'], hiddenItems: 0 };
  const base = { card, latest: true, nextUserContent: undefined, approvalMessage: 'Approved: make this art (up to 32 credits).', busy: false, budget: state() };

  it('is ready on the latest reply, between turns, within the budget', () => {
    expect(artRequestStatus(base)).toEqual({ kind: 'ready' });
  });

  it('is answered once the approval message follows it', () => {
    expect(artRequestStatus({ ...base, nextUserContent: 'Approved: make this art (up to 32 credits).' })).toEqual({ kind: 'approved' });
  });

  it.each([
    ['the conversation moved on', { nextUserContent: 'Make the hero blue instead' }, 'stale'],
    ['it is not on the latest reply', { latest: false }, 'stale'],
    ['a run is streaming', { busy: true }, 'busy'],
    ['the daemon says a run is active', { budget: state({ runActive: true }) }, 'busy'],
    ['the budget is not read yet', { budget: null }, 'loading'],
  ])('waits when %s', (_name, over, kind) => {
    expect(artRequestStatus({ ...base, ...over }).kind).toBe(kind);
  });

  it('says what it needs when the budget has less left', () => {
    expect(artRequestStatus({ ...base, budget: state({ budget: { ...budget, usedCredits: 80, remainingCredits: 20 } }) }))
      .toEqual({ kind: 'over-budget', needed: 32, left: 20 });
    expect(artRequestStatus({ ...base, budget: state({ budget: null }) })).toEqual({ kind: 'over-budget', needed: 32, left: 0 });
  });
});

describe('the spending mode as the daemon reports it', () => {
  it('reads an older daemon with no mode as asking first', () => {
    expect(artSpendingMode(state())).toBe('ask');
    expect(artSpendingMode(null)).toBe('ask');
    expect(artSpendingMode(state({ mode: 'auto' }))).toBe('auto');
  });

  it('mentions only an approval no run has claimed yet', () => {
    const approval = { approvedCredits: 32, usedCredits: 0, remainingCredits: 32, runId: null, approvedAt: 1 };
    expect(unclaimedApprovalCredits(state({ approval }))).toBe(32);
    expect(unclaimedApprovalCredits(state({ approval: { ...approval, runId: 'run-1' } }))).toBeNull();
    expect(unclaimedApprovalCredits(state({ approval: { ...approval, remainingCredits: 0 } }))).toBeNull();
    expect(unclaimedApprovalCredits(state({ approval: null }))).toBeNull();
  });
});
