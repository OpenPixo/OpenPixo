// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryNavRail } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/components/quest/QuestPanel', () => ({ QuestPanel: () => null }));

afterEach(cleanup);

function renderRail() {
  const onOpenSearch = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <I18nProvider initial="en">
        <EntryNavRail
          view="home"
          open={open}
          onToggleRail={() => setOpen((value) => !value)}
          onViewChange={() => {}}
          onNewProject={() => {}}
          onOpenSearch={onOpenSearch}
        />
      </I18nProvider>
    );
  }
  render(<Harness />);
  return { onOpenSearch };
}

describe('entry rail search and header toggle', () => {
  it('places search before the destinations and advertises its shortcut', () => {
    const { onOpenSearch } = renderRail();
    const search = screen.getByTestId('entry-nav-search-item');
    const items = document.querySelectorAll('.entry-nav-rail__btn');
    expect(items[0]).toBe(search);
    expect(items[1]).toBe(screen.getByTestId('entry-nav-home'));
    expect(search.textContent).toMatch(/Search.*(?:Ctrl K|⌘ K)/);
    expect(search.getAttribute('aria-keyshortcuts')).toMatch(/(?:Control|Meta)\+K/);
    fireEvent.click(search);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('keeps the expand action reachable while collapsed content is inert', () => {
    renderRail();
    const toggle = screen.getByTestId('entry-nav-rail-toggle');
    const content = document.getElementById(toggle.getAttribute('aria-controls')!)!;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.closest('nav')?.hasAttribute('inert')).toBe(false);
    expect(toggle.closest('[aria-hidden="true"]')).toBeNull();
    expect(content.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(content.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });
});
