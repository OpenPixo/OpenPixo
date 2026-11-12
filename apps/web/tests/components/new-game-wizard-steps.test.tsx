// @vitest-environment jsdom
// What the setup screens show: the genre cards everyone sees, and what a first-timer sees compared with someone who has made games before.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtStyle } from '@openpixo/contracts';

import { ArtStep, ConceptStep, SetupStep, ViewStep } from '../../src/components/new-game/WizardSteps';
import { FEATURED_GENRES, emptyDraft, withSuggestedSetup, type WizardDraft } from '../../src/components/new-game/wizard-state';
import { I18nProvider } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { zhCN } from '../../src/i18n/locales/zh-CN';

afterEach(cleanup);

const pixel = {
  id: 'pixel-16-bit', title: 'Retro pixel · 16-bit', description: 'Classic 16-bit console pixel art.', dimension: ['2d'], medium: ['pixel'],
  palette: ['#182238', '#F0D8A8'], previews: [],
} as unknown as ArtStyle;

/** Renders a screen with a live draft; `seen` exposes the latest draft to the test. */
function withDraft(initial: WizardDraft, renderStep: (draft: WizardDraft, update: (patch: Partial<WizardDraft>) => void) => JSX.Element) {
  const seen: { draft: WizardDraft } = { draft: initial };
  function Host() {
    const [draft, setDraft] = useState(initial);
    seen.draft = draft;
    return renderStep(draft, patch => setDraft(current => ({ ...current, ...patch })));
  }
  render(<Host />);
  return seen;
}

function art(beginner: boolean, initial = emptyDraft('t')) {
  return withDraft(initial, (draft, update) => (
    <ArtStep draft={draft} update={update} showProblems={false} styleList={[pixel]} stylesLoading={false} stylesFailed={false}
      onRetryStyles={vi.fn()} references={[]} onReferences={vi.fn()} onReferenceError={vi.fn()} beginner={beginner} />
  ));
}

