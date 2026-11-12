
// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  openWorkspaceTab,
  removeWorkspaceProjectTabs,
  WorkspaceTabsBar,
} from '../../src/components/WorkspaceTabsBar';
import { navigate, type Route } from '../../src/router';
import type { Project } from '../../src/types';
import { setWorkspaceTabsDock } from '../../src/components/workspaceTabsDock';

afterEach(() => {
  setWorkspaceTabsDock(null);
});

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string) => key,
  }),
  useT: () => (key: string) => {
    const labels: Record<string, string> = {
      'app.brand': 'OpenPixo',
      'common.close': 'Close',
      'common.untitled': 'Untitled',
      'entry.navHome': 'Home',
      'entry.navProjects': 'Projects',
      'entry.navTasks': 'Automations',
      'store.title': 'Store',
      'entry.navIntegrations': 'Integrations',
      'settings.welcomeTitle': 'Welcome',
    };
    return labels[key] ?? key;
  },
}));

vi.mock('../../src/router', async () => {
  const actual = await vi.importActual<typeof import('../../src/router')>(
    '../../src/router',
  );
  return {
    ...actual,
    navigate: vi.fn(),
  };
});

const homeRoute: Route = { kind: 'home', view: 'home' };
const projectRoute: Route = {
  kind: 'project',
  projectId: 'project-alpha',
  conversationId: null,
  fileName: null,
};

const project: Project = {
  id: 'project-alpha',
  name: 'Project Alpha',
  skillId: null,
  createdAt: 1,
  updatedAt: 1,
};

const projectBeta: Project = {
  id: 'project-beta',
  name: 'Project Beta',
  skillId: null,
  createdAt: 2,
  updatedAt: 2,
};



function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: 'move',
    effectAllowed: 'move',
    getData: vi.fn((key: string) => store.get(key) ?? ''),
    setData: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  } as unknown as DataTransfer;
}

// The active entry tab renders icon-only (sidebar toggle on the home view,
// Home nav pill on any other section), so its current section is no longer
// observable through textContent. Read it from the persisted tab state.
function storedEntryTabView(): string | null {
  const raw = window.localStorage.getItem('pixo:workspace-tabs:v1');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      tabs?: Array<{ kind?: string; view?: string }>;
    };
    return parsed.tabs?.find((tab) => tab.kind === 'entry')?.view ?? null;
  } catch {
    return null;
  }
}

function mockTabRect(element: HTMLElement, left: number, width = 100) {
  // Drop hit-testing measures tabs in LAYOUT space (offsetLeft/offsetWidth) so
  // the FLIP reorder slide and the drag transform can't shift the rects it
  // reads. jsdom reports 0 for both, so stub them alongside the visual rect —
  // the strip itself sits at x=0 with scrollLeft 0, so the two coincide here.
  Object.defineProperty(element, 'offsetLeft', { configurable: true, value: left });
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        x: left,
        y: 0,
        left,
        right: left + width,
        top: 0,
        bottom: 32,
        width,
        height: 32,
        toJSON: () => ({}),
      }) as DOMRect,
  });
}

function dispatchDragEvent(
  element: HTMLElement,
  type: 'dragover' | 'drop',
  dataTransfer: DataTransfer,
  clientX: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { configurable: true, value: dataTransfer });
  Object.defineProperty(event, 'clientX', { configurable: true, value: clientX });
  fireEvent(element, event);
}

