// @vitest-environment jsdom
//
// The rail foot's help menu: keyboard shortcuts plus the support and changelog
// pages on the OpenPixo site (these used to be a separate icon row above the
// identity).

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail } from '../../src/components/EntryNavRail';
import { KeyboardShortcutsHelp } from '../../src/components/KeyboardShortcutsHelp';
import { resetProjectRunStatusStore } from '../../src/hooks/useProjectRunStatuses';
import { I18nProvider, type Locale } from '../../src/i18n';

vi.mock('../../src/components/quest/QuestPanel', () => ({ QuestPanel: () => null }));

function renderRail(locale: Locale = 'en') {
  return render(
    <I18nProvider initial={locale}>
      <EntryNavRail view="home" onViewChange={() => {}} onNewProject={() => {}} open />
      <KeyboardShortcutsHelp />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  resetProjectRunStatusStore();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ runs: [], awaitingInputProjectIds: [] })));
});

afterEach(() => {
  cleanup();
  resetProjectRunStatusStore();
  vi.unstubAllGlobals();
});

function openHelp() {
  const trigger = screen.getByTestId('entry-nav-help');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  return screen.getByRole('menu', { name: 'Help' });
}

describe('EntryNavRail help menu', () => {
  it('rides the account row and keeps its items out of reach until opened', () => {
    renderRail();
    const dock = screen.getByTestId('entry-nav-local-account-dock');
    expect(dock.contains(screen.getByTestId('entry-nav-help'))).toBe(true);
    // No separate social icon row any more.
    expect(screen.queryByTestId('entry-nav-rail-social')).toBeNull();
    expect(screen.queryByRole('menu', { name: 'Help' })).toBeNull();
  });

  it('opens keyboard shortcut help', () => {
    renderRail();
    const menu = openHelp();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByTestId('entry-nav-help').getAttribute('aria-expanded')).toBe('false');
  });

  it('links to the support and changelog pages, with nothing left pending', () => {
    renderRail();
    const menu = openHelp();
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual([
      'entry-nav-shortcuts',
      'entry-nav-rail-feedback',
      'entry-nav-rail-releases',
    ]);
    const support = within(menu).getByTestId('entry-nav-rail-feedback');
    expect(support.getAttribute('href')).toBe('https://openpixo.com/support');
    expect(support.textContent).toContain('Get support');
    const changelog = within(menu).getByTestId('entry-nav-rail-releases');
    expect(changelog.getAttribute('href')).toBe('https://openpixo.com/changelog');
    expect(changelog.textContent).toContain('Changelog');
    for (const link of [support, changelog]) {
      expect(link.getAttribute('aria-disabled')).toBeNull();
      expect(link.textContent).not.toContain('To be added');
    }
  });

  it('opens the Chinese pages in Chinese', () => {
    renderRail('zh-CN');
    fireEvent.click(screen.getByTestId('entry-nav-help'));
    const menu = screen.getByRole('menu', { name: '帮助' });
    const support = within(menu).getByTestId('entry-nav-rail-feedback');
    expect(support.getAttribute('href')).toBe('https://openpixo.com/support.zh');
    expect(support.textContent).toContain('获取支持');
    const changelog = within(menu).getByTestId('entry-nav-rail-releases');
    expect(changelog.getAttribute('href')).toBe('https://openpixo.com/changelog.zh');
    expect(changelog.textContent).toContain('更新日志');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderRail('zh-CN');
    const trigger = screen.getByTestId('entry-nav-help');
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: '帮助' });
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });
});