describe('art screen', () => {
  it('picks a style without copying its palette, and shows the style description on the card', () => {
    const seen = art(false);
    const card = screen.getByRole('radio', { name: pixel.title });
    expect(card.textContent).toContain(pixel.description);
    fireEvent.click(card);
    expect(seen.draft.styleId).toBe('pixel-16-bit');
    expect(seen.draft.palette).toEqual([]);
    // The pixel size still follows the style, silently.
    expect(seen.draft.pixelSize).toBe(16);
    expect(screen.queryByRole('button', { name: 'Remove #182238', hidden: true })).toBeNull();
    expect(screen.getByText(en['game.wizard.paletteHint'])).toBeTruthy();
  });

  it('offers no "style sample first" toggle to anyone', () => {
    art(false);
    expect(screen.queryByRole('checkbox', { name: /style sample/i, hidden: true })).toBeNull();
  });

  it('shows a first-timer only a description and reference images under More settings', () => {
    art(true);
    expect(screen.getByRole('button', { name: en['game.wizard.artAdvancedBeginner'] })).toBeTruthy();
    for (const hidden of [en['game.wizard.palette'], en['game.wizard.pixelSize'], en['game.wizard.artSource']]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    expect(screen.getByText(en['game.wizard.references'])).toBeTruthy();
  });

  it('keeps colours, pixel size and who makes the art for everyone else', () => {
    art(false);
    for (const shown of [en['game.wizard.palette'], en['game.wizard.pixelSize'], en['game.wizard.artSource']]) {
      expect(screen.getByText(shown)).toBeTruthy();
    }
  });
});

function concept(beginner: boolean, initial: WizardDraft = { ...emptyDraft('t'), languages: ['en'] }, locale: 'en' | 'zh-CN' = 'en') {
  return withDraft(initial, (draft, update) => (
    <I18nProvider initial={locale}><ConceptStep draft={draft} update={update} showProblems={false} isNew beginner={beginner} /></I18nProvider>
  ));
}

describe('concept screen', () => {
  for (const [locale, dict] of [['en', en], ['zh-CN', zhCN]] as const) {
    it(`shows everyone the featured genres as picture cards, in order, with a name and an explanation (${locale})`, () => {
      for (const beginner of [true, false]) {
        concept(beginner, undefined, locale);
        const cards = within(screen.getByTestId('genre-featured')).getAllByRole('radio');
        expect(cards).toHaveLength(12);
        expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(FEATURED_GENRES.map(genre => dict[`game.wizard.genre.${genre}` as keyof typeof dict]));
        cards.forEach((card, index) => {
          const genre = FEATURED_GENRES[index]!;
          expect(card.querySelector('img')?.getAttribute('src')).toBe(`/new-game/genres/${genre}.webp`);
          const hint = dict[`game.wizard.genreHint.${genre}` as keyof typeof dict];
          expect(card.textContent).toContain(dict[`game.wizard.genre.${genre}` as keyof typeof dict]);
          expect(card.textContent).toContain(hint);
          expect(document.getElementById(card.getAttribute('aria-describedby')!)?.textContent).toBe(hint);
        });
        cleanup();
      }
    });
  }

  it('chooses a card like a style card, with one tab stop and arrow keys', () => {
    const seen = concept(false);
    const cards = within(screen.getByTestId('genre-featured')).getAllByRole('radio');
    expect(cards.map(card => card.tabIndex)).toEqual(cards.map((_, index) => (index === 0 ? 0 : -1)));
    fireEvent.click(screen.getByRole('radio', { name: en['game.wizard.genre.idle'] }));
    expect(seen.draft.genre).toBe('idle');
    const idle = screen.getByTestId('genre-card-idle');
    expect(idle.getAttribute('aria-checked')).toBe('true');
    expect(idle.tabIndex).toBe(0);
    idle.focus();
    fireEvent.keyDown(idle, { key: 'ArrowRight' });
    expect(seen.draft.genre).toBe('shooter');
    expect(document.activeElement).toBe(screen.getByTestId('genre-card-shooter'));
    // The folded chips are skipped by the arrow keys while More types is closed.
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(seen.draft.genre).toBe('visual-novel');
  });

  it('shows a calm placeholder, not a broken image, when a picture fails to load', () => {
    concept(false);
    const card = screen.getByTestId('genre-card-platformer');
    fireEvent.error(card.querySelector('img')!);
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('[data-failed="true"]')).toBeTruthy();
    expect(card.getAttribute('aria-label')).toBe(en['game.wizard.genre.platformer']);
  });

  it('folds every other genre and "something else" under More types, explained under the chips', () => {
    concept(true);
    const more = screen.getByTestId('genre-more');
    expect(more.getAttribute('data-open')).toBe('false');
    const chips = within(more).getAllByRole('radio', { hidden: true }).map(radio => radio.textContent);
    for (const genre of FEATURED_GENRES) expect(chips).not.toContain(en[`game.wizard.genre.${genre}` as keyof typeof en]);
    expect(chips).toContain(en['game.wizard.genre.tactics']);
    expect(chips.at(-1)).toBe(en['game.wizard.genre.custom']);
    fireEvent.click(within(more).getByRole('button', { name: en['game.wizard.genreMore'] }));
    expect(more.getAttribute('data-open')).toBe('true');
    const explain = screen.getByTestId('genre-explain');
    expect(explain.textContent).toBe(en['game.wizard.genreHintEmpty']);
    const tactics = screen.getByRole('radio', { name: en['game.wizard.genre.tactics'] });
    fireEvent.click(tactics);
    expect(explain.textContent).toContain(en['game.wizard.genreHint.tactics']);
    expect(tactics.getAttribute('aria-describedby')).toBe(explain.id);
    fireEvent.mouseEnter(screen.getByRole('radio', { name: en['game.wizard.genre.rhythm'] }));
    expect(explain.textContent).toContain(en['game.wizard.genreHint.rhythm']);
    fireEvent.mouseLeave(screen.getByRole('radio', { name: en['game.wizard.genre.rhythm'] }));
    expect(explain.textContent).toContain(en['game.wizard.genreHint.tactics']);
    // No studio and no languages for a first game.
    expect(screen.queryByLabelText(new RegExp(`^${en['game.wizard.studio']}`))).toBeNull();
    expect(screen.queryByText(en['game.wizard.languages'])).toBeNull();
  });

  it('opens More types when the draft already holds one of its genres, and keeps it closed for a featured one', () => {
    concept(false, { ...emptyDraft('t'), languages: ['en'], genre: 'tactics' });
    expect(screen.getByTestId('genre-more').getAttribute('data-open')).toBe('true');
    cleanup();
    concept(false, { ...emptyDraft('t'), languages: ['en'], genre: 'custom', genreCustom: 'rhythm fighter' });
    expect(screen.getByTestId('genre-more').getAttribute('data-open')).toBe('true');
    cleanup();
    concept(false, { ...emptyDraft('t'), languages: ['en'], genre: 'roguelike' });
    expect(screen.getByTestId('genre-more').getAttribute('data-open')).toBe('false');
    expect(screen.getByTestId('genre-card-roguelike').getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the studio and languages for everyone else', () => {
    concept(false);
    expect(screen.getByLabelText(new RegExp(`^${en['game.wizard.studio']}`))).toBeTruthy();
    expect(screen.getByText(en['game.wizard.languages'])).toBeTruthy();
  });
});

describe('view screen', () => {
  it('says what each view looks like on the card, not in a tooltip', () => {
    withDraft(emptyDraft('t'), (draft, update) => <ViewStep draft={draft} update={update} showProblems={false} beginner isNew />);
    const side = screen.getByRole('radio', { name: en['game.wizard.perspective.side-2d'] });
    expect(side.textContent).toContain(en['game.wizard.perspectiveHint.side-2d']);
    expect(side.getAttribute('title')).toBeNull();
  });
});

describe('engine screen', () => {
  const answered = withSuggestedSetup({ ...emptyDraft('t'), perspective: 'side-2d', pixelSize: 16 });

  it('keeps the suggested screen size from a first-timer and shows only the controls', () => {
    withDraft(answered, (draft, update) => <SetupStep draft={draft} update={update} showProblems={false} lead={<span />} beginner />);
    expect(screen.queryByText(en['game.wizard.resolution'])).toBeNull();
    expect(screen.queryByText(en['game.wizard.scaling'])).toBeNull();
    expect(screen.getByText(en['game.wizard.controls'])).toBeTruthy();
    expect(screen.getByText(en['game.wizard.controlsHintBeginner'])).toBeTruthy();
  });

  it('shows the screen size and scaling to everyone else', () => {
    withDraft(answered, (draft, update) => <SetupStep draft={draft} update={update} showProblems={false} lead={<span />} />);
    expect(screen.getByText(en['game.wizard.resolution'])).toBeTruthy();
    expect(screen.getByText(en['game.wizard.scaling'])).toBeTruthy();
  });
});
