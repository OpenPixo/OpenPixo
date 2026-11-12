import { describe, expect, it } from 'vitest';
import {
  ART_REQUEST_EXAMPLE,
  ART_REQUEST_MAX_ITEMS,
  findArtRequestBlocks,
  mediaFailureNextStep,
  parseArtApprovalCredits,
  parseArtRequest,
  parseArtSpendingMode,
} from '../src/index.js';
import { GAME_ART_CARD_HEADING, renderArtBudgetTurnNote, renderGameMediaGenerationContract } from '../src/prompts/media-contract.js';

// Owner decision 2026-11-11: a project either asks before spending (one art card per
// list, approved with a click) or spends within its budget. The budget caps both.

const budget = { limitCredits: 100, usedCredits: 20, remainingCredits: 80 };

describe('art card syntax', () => {
  it('reads the example the prompt teaches', () => {
    expect(parseArtRequest(ART_REQUEST_EXAMPLE)).toEqual({
      credits: 32, items: ['Hero design: 1 image', 'Hero idle, run, jump, hurt: 4 images'], hiddenItems: 0,
    });
  });

  it('takes the last valid card and skips broken ones', () => {
    const text = `Plan.\n<art-request credits="10">\n- Coin: 1 image\n</art-request>\nMore.\n<art-request credits="0">\n- Nothing\n</art-request>\n<art-request credits="12">\n</art-request>`;
    expect(parseArtRequest(text)?.credits).toBe(10);
    expect(findArtRequestBlocks(text).map(block => block.card?.credits ?? null)).toEqual([10, null, null]);
  });

  it('is no card until the block is complete', () => {
    expect(parseArtRequest('<art-request credits="8">\n- Coin: 1 image\n')).toBeNull();
  });

  it('caps the lines it draws', () => {
    const lines = Array.from({ length: ART_REQUEST_MAX_ITEMS + 3 }, (_, index) => `- Item ${index}`).join('\n');
    const card = parseArtRequest(`<art-request credits="99">\n${lines}\n</art-request>`)!;
    expect(card.items).toHaveLength(ART_REQUEST_MAX_ITEMS);
    expect(card.hiddenItems).toBe(3);
  });

  it('accepts only whole positive credits and known modes', () => {
    expect(parseArtApprovalCredits(5)).toBe(5);
    for (const value of [0, -1, 1.5, '5', null]) expect(parseArtApprovalCredits(value)).toBeNull();
    expect(parseArtSpendingMode('ask')).toBe('ask');
    expect(parseArtSpendingMode('auto')).toBe('auto');
    expect(parseArtSpendingMode('always')).toBeNull();
  });

  it('maps the refusal to its own next step', () => {
    expect(mediaFailureNextStep({ code: 'ART_APPROVAL_REQUIRED' })).toBe('approve-art');
  });
});

describe('art budget turn note', () => {
  it('reads as before without a spending mode', () => {
    expect(renderArtBudgetTurnNote(budget)).toBe('Art budget this turn: 20 of 100 credits used, 80 left. Keep the art, audio and 3D models you make within it.');
  });

  it('says to go ahead without a card when the project spends within its budget', () => {
    const note = renderArtBudgetTurnNote(budget, { mode: 'auto' });
    expect(note).toContain('spends within its budget without asking');
    expect(note).toContain('no art card');
  });

  it('asks for a card when nothing is approved', () => {
    for (const approval of [null, { approvedCredits: 30, usedCredits: 30, remainingCredits: 0, runId: 'run-1', approvedAt: 1 },
      { approvedCredits: 30, usedCredits: 4, remainingCredits: 26, runId: 'run-1', approvedAt: 1 }]) {
      const note = renderArtBudgetTurnNote(budget, { mode: 'ask', approval });
      expect(note).toContain('no art is approved for this turn');
      expect(note).toContain('art card');
    }
  });

  it('names an unclaimed approval, never more than the budget has left', () => {
    const note = renderArtBudgetTurnNote({ limitCredits: 100, usedCredits: 90, remainingCredits: 10 },
      { mode: 'ask', approval: { approvedCredits: 30, usedCredits: 0, remainingCredits: 30, runId: null, approvedAt: 1 } });
    expect(note).toContain('approved up to 30 credits');
    expect(note).toContain('(10 can still be spent)');
  });

  it('needs no card for style samples while planning', () => {
    expect(renderArtBudgetTurnNote(budget, { mode: 'ask', planning: true })).toContain('need no art card');
  });

  it('says a used-up budget is used up in every mode', () => {
    for (const mode of ['ask', 'auto'] as const) {
      expect(renderArtBudgetTurnNote({ limitCredits: 100, usedCredits: 100, remainingCredits: 0 }, { mode })).toContain('It is used up');
    }
  });
});

describe('art card rules in the media contract', () => {
  it('teaches the card only when something is paid from the budget', () => {
    const catalog = { image: ['openpixo-image'], video: [], audioMusic: [], audioSpeech: [], audioSfx: [] };
    const paid = renderGameMediaGenerationContract({ modelCatalog: { ...catalog, budgetImageModels: ['openpixo-image'] } });
    expect(paid).toContain(GAME_ART_CARD_HEADING);
    expect(paid).toContain(ART_REQUEST_EXAMPLE);
    expect(paid).toContain('`approve-art`');
    const free = renderGameMediaGenerationContract({ modelCatalog: { ...catalog, image: ['gpt-image-2'] } });
    expect(free).not.toContain(GAME_ART_CARD_HEADING);
  });
});
