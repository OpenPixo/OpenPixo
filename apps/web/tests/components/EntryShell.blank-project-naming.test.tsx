// @vitest-environment jsdom
//
// recvpZCr4MAqNQ: the Drafts empty-state CTA used to create a project with a
// placeholder name of its own. It now opens the same New game dialog as the
// rail's plus and Home, so it never creates an unnamed project.

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import { ENTRY_NEW_GAME_EVENT, takeEntryNewGameRequest } from '../../src/components/entryRailBridge';
import { I18nProvider } from '../../src/i18n';
import type { AgentInfo, AppConfig } from '../../src/types';





const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

type EventSourceListener = (event: unknown) => void;
class MockWorkspaceEventSource {
  static instances: MockWorkspaceEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, Set<EventSourceListener>>();

  constructor(readonly url: string) {
    MockWorkspaceEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: EventSourceListener): void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener);
  }

  removeEventListener(name: string, listener: EventSourceListener): void {
    this.listeners.get(name)?.delete(listener);
  }

  dispatch(name: string, data: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }

  close(): void {}
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// All-projects is a workspace-only view: EntryShell redirects it back to Home
// once the workspace-context read resolves with nothing (Drafts stays, as the
// local project list, since OPEND-3140). Give
// every test a resolved team context up front — the real bug reproduces
// inside a team workspace ("OD Feature Team" in the live acceptance check) —
// so the empty-state CTA renders deterministically instead of racing a
// same-tick redirect.


function installFetchMock() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const pathname = new URL(String(input), 'http://d.local').pathname;
    if (pathname.endsWith('/workspace/directory')) {
      return jsonResponse(null);
    }
    if (pathname.endsWith('/workspace/context')) {
      return jsonResponse({ context: null });
    }
    if (pathname.endsWith('/workspace/projects/team')) {
      return jsonResponse({ projects: [] });
    }
    return jsonResponse({});
  }) as typeof fetch;
}

function cliAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    bin: 'claude',
    available: true,
    version: '1.0.0',
    models: [{ id: 'sonnet', label: 'Sonnet' }],
    ...overrides,
  };
}

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: 'daemon',
    agentId: 'claude-code',
    agentModels: { 'claude-code': { model: 'sonnet' } },
    apiProtocol: 'anthropic',
    apiProtocolConfigs: {},
    apiKey: '',
    baseUrl: '',
    model: '',
    theme: 'system',
    ...overrides,
  } as AppConfig;
}

function renderAt(path: string, overrides: Partial<React.ComponentProps<typeof EntryShell>> = {}) {
  window.history.replaceState(null, '', path);
  const props: React.ComponentProps<typeof EntryShell> = {
    skills: [],

    projects: [],

    promptTemplates: [],
    config: baseConfig(),
    agents: [cliAgent()],
    daemonLive: true,
    onModeChange: vi.fn(),
    onAgentChange: vi.fn(),
    onAgentModelChange: vi.fn(),
    onApiProtocolChange: vi.fn(),
    onApiModelChange: vi.fn(),
    onConfigPersist: vi.fn(),
    onRefreshAgents: vi.fn(() => [cliAgent()]),
    onCreateProject: vi.fn(() => Promise.resolve(true)),
    onBeginProjectCreation: () => ({ projectId: 'optimistic-project', rollback: () => undefined }),

    onCreatePluginShareProject: vi.fn(),

    onOpenProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    onOpenSettings: vi.fn(),
    onCompleteOnboarding: vi.fn(),
    ...overrides,
  };

  render(
    <I18nProvider initial="en">
      <EntryShell {...props} />
    </I18nProvider>,
  );

  return props;
}

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;


  MockWorkspaceEventSource.instances = [];
  installFetchMock();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.ResizeObserver = originalResizeObserver;


  vi.unstubAllGlobals();
});

describe('EntryShell signed-out recent projects', () => {
  const localProject = {
    id: 'local-project', name: 'Local project', skillId: null, createdAt: 1, updatedAt: 1,
  };
  beforeEach(() => {
    // The rail is open by default; pin it so role queries can reach its rows
    // whatever an earlier spec toggled.
    window.localStorage.setItem('pixo.entry.railOpen.v2', 'true');
    globalThis.fetch = vi.fn(async () => jsonResponse({ context: null, projects: [], plugins: [] }));
  });
  afterEach(() => {
    window.localStorage.removeItem('pixo.entry.railOpen.v2');
  });

  // OPEND-3140: the local shell lists its projects in the rail's 最近项目
  // section, not in a Home grid, and the rail row's menu drives the same
  // rename handler the grid used to.
  it('lists local projects in the rail, not on Home, and renames from the rail row', async () => {
    const props = renderAt('/', { projects: [localProject] });
    const home = screen.getByTestId('entry-view-home');
    const row = await screen.findByTestId('entry-nav-recent-item');
    expect(row.textContent).toContain('Local project');
    expect(home.querySelector('.recent-projects')).toBeNull();
    expect(screen.queryByTestId('recent-projects-strip')).toBeNull();

    fireEvent.click(screen.getByTestId('entry-nav-recent-more'));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename' }) as HTMLInputElement;
    expect(input.value).toBe('Local project');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Renamed local project' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(props.onRenameProject).toHaveBeenCalledWith('local-project', 'Renamed local project');
  });

  it('opens the 项目 page from the rail with the local catalogue', async () => {
    renderAt('/', { projects: [localProject] });
    await screen.findByTestId('entry-nav-recent-item');
    fireEvent.click(screen.getByTestId('entry-nav-drafts'));
    expect(window.location.pathname).toBe('/drafts');
    const strip = await screen.findByTestId('recent-projects-strip');
    expect(within(strip).getByText('Local project')).toBeTruthy();
  });

  it('opens Home with its composer for an old Community URL', async () => {
    renderAt('/community', { projects: [localProject] });
    const home = await screen.findByTestId('entry-view-home');
    expect(home.getAttribute('data-active')).toBe('true');
    expect(screen.getAllByTestId('home-hero-composer-card')).toHaveLength(1);
  });
});

describe('EntryShell Drafts empty state', () => {
  it('opens the New game dialog on Home instead of creating a blank project', async () => {
    const props = renderAt('/drafts');
    const onNewGame = vi.fn();
    window.addEventListener(ENTRY_NEW_GAME_EVENT, onNewGame);

    await screen.findAllByRole('button', { name: 'New game' });
    const cta = screen
      .getAllByRole('button', { name: 'New game' })
      .find((button) => button.getAttribute('data-testid') !== 'entry-nav-new-game');
    fireEvent.click(cta!);
    window.removeEventListener(ENTRY_NEW_GAME_EVENT, onNewGame);
    takeEntryNewGameRequest();

    expect(onNewGame).toHaveBeenCalledTimes(1);
    expect(props.onCreateProject).not.toHaveBeenCalled();
    expect((await screen.findByTestId('entry-view-home')).getAttribute('data-active')).toBe('true');
  });
});