describe('WorkspaceTabsBar navigation semantics', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.querySelector('[data-testid="blank-workspace-area"]')?.remove();
  });

  it('keeps Home tab as a singleton and avoids duplication', async () => {
    const { rerender } = render(
      <WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />,
    );

    expect(screen.getAllByRole('tab')).toHaveLength(1);

    // Asking for a new tab when a Home tab already exists should activate the
    // existing Home tab. #5517 removed the top-right "+" button, so ⌘/Ctrl+T is
    // now the only entry point — both used to funnel through createNewTab(), so
    // the shortcut exercises the same singleton logic the "+" click did.
    fireEvent.keyDown(document, { key: 't', metaKey: true });
    fireEvent.keyDown(document, { key: 't', metaKey: true });

    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(1);
      // The active Home tab renders as the sidebar toggle (icon-only pill).
      expect(screen.getAllByTestId('workspace-home-rail-toggle')).toHaveLength(1);
    });

    // Navigate to projectRoute using rerender with a fresh object reference
    rerender(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toHaveLength(2);
      expect(labels.some((label) => label.includes('Home'))).toBe(true);
      expect(labels.some((label) => label.includes('Project Alpha'))).toBe(true);
    });

    // Return to Home by navigating back with a fresh route object reference
    rerender(<WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />);

    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      const labels = tabs.map((tab) => tab.textContent ?? '');
      // Expect that we still have 2 tabs (Home and Project Alpha). The active
      // Home tab is the icon-only sidebar toggle, so assert its testid rather
      // than a text label.
      expect(tabs).toHaveLength(2);
      expect(screen.getAllByTestId('workspace-home-rail-toggle')).toHaveLength(1);
      expect(labels.filter((label) => label.includes('Project Alpha'))).toHaveLength(1);
    });
  });

  it('closes the dock dropdown when its route-owned dock is removed', async () => {
    const firstDock = document.createElement('div');
    const secondDock = document.createElement('div');
    document.body.append(firstDock, secondDock);
    setWorkspaceTabsDock(firstDock);

    const { rerender } = render(
      <WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />,
    );

    const trigger = await screen.findByTestId('workspace-tabs-dropdown-trigger');
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();

    act(() => setWorkspaceTabsDock(null));
    rerender(
      <WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />,
    );
    expect(screen.queryByRole('listbox')).toBeNull();

    act(() => setWorkspaceTabsDock(secondDock));
    rerender(
      <WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />,
    );
    const restoredTrigger = await screen.findByTestId('workspace-tabs-dropdown-trigger');
    expect(restoredTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();

    firstDock.remove();
    secondDock.remove();
  });

  // recvq5eKj2kdF0: Home's own project fetch (recent/drafts, capped) replaces
  // the `projects` prop wholesale on every reload — App.tsx's
  // reconcileFetchedProjects does not preserve entries for projects that are
  // only open in a background tab. `displayTabFor` looked the tab's project up
  // in that same list and fell back to the untitled label the instant the
  // project dropped out, even though it plainly has a real name — switching to
  // Home and back made an already-named tab regress to "Untitled".
  it('keeps a project tab\'s real name after Home reloads a projects list that no longer includes it', async () => {
    const { rerender } = render(
      <WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />,
    );

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels.some((label) => label.includes('Project Alpha'))).toBe(true);
    });

    // Switch to Home; Home's own fetch (simulated here by an empty list) does
    // not include project-alpha at all.
    rerender(<WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[]} />);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels.some((label) => label.includes('Project Alpha'))).toBe(true);
      expect(labels.some((label) => label.includes('Untitled'))).toBe(false);
    });
  });

  it('auto-closes the Welcome tab once onboarding completes, even when a project opens', async () => {
    const { rerender } = render(
      <WorkspaceTabsBar
        route={{ kind: 'home', view: 'onboarding' }}
        projects={[project]}
        onboardingCompleted={false}
      />,
    );

    await waitFor(() => {
      // The active entry tab is icon-only (Home nav pill) on non-home views,
      // so assert the parked Welcome view through the persisted tab state.
      expect(screen.getAllByRole('tab')).toHaveLength(1);
      expect(screen.getByTestId('workspace-home-nav')).toBeTruthy();
      expect(storedEntryTabView()).toBe('onboarding');
    });

    // Completing onboarding via the design-system path navigates to a fresh
    // project while the entry tab is still parked on the Welcome view.
    rerender(
      <WorkspaceTabsBar
        route={{ ...projectRoute }}
        projects={[project]}
        onboardingCompleted={true}
      />,
    );

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels.some((label) => label.includes('Welcome'))).toBe(false);
      expect(labels.some((label) => label.includes('Home'))).toBe(true);
      expect(labels.some((label) => label.includes('Project Alpha'))).toBe(true);
    });
  });

  it('ships no tab-bar chrome buttons and no reachable Search tabs popover', async () => {
    const { rerender } = render(
      <WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />,
    );

    // #5517 removed both top-right chrome buttons. The "+" was the radial
    // template menu's only entry point and the magnifier was the Search-tabs
    // popover's only entry point, so neither overlay can be opened any more.
    // This is the regression guard for that removal: if a future change
    // re-introduces either control it must be a deliberate decision that
    // updates this test (and re-enables the popover-dismissal spec below).
    expect(screen.queryByRole('button', { name: 'New tab' })).toBeNull();
    expect(screen.queryByTestId('workspace-tabs-new-tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search tabs' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Search tabs' })).toBeNull();

    // The popover must also stay absent across a route flip into /onboarding
    // (e.g. browser back/forward, which bypasses activateTab/createNewTab).
    // Nothing may float over the first-run flow with no control to dismiss it.
    rerender(
      <WorkspaceTabsBar route={{ kind: 'home', view: 'onboarding' }} projects={[project]} />,
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Search tabs' })).toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Search tabs' })).toBeNull();
  });

  it('shows no rail toggle or search during first run, where EntryShell mounts no rail to drive', () => {
    render(<WorkspaceTabsBar route={{ kind: 'home', view: 'onboarding' }} projects={[project]} />);

    expect(screen.queryByTestId('entry-nav-search')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  });

  it('puts the rail toggle first in the entry chrome cluster and mirrors the rail state on it', async () => {
    // OPEND-2685: the sidebar switch is the FIRST control after the window's
    // traffic-light space — where a macOS sidebar toggle is expected — and the
    // search follows it. It stays mounted in both rail states, so the
    // collapsed rail's expand entry is the same target as the collapse one;
    // only its label, aria-expanded and glyph flip.
    render(<WorkspaceTabsBar route={homeRoute} projects={[project]} />);

    const cluster = document.querySelector('.workspace-tabs-rail-actions');
    expect(cluster).not.toBeNull();
    const order = Array.from(cluster!.querySelectorAll('[data-testid]')).map(
      (el) => (el as HTMLElement).dataset.testid,
    );
    expect(order).toEqual(['entry-rail-collapse', 'entry-nav-search']);

    const toggle = screen.getByTestId('entry-rail-collapse');
    // Fresh storage: the rail is open by default, so the toggle reads as
    // "collapse".
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('entry.navCollapse');
    const currentGlyph = () =>
      toggle.querySelectorAll('.entry-nav-rail__collapse-glyph.is-current').length;
    expect(toggle.querySelectorAll('.entry-nav-rail__collapse-glyph')).toHaveLength(2);
    expect(currentGlyph()).toBe(1);

    // Clicking asks EntryShell (a sibling tree) to flip the rail via the
    // bridge event; the button itself owns no state.
    const toggled = vi.fn();
    window.addEventListener('pixo:entry-rail-toggle', toggled);
    fireEvent.click(toggle);
    expect(toggled).toHaveBeenCalledTimes(1);
    window.removeEventListener('pixo:entry-rail-toggle', toggled);

    // EntryShell answers with the state event; the toggle mirrors it in place
    // (same element, same slot) and flips to the expand affordance.
    act(() => {
      window.dispatchEvent(new CustomEvent('pixo:entry-rail-state', { detail: { open: false } }));
    });
    expect(screen.getByTestId('entry-rail-collapse')).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('entry.navExpand');
    expect(currentGlyph()).toBe(1);
    expect(
      Array.from(cluster!.querySelectorAll('[data-testid]')).map(
        (el) => (el as HTMLElement).dataset.testid,
      ),
    ).toEqual(['entry-rail-collapse', 'entry-nav-search']);
  });

  it('shows no rail toggle in the docked (project) chrome — there is no entry rail to switch', async () => {
    const dock = document.createElement('div');
    document.body.appendChild(dock);
    setWorkspaceTabsDock(dock);
    try {
      render(<WorkspaceTabsBar route={projectRoute} projects={[project]} />);
      expect(screen.queryByTestId('entry-rail-collapse')).toBeNull();
      expect(screen.queryByTestId('entry-nav-search')).toBeNull();
      // The docked chrome keeps the brand-logo Home button in that first slot.
      expect(screen.getByTestId('workspace-home-chrome')).toBeTruthy();
    } finally {
      dock.remove();
    }
  });

  it('collapses a restored two-entry-tab workspace into a single entry tab', async () => {
    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'entry:projects:1',
        tabs: [
          { id: 'entry:home:1', kind: 'entry', view: 'home', createdAt: 1, lastActiveAt: 1 },
          { id: 'entry:projects:1', kind: 'entry', view: 'projects', createdAt: 2, lastActiveAt: 2 },
        ],
      }),
    );
    render(<WorkspaceTabsBar route={{ kind: 'home', view: 'projects' }} projects={[project]} />);
    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(1);
      expect(screen.getByTestId('workspace-home-nav')).toBeTruthy();
      expect(storedEntryTabView()).toBe('projects');
    });
  });

  it.each([
    ['plugins', 'store'],
    ['community', 'home'],
  ] as const)('restores the retired %s entry view as %s', (savedView, currentView) => {
    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'project:project-alpha',
        tabs: [
          { id: `entry:${savedView}:1`, kind: 'entry', view: savedView, createdAt: 1, lastActiveAt: 1 },
          { id: 'project:project-alpha', kind: 'project', projectId: project.id, createdAt: 2, lastActiveAt: 2 },
        ],
      }),
    );

    render(<WorkspaceTabsBar route={projectRoute} projects={[project]} />);

    expect(storedEntryTabView()).toBe(currentView);
    const entryTab = screen.getAllByRole('tab')[0]!;
    expect(entryTab.getAttribute('data-workspace-tab-id')).toBe(`entry:${savedView}:1`);
    expect(within(entryTab).getByRole('button', {
      name: currentView === 'store' ? 'Store' : 'Home',
    })).toBeTruthy();
  });

  it.each([
    ['plugins', 'store'],
    ['community', 'home'],
  ] as const)('canonicalizes a retired %s route to the %s tab view', (savedView, currentView) => {
    render(<WorkspaceTabsBar route={{ kind: 'home', view: savedView }} projects={[project]} />);

    expect(storedEntryTabView()).toBe(currentView);
  });

  it('can append and focus a project tab for create-project flows', async () => {
    render(<WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />);

    openWorkspaceTab({ ...projectRoute });

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toHaveLength(2);
      expect(labels.some((label) => label.includes('Home'))).toBe(true);
      expect(labels.some((label) => label.includes('Project Alpha'))).toBe(true);
    });
  });

  it('removes a failed provisional project from live and persisted tab state', async () => {
    render(<WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />);

    openWorkspaceTab({ ...projectRoute });
    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

    removeWorkspaceProjectTabs(project.id);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toHaveLength(1);
      expect(labels.some((label) => label.includes('Project Alpha'))).toBe(false);
      const stored = JSON.parse(
        window.localStorage.getItem('pixo:workspace-tabs:v1') ?? '{}',
      ) as { tabs?: Array<{ projectId?: string }> };
      expect(stored.tabs?.some((tab) => tab.projectId === project.id)).toBe(false);
    });
  });

  it('reuses the existing project tab instead of duplicating on repeated open', async () => {
    render(<WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />);

    openWorkspaceTab({ ...projectRoute });
    openWorkspaceTab({ ...projectRoute });
    openWorkspaceTab({ ...projectRoute });

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toHaveLength(2);
      expect(labels.filter((label) => label.includes('Project Alpha'))).toHaveLength(1);
    });
  });

  it('updates the existing project tab fields instead of appending when reopened with new context', async () => {
    render(<WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />);

    openWorkspaceTab({ ...projectRoute });
    openWorkspaceTab({
      kind: 'project',
      projectId: 'project-alpha',
      conversationId: 'conv-1',
      fileName: 'deck.html',
    });

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toHaveLength(2);
      expect(labels.filter((label) => label.includes('Project Alpha'))).toHaveLength(1);
    });
  });

  it('keeps a singleton Home tab when restoring a Home-less workspace and navigating back to Home', async () => {
    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'project:project-alpha',
        tabs: [
          {
            id: 'project:project-alpha',
            kind: 'project',
            projectId: 'project-alpha',
            createdAt: 1,
            lastActiveAt: 1,
          },
        ],
      }),
    );

    const { rerender } = render(
      <WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />,
    );

    // Restoring a Home-less saved workspace immediately mints the permanent
    // Home tab pinned leftmost — Project Alpha sits to its right.
    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toEqual([
        expect.stringContaining('Home'),
        expect.stringContaining('Project Alpha'),
      ]);
    });

    // Navigating to Home must not duplicate it.
    rerender(<WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toHaveLength(2);
      // The active Home tab renders as the icon-only sidebar toggle.
      expect(screen.getAllByTestId('workspace-home-rail-toggle')).toHaveLength(1);
      expect(labels.filter((label) => label.includes('Project Alpha'))).toHaveLength(1);
    });
  });

  it('creates a pinned Home tab when restoring saved tabs that have no Home entry', async () => {
    // Users who closed/replaced Home before the permanent-Home feature shipped
    // can have a saved `[project, ...]` workspace with no Home entry. Normalizing
    // that state must mint a Home tab and pin it leftmost, not leave the workspace
    // Home-less until the user manually navigates home.
    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'project:project-alpha',
        tabs: [
          {
            id: 'project:project-alpha',
            kind: 'project',
            projectId: 'project-alpha',
            conversationId: null,
            fileName: null,
            createdAt: 1,
            lastActiveAt: 1,
          },
          {
            id: 'project:project-beta',
            kind: 'project',
            projectId: 'project-beta',
            conversationId: null,
            fileName: null,
            createdAt: 2,
            lastActiveAt: 2,
          },
        ],
      }),
    );

    render(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project, projectBeta]} />);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toEqual([
        expect.stringContaining('Home'),
        expect.stringContaining('Project Alpha'),
        expect.stringContaining('Project Beta'),
      ]);
    });
  });

  it('coalesces duplicate project tabs restored from saved workspace state', async () => {
    // Regression for #2641: a workspace persisted before the dedupe fix can
    // hold several tabs for the same projectId (distinct tab ids). On restore,
    // normalization must collapse them to one and keep the canonical (newest
    // here) tab, preserving the project's conversation/file context.
    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'project:project-alpha-dup',
        tabs: [
          {
            id: 'project:project-alpha',
            kind: 'project',
            projectId: 'project-alpha',
            conversationId: null,
            fileName: null,
            createdAt: 1,
            lastActiveAt: 1,
          },
          {
            id: 'project:project-alpha-dup',
            kind: 'project',
            projectId: 'project-alpha',
            conversationId: 'conv-1',
            fileName: 'deck.html',
            createdAt: 2,
            lastActiveAt: 5,
          },
        ],
      }),
    );

    render(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      // Home + exactly one Project Alpha tab.
      expect(labels).toHaveLength(2);
      expect(labels.filter((label) => label.includes('Project Alpha'))).toHaveLength(1);
    });
  });

  it('deduplicates and cleans up restored Home tabs from old sessions', async () => {
    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'entry:home:old-two',
        tabs: [
          {
            id: 'entry:home:old-one',
            kind: 'entry',
            view: 'home',
            createdAt: 1,
            lastActiveAt: 1,
          },
          {
            id: 'entry:home:old-two',
            kind: 'entry',
            view: 'home',
            createdAt: 2,
            lastActiveAt: 2,
          },
        ],
      }),
    );

    render(<WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />);

    await waitFor(() => {
      // Expect that the duplicate Home tabs are deduplicated to exactly one
      // Home tab — rendered as the sidebar toggle since it is active on home.
      expect(screen.getAllByRole('tab')).toHaveLength(1);
      expect(screen.getAllByTestId('workspace-home-rail-toggle')).toHaveLength(1);
    });
  });

  it('keeps the pinned Home tab permanent and non-closable', async () => {
    render(<WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />);

    // The Home tab is pinned leftmost and has no close affordance, so there is
    // no way to remove the last remaining tab.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();

    expect(screen.getAllByRole('tab')).toHaveLength(1);
    // Active on the home view, the pinned tab renders as the sidebar toggle.
    expect(screen.getByTestId('workspace-home-rail-toggle')).toBeTruthy();
  });

  it('maps the browser new-tab shortcut to the workspace new-tab action', async () => {
    render(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />);

    const allowedDefault = fireEvent.keyDown(document, {
      key: 't',
      metaKey: true,
    });

    expect(allowedDefault).toBe(false);
    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toHaveLength(2);
      // The shortcut activates the Home tab, which then renders as the
      // icon-only sidebar toggle.
      expect(screen.getAllByTestId('workspace-home-rail-toggle')).toHaveLength(1);
      expect(labels.some((label) => label.includes('Project Alpha'))).toBe(true);
    });
    expect(navigate).toHaveBeenCalledWith(homeRoute);
  });

  it('answers browser tab shortcuts while the project side panel is mounted', async () => {
    // The panel has no file tabs any more (specs/current/openpixo-game-panel.md
    // §7), so it no longer claims Ctrl/Cmd+T: the workspace tabs act on it.
    render(
      <>
        <div data-testid="file-workspace" />
        <WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />
      </>,
    );

    const allowedDefault = fireEvent.keyDown(document, {
      key: 't',
      metaKey: true,
    });

    expect(allowedDefault).toBe(false);
    await waitFor(() => {
      expect(screen.getAllByTestId('workspace-home-rail-toggle')).toHaveLength(1);
    });
    expect(navigate).toHaveBeenCalledWith(homeRoute);
  });

  it('maps the browser close-tab shortcut to the active workspace tab', async () => {
    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'project:project-alpha',
        tabs: [
          {
            id: 'entry:home:seed',
            kind: 'entry',
            view: 'home',
            createdAt: 1,
            lastActiveAt: 1,
          },
          {
            id: 'project:project-alpha',
            kind: 'project',
            projectId: 'project-alpha',
            conversationId: null,
            fileName: null,
            createdAt: 2,
            lastActiveAt: 2,
          },
        ],
      }),
    );

    render(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />);

    const allowedDefault = fireEvent.keyDown(document, {
      key: 'w',
      ctrlKey: true,
    });

    expect(allowedDefault).toBe(false);
    await waitFor(() => {
      // Closing the project tab falls back to the Home tab, which is active on
      // the home view and therefore renders as the icon-only sidebar toggle.
      expect(screen.getAllByRole('tab')).toHaveLength(1);
      expect(screen.getByTestId('workspace-home-rail-toggle')).toBeTruthy();
    });
    expect(navigate).toHaveBeenCalledWith(homeRoute);
  });

  it('switches tabs with browser-style next and previous tab shortcuts', async () => {
    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'project:project-alpha',
        tabs: [
          {
            id: 'entry:home:seed',
            kind: 'entry',
            view: 'home',
            createdAt: 1,
            lastActiveAt: 1,
          },
          {
            id: 'project:project-alpha',
            kind: 'project',
            projectId: 'project-alpha',
            conversationId: null,
            fileName: null,
            createdAt: 2,
            lastActiveAt: 2,
          },
          {
            id: 'project:project-beta',
            kind: 'project',
            projectId: 'project-beta',
            conversationId: null,
            fileName: null,
            createdAt: 3,
            lastActiveAt: 3,
          },
        ],
      }),
    );

    render(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project, projectBeta]} />);

    const nextAllowedDefault = fireEvent.keyDown(document, {
      key: 'Tab',
      ctrlKey: true,
    });

    expect(nextAllowedDefault).toBe(false);
    await waitFor(() => {
      expect(navigate).toHaveBeenLastCalledWith({
        kind: 'project',
        projectId: 'project-beta',
        conversationId: null,
        fileName: null,
      });
    });

    const previousAllowedDefault = fireEvent.keyDown(document, {
      key: 'Tab',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(previousAllowedDefault).toBe(false);
    await waitFor(() => {
      expect(navigate).toHaveBeenLastCalledWith(projectRoute);
    });
  });

  it('keeps the Home tab pinned leftmost when a tab is dropped onto its left edge', async () => {
    const vibrate = vi.fn();
    Object.defineProperty(window.navigator, 'vibrate', {
      configurable: true,
      value: vibrate,
    });

    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'project:project-alpha',
        tabs: [
          {
            id: 'entry:home:seed',
            kind: 'entry',
            view: 'home',
            createdAt: 1,
            lastActiveAt: 1,
          },
          {
            id: 'project:project-alpha',
            kind: 'project',
            projectId: 'project-alpha',
            conversationId: null,
            fileName: null,
            createdAt: 2,
            lastActiveAt: 2,
          },
          {
            id: 'project:project-beta',
            kind: 'project',
            projectId: 'project-beta',
            conversationId: null,
            fileName: null,
            createdAt: 3,
            lastActiveAt: 3,
          },
        ],
      }),
    );

    render(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project, projectBeta]} />);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toEqual([
        expect.stringContaining('Home'),
        expect.stringContaining('Project Alpha'),
        expect.stringContaining('Project Beta'),
      ]);
    });

    // Dragging a project tab onto Home's left edge must not place anything
    // before Home. Home is the permanent, pinned-leftmost tab; the drop should
    // resolve to "after Home" so Home stays first.
    const [homeTab, , betaTab] = screen.getAllByRole('tab');
    mockTabRect(homeTab! as HTMLElement, 0);
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(betaTab!, { dataTransfer });
    // clientX 10 lands in the left half of Home's rect (left=0, width=100).
    dispatchDragEvent(homeTab! as HTMLElement, 'dragover', dataTransfer, 10);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toEqual([
        expect.stringContaining('Home'),
        expect.stringContaining('Project Beta'),
        expect.stringContaining('Project Alpha'),
      ]);
    });

    dispatchDragEvent(homeTab! as HTMLElement, 'drop', dataTransfer, 10);
    fireEvent.dragEnd(betaTab!, { dataTransfer });

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toEqual([
        expect.stringContaining('Home'),
        expect.stringContaining('Project Beta'),
        expect.stringContaining('Project Alpha'),
      ]);
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith(8);
    expect(vibrate).toHaveBeenCalledWith(12);
    const stored = JSON.parse(window.localStorage.getItem('pixo:workspace-tabs:v1') ?? '{}') as {
      activeTabId?: string;
      tabs?: Array<{ id?: string }>;
    };
    expect(stored.activeTabId).toBe('project:project-alpha');
    expect(stored.tabs?.map((tab) => tab.id)).toEqual([
      'entry:home:seed',
      'project:project-beta',
      'project:project-alpha',
    ]);
  });

  it('reorders tabs live from right to left while dragging', async () => {
    window.localStorage.setItem(
      'pixo:workspace-tabs:v1',
      JSON.stringify({
        activeTabId: 'project:project-alpha',
        tabs: [
          {
            id: 'entry:home:seed',
            kind: 'entry',
            view: 'home',
            createdAt: 1,
            lastActiveAt: 1,
          },
          {
            id: 'project:project-alpha',
            kind: 'project',
            projectId: 'project-alpha',
            conversationId: null,
            fileName: null,
            createdAt: 2,
            lastActiveAt: 2,
          },
          {
            id: 'project:project-beta',
            kind: 'project',
            projectId: 'project-beta',
            conversationId: null,
            fileName: null,
            createdAt: 3,
            lastActiveAt: 3,
          },
        ],
      }),
    );

    render(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project, projectBeta]} />);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toEqual([
        expect.stringContaining('Home'),
        expect.stringContaining('Project Alpha'),
        expect.stringContaining('Project Beta'),
      ]);
    });

    const [, alphaTab, betaTab] = screen.getAllByRole('tab');
    mockTabRect(alphaTab! as HTMLElement, 100);
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(betaTab!, { dataTransfer });
    dispatchDragEvent(alphaTab! as HTMLElement, 'dragover', dataTransfer, 110);

    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
      expect(labels).toEqual([
        expect.stringContaining('Home'),
        expect.stringContaining('Project Beta'),
        expect.stringContaining('Project Alpha'),
      ]);
    });
  });
});

