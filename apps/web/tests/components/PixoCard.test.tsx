// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PixoCardRuleProposal, PixoCardVerifyScorecard } from '@openpixo/contracts';
import { PixoCardView } from '../../src/components/PixoCard';
import { I18nProvider } from '../../src/i18n';

const RULE_CARD: PixoCardRuleProposal = {
  kind: 'rule-proposal',
  name: 'Palette only',
  description: 'Only use the brand palette.',
  assertion: 'Every CSS color must match a brand token.',
  check: 'Scan CSS color literals.',
  rationale: 'The user corrected off-palette colors.',
};

function renderRuleCard(card: PixoCardRuleProposal = RULE_CARD, instanceScope = 'scope-a') {
  return render(
    <I18nProvider initial="en">
      <PixoCardView card={card} instanceScope={instanceScope} />
    </I18nProvider>,
  );
}

function renderScorecard(card: PixoCardVerifyScorecard) {
  return render(
    <I18nProvider initial="en">
      <PixoCardView card={card} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('retired verification scorecard presentation', () => {
  it('hides a passing scorecard including its summary and all checks', () => {
    const { container } = renderScorecard({
      kind: 'verify-scorecard',
      status: 'pass',
      summary: '3 checks passed',
      rows: [
        { rule: 'Uses brand colors', status: 'pass' },
        { rule: 'Has accessible labels', status: 'pass' },
        { rule: 'Fits the viewport', status: 'pass' },
      ],
    });

    expect(container.querySelector('[data-pixo-card="verify-scorecard"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('hides partial verification including failed and fixed check details', () => {
    const { container } = renderScorecard({
      kind: 'verify-scorecard',
      status: 'partial',
      summary: '2/3 checks passed',
      rows: [
        { rule: 'Uses brand colors', status: 'pass' },
        { rule: 'Has accessible labels', status: 'fail', note: 'Missing the export label.' },
        { rule: 'Fits the viewport', status: 'fixed', note: 'Reduced the card width.' },
      ],
    });

    expect(container.querySelector('[data-pixo-card="verify-scorecard"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('retired rule proposal presentation', () => {
  it.each([
    null,
    JSON.stringify({ status: 'saved', name: RULE_CARD.name, id: 'existing-rule' }),
    JSON.stringify({ status: 'discarded' }),
  ])('does not reopen an action or touch memory/storage for cached decision %s', (cached) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const storageKey = 'pixo:rule-proposal-decision:existing';
    if (cached !== null) window.localStorage.setItem(storageKey, cached);
    const before = { ...window.localStorage };
    const first = renderRuleCard();
    expect(first.container.textContent).toBe('');
    expect(first.container.querySelector('[data-pixo-card]')).toBeNull();
    expect(first.container.querySelector('button')).toBeNull();
    first.unmount();
    const second = renderRuleCard(RULE_CARD, 'another-project:conversation:message');
    expect(second.container.textContent).toBe('');
    expect(second.container.querySelector('button')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect({ ...window.localStorage }).toEqual(before);
  });
});
