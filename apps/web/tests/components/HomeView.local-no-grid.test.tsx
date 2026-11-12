// @vitest-environment jsdom
//
// OPEND-3140 — Home carries no browsable 最近项目 grid (filter / sort / view
// controls stay on the 项目 page and the rail). What it does carry is the
// guided start: a returning user sees their latest games as a compact strip
// above the composer, so the next step is one click away.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({
  PlaceholderCarousel: () => null,
}));

import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';

const PROJECTS = [
  { id: 'p1', name: 'Local landing page', createdAt: 1, updatedAt: 2, skillId: null, },
  { id: 'p2', name: 'Local brand deck', createdAt: 1, updatedAt: 1, skillId: null, },
];

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/workspace/context')) return Response.json({ context: null });
    if (url.endsWith('/api/plugins')) return Response.json({ plugins: [] });
    return Response.json({});
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('HomeView in the local shell', () => {
  it('shows only the latest game in the continue row without collection controls', async () => {
    stubFetch();
    render(
      <I18nProvider initial="en">
        <HomeView
          projects={PROJECTS as never}
          onSubmit={() => undefined}
          onOpenProject={() => undefined}
        />
      </I18nProvider>,
    );
    expect(await screen.findByTestId('home-hero')).toBeTruthy();
    expect(screen.queryByTestId('recent-projects-strip')).toBeNull();
    expect(document.querySelector('.recent-projects')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recent projects' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Pick up where you left off' })).toBeTruthy();
    const names = screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
    expect(names).toEqual(['Local landing page']);
    expect(screen.queryByText('Local brand deck')).toBeNull();
  });
});