describe('WorkspaceTabsBar identity-scope tab reset', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('never resets while identityScopeKey stays unresolved (default prop, back-compat)', async () => {
    const { rerender } = render(
      <WorkspaceTabsBar route={{ kind: 'home', view: 'home' }} projects={[project]} />,
    );
    rerender(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />);
    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    });
    // No identityScopeKey passed at all across any render — tabs must behave
    // exactly as they did before this feature existed.
    rerender(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[projectBeta]} />);
    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    });
  });
});

// OPEND-2795: the dock dropdown's lead glyph and the rail's 最近项目 rows read
// ONE run-status feed, with one display mapping — including the rule that
// opening a project spends its ✓. Before this, the switcher still drew a ✓ the
// rail had already cleared for the same project.
describe('WorkspaceTabsBar dock dropdown run status', () => {
  const originalFetch = globalThis.fetch;
  const dock = document.createElement('div');

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    document.body.append(dock);
    setWorkspaceTabsDock(dock);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/runs?projectId=project-alpha') {
        return new Response(JSON.stringify({
          runs: [{
            id: 'run-alpha-1',
            projectId: 'project-alpha',
            conversationId: null,
            assistantMessageId: null,
            agentId: 'claude',
            status: 'succeeded',
            createdAt: 1,
            updatedAt: 2,
          }],
          awaitingInputProjectIds: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    setWorkspaceTabsDock(null);
    dock.remove();
  });

  it('marks a finished project with the unread dot and spends it when the row opens it', async () => {
    // OPEND-3133: the notice is the dot at the row's end, announced as the
    // finished status; the lead slot keeps the folder.
    render(<WorkspaceTabsBar route={{ ...projectRoute }} projects={[project]} />);
    fireEvent.click(await screen.findByTestId('workspace-tabs-dropdown-trigger'));
    const listbox = screen.getByRole('listbox');
    await waitFor(() => {
      expect(within(listbox).getByRole('img', { name: 'designs.status.succeeded' })).toBeTruthy();
    });
    expect(within(listbox).getByRole('img', { name: 'designs.status.succeeded' }).getAttribute('data-testid'))
      .toBe('workspace-tabs-dropdown-unread');
    expect(within(listbox).getByTestId('project-folder-glyph')).toBeTruthy();

    fireEvent.click(within(listbox).getByRole('option', { name: /Project Alpha/ }));
    // Same acknowledgement record the rail keeps, keyed on THIS finished run.
    expect(JSON.parse(window.localStorage.getItem('pixo.entry.railRecentSeenDone') ?? '{}')).toEqual({
      'project-alpha': 'run-alpha-1',
    });

    fireEvent.click(screen.getByTestId('workspace-tabs-dropdown-trigger'));
    const reopened = screen.getByRole('listbox');
    await waitFor(() => {
      expect(within(reopened).queryByRole('img', { name: 'designs.status.succeeded' })).toBeNull();
    });
  });
});

// The ⋮ menu on each row of the docked project switcher (OPEND-2686 / 3128):
// 重命名 / 复制项目 / 转入团队空间 / 删除 — the same four actions, through the
// same shared flows, as the rail's 最近项目 rows. 转入团队空间 is a REAL move
// into the team space (MoveToTeamConfirmDialog + POST …/move), shown under the
// rail row menu's conditions: a team workspace with `canShareProjects` only.
describe('WorkspaceTabsBar dock dropdown project actions', () => {
  const originalFetch = globalThis.fetch;
  const dock = document.createElement('div');

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    document.body.append(dock);
    setWorkspaceTabsDock(dock);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'POST' && /\/projects\/[^/]+\/move$/.test(url)) {
        return new Response(JSON.stringify({
          project: {
            id: project.id,
            name: project.name,
            
            visibility: 'team',
            resourceState: 'active',
            createdByWorkspaceMemberId: 'wm-1',
            currentUserAccess: {
              canOpen: true,
              canRename: true,
              canDelete: true,
              canDuplicate: true,
              canMoveToTeam: false,
              canMoveToPersonal: true,
              canExport: true,
              canSendTo: true,
              canRestoreVersion: true,
            },
            createdAt: 1,
            updatedAt: 2,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/api/runs?')) {
        return new Response(JSON.stringify({ runs: [], awaitingInputProjectIds: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    setWorkspaceTabsDock(null);
    dock.remove();
  });

  async function openRowMenu() {
    fireEvent.click(await screen.findByTestId('workspace-tabs-dropdown-trigger'));
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByRole('button', { name: 'designs.menuMore' }));
    return screen.getByRole('menu');
  }

  // OPEND-3283: the row menu closed the moment ANYTHING on the page scrolled —
  // the listener was a capturing document `scroll`, and a running turn's
  // transcript auto-scrolls every few hundred milliseconds — so on a project
  // whose agent was mid-stream the menu could not be used at all. Only a
  // scroll that actually moves the trigger (its own scroll ancestors, or the
  // document) may dismiss it.
  it('stays open while an unrelated scroll container scrolls, closes when its own ancestor does', async () => {
    const transcript = document.createElement('div');
    transcript.className = 'chat-log';
    document.body.append(transcript);
    try {
      render(
        <WorkspaceTabsBar
          route={projectRoute}
          projects={[project]}
          
          onRenameProject={vi.fn()}
          onDuplicateProject={vi.fn()}
          onDeleteProject={vi.fn()}
        />,
      );
      await openRowMenu();
      // The transcript scrolling under a streaming run is not the menu's business.
      fireEvent.scroll(transcript);
      expect(screen.queryByRole('menu')).not.toBeNull();
      // A scroll that moves the trigger itself (here: the document) still closes it.
      fireEvent.scroll(document);
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      transcript.remove();
    }
  });

  

  

  it('deletes only through the shared confirmation dialog', async () => {
    const remove = vi.fn().mockResolvedValue(true);
    render(
      <WorkspaceTabsBar
        route={projectRoute}
        projects={[project]}
        
        onDeleteProject={remove}
      />,
    );
    const menu = await openRowMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'designs.menuDelete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'designs.renameCancel' }));
    expect(remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    fireEvent.click(within(await openRowMenu()).getByRole('menuitem', { name: 'designs.menuDelete' }));
    const accept = within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'designs.menuDelete' });
    await waitFor(() => expect(accept).toBeEnabled());
    fireEvent.click(accept);
    await waitFor(() => expect(remove).toHaveBeenCalledWith(project.id));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('duplicates through the shared duplicate flow and hands the id to the shell', async () => {
    const duplicate = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceTabsBar
        route={projectRoute}
        projects={[project]}
        
        onDuplicateProject={duplicate}
      />,
    );
    const menu = await openRowMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'designs.menuDuplicate' }));
    await waitFor(() => expect(duplicate).toHaveBeenCalledWith(project.id));
  });

  

  it('renames in place and commits on Enter', async () => {
    const rename = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceTabsBar
        route={projectRoute}
        projects={[project]}
        
        onRenameProject={rename}
      />,
    );
    const menu = await openRowMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'designs.menuRename' }));
    const input = await screen.findByRole('textbox', { name: 'designs.menuRename' });
    fireEvent.change(input, { target: { value: 'Renamed project' } });
    expect(rename).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(rename).toHaveBeenCalledWith(project.id, 'Renamed project'));
  });
});
