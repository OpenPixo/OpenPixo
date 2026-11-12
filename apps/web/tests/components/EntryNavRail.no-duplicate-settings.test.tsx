// @vitest-environment jsdom
//
// Rail structure invariant: a primary 新建游戏 action and search lead, the
// destination group holds only places (首页 / 我的游戏 / 工坊), and the single
// settings entry is an action on the account row at the rail foot.
//
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';

vi.mock('../../src/components/quest/QuestPanel', () => ({ QuestPanel: () => null }));

function renderRail({ onOpenSettings = vi.fn(), onNewProject = vi.fn(), newProjectDisabled = false } = {}) {
  render(
    <I18nProvider initial="en">
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={onNewProject}
        newProjectDisabled={newProjectDisabled}
        open
        onOpenSettings={onOpenSettings}
      />
    </I18nProvider>,
  );
  return { onOpenSettings, onNewProject };
}

afterEach(() => {
  cleanup();
});

describe('EntryNavRail structure', () => {
  it('leads with a 新建游戏 action wired to onNewProject', () => {
    const { onNewProject } = renderRail();
    const newGame = screen.getByTestId('entry-nav-new-game');
    expect(newGame.textContent).toContain('New game');
    fireEvent.click(newGame);
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it('disables 新建游戏 when creation is unavailable', () => {
    renderRail({ newProjectDisabled: true });
    expect(screen.getByTestId('entry-nav-new-game').hasAttribute('disabled')).toBe(true);
  });

  it('lists only destinations, in the order 首页 / 我的游戏 / 工坊', () => {
    renderRail();
    const group = screen.getByTestId('entry-nav-destinations');
    expect(Array.from(group.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid')))
      .toEqual(['entry-nav-home', 'entry-nav-drafts', 'entry-nav-store']);
    expect(within(group).queryByTestId('entry-settings-button')).toBeNull();
    expect(within(group).queryByRole('button', { name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('renders exactly one settings entry, on the account row', () => {
    const { onOpenSettings } = renderRail();
    const settings = screen.getAllByTestId('entry-settings-button');
    expect(settings).toHaveLength(1);
    const dock = screen.getByTestId('entry-nav-local-account-dock');
    expect(dock.contains(settings[0]!)).toBe(true);
    // Beside the identity trigger, not stacked on a row of its own.
    expect(settings[0]!.closest('div')?.contains(screen.getByTestId('entry-nav-local-account'))).toBe(true);
    fireEvent.click(settings[0]!);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
