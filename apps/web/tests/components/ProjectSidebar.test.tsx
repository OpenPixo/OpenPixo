// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RAIL_WIDTH_DEFAULT } from '../../src/components/entry-nav-rail/rail-width';
import { ProjectSidebar } from '../../src/components/ProjectSidebar';
import { ENTRY_RAIL_TOGGLE_EVENT, RAIL_OPEN_STORAGE_KEY, takeEntryNewGameRequest } from '../../src/components/entryRailBridge';
import { navigate } from '../../src/router';

// The rail itself is covered by the EntryNavRail suites; here it only has to
// report what the sidebar hands it.
vi.mock('../../src/components/EntryNavRail', () => ({
  EntryNavRail: (props: {
    view: string | null; open: boolean; onToggleRail: () => void; onNewProject: () => void;
    onOpenSearch: () => void; recentProjects: unknown[]; activeProjectId?: string | null;
    activeConversationId?: string | null;
  }) => (
    <nav aria-label="Rail" data-view={String(props.view)} data-open={String(props.open)}>
      <button type="button" onClick={props.onToggleRail}>{props.open ? 'Collapse sidebar' : 'Expand sidebar'}</button>
      <button type="button" onClick={props.onNewProject}>New game</button>
      <button type="button" onClick={props.onOpenSearch}>Search</button>
      {props.open ? <div>{`Recent ${props.recentProjects.length} · ${props.activeProjectId}/${props.activeConversationId}`}</div> : null}
    </nav>
  ),
}));
vi.mock('../../src/components/ProjectSearchModal', () => ({
  ProjectSearchModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Search projects"><button type="button" onClick={onClose}>Close search</button></div>
  ),
}));
vi.mock('../../src/router', () => ({ navigate: vi.fn() }));
vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => ({ 'entry.navProjects': 'Projects' }[key] ?? key) }));

const project = { id: 'game', name: 'Game', updatedAt: 1 } as never;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(RAIL_OPEN_STORAGE_KEY, 'true');
  vi.mocked(navigate).mockClear();
  takeEntryNewGameRequest();
});
afterEach(cleanup);

function view(ready = true) {
  return <ProjectSidebar conversationsReady={ready} projects={[project]} activeProjectId="game" activeConversationId="session" activeFileName={null}
    onOpenProject={vi.fn()} onOpenSettings={vi.fn()} onRenameProject={vi.fn()}
    onDeleteProject={vi.fn()} onDuplicateProject={vi.fn()}>
    <input aria-label="Draft" defaultValue="unsent prompt" />
  </ProjectSidebar>;
}

const rail = () => screen.getByRole('navigation', { name: 'Rail' });

describe('project sidebar renders the Home rail', () => {
  it('sizes its rail track from the shared rail width', () => {
    const { container } = render(view());
    const host = container.querySelector<HTMLElement>('[data-rail-host]');
    expect(host?.style.getPropertyValue('--shell-sidebar-width')).toBe(`${RAIL_WIDTH_DEFAULT}px`);
  });

  it('shows the same rail as Home with no destination current and the open session marked', () => {
    render(view());
    expect(screen.getByRole('complementary', { name: 'Projects' })).toBeTruthy();
    expect(rail().dataset.view).toBe('null');
    expect(screen.getByText('Recent 1 · game/session')).toBeTruthy();
  });

  it('opens by default without writing that default back as a choice', () => {
    localStorage.clear();
    render(view());
    expect(rail().dataset.open).toBe('true');
    expect(localStorage.getItem(RAIL_OPEN_STORAGE_KEY)).toBeNull();
  });

  it('keeps the rail compact and the list empty until the project exists, without remounting the workbench', () => {
    const mounted = render(view(false));
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    expect(rail().dataset.open).toBe('false');
    mounted.rerender(view(true));
    expect(screen.getByText('Recent 1 · game/session')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  });

  it('collapses and reopens without remounting the workbench or losing its draft', () => {
    render(view());
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(rail().dataset.open).toBe('false');
    expect(localStorage.getItem(RAIL_OPEN_STORAGE_KEY)).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe('unsent prompt');
  });

  it('shares the toggle bridge and shortcuts with Home and ignores text editing', () => {
    render(view());
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Draft' }), { key: 'b', ctrlKey: true });
    expect(rail().dataset.open).toBe('true');
    act(() => window.dispatchEvent(new CustomEvent(ENTRY_RAIL_TOGGLE_EVENT)));
    expect(rail().dataset.open).toBe('false');
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    expect(rail().dataset.open).toBe('true');
  });

  it('opens project search from the rail and from Ctrl+K', () => {
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('dialog', { name: 'Search projects' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('dialog', { name: 'Search projects' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Search projects' })).toBeTruthy();
  });

  it('sends New game to Home with a held request for its game dialog', () => {
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(navigate).toHaveBeenCalledWith({ kind: 'home', view: 'home' });
    expect(takeEntryNewGameRequest()).toBe(true);
    expect(takeEntryNewGameRequest()).toBe(false);
  });
});
