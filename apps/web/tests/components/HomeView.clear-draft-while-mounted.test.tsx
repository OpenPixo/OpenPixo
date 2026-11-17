// @vitest-environment jsdom

import { act } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({
  PlaceholderCarousel: () => null,
}));

import { clearHomeComposerDraft, HomeView, seedHomeComposerPrompt } from '../../src/components/HomeView';
import { homeHeroPromptText } from '../helpers/home-hero-lexical';

// The new-game dialog clears Home's draft once it has created the game, but
// EntryShell keeps HomeView mounted in its tab. The mounted composer kept the
// idea in its own state, so the next idea pasted on Home was added after it and
// the first message of the next game carried both (owner run, 2026-11-16).
describe('clearHomeComposerDraft while Home is mounted', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('empties the mounted composer as well as the saved draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    render(<HomeView projects={[]} onSubmit={() => undefined} onOpenProject={() => undefined} />);
    await screen.findByTestId('home-hero-input');

    act(() => { seedHomeComposerPrompt('万剑：天劫，割草生存'); });
    await waitFor(() => expect(homeHeroPromptText()).toBe('万剑：天劫，割草生存'));

    // The dialog created the game from that idea.
    act(() => { clearHomeComposerDraft(); });
    // An empty Lexical editor renders one empty paragraph.
    await waitFor(() => expect(homeHeroPromptText().trim()).toBe(''));
    expect(window.localStorage.getItem('pixo:home-composer:prompt')).toBeNull();
  });
});
