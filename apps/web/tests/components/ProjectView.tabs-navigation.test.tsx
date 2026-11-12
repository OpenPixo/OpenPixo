// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import { navigate } from '../../src/router';
import type {
  AgentInfo,
  AppConfig,
  Conversation,
  Project,
  SkillSummary,
} from '../../src/types';
import {
  cacheTabsLocally,
  createConversation,
  listConversations,
  listMessages,
  loadTabs,
} from '../../src/state/projects';
import { fetchProjectFiles } from '../../src/providers/registry';

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string) => key,
  }),
  useT: () => (key: string) => key,
}));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  fetchChatRunStatus: vi.fn(),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
  listProjectRuns: vi.fn().mockResolvedValue([]),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: vi.fn(),
}));

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    deletePreviewComment: vi.fn(),
    fetchPreviewComments: vi.fn(),
    fetchProjectFiles: vi.fn().mockResolvedValue([]),
    fetchSkill: vi.fn(),
    getTemplate: vi.fn(),
    patchPreviewCommentStatus: vi.fn(),
    upsertPreviewComment: vi.fn(),
    writeProjectTextFile: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    cacheTabsLocally: vi.fn((_projectId: string, state: { tabs: string[]; active: string | null }) => state),
    createConversation: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
    loadTabs: vi.fn(),
    patchConversation: vi.fn(),
    patchProject: vi.fn(),
    persistTabsToDaemonNow: vi.fn(),
    saveMessage: vi.fn(),
    saveTabs: vi.fn(),
  };
});

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  ),
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  FILES_TAB: '__design_files__',
  FileWorkspace: ({ tabsState, onTabsStateChange, openRequest, headerActions, gameControls, gameViewRequest, gameTabRequest, projectReadsHeld }: {
    tabsState: { tabs: string[]; active: string | null };
    onTabsStateChange: (state: { tabs: string[]; active: string | null }) => void;
    openRequest?: { name: string; nonce: number } | null;
    headerActions?: ReactNode;
    gameControls?: { verifyAvailable: boolean; startRequest: { kind: string; nonce: number } | null };
    gameViewRequest?: number;
    projectReadsHeld?: boolean;
    gameTabRequest?: { projectId: string; tab: 'assets' | 'generate'; nonce: number } | null;
  }) => {
    useEffect(() => {
      if (!openRequest?.name) return;
      if (tabsState.active === openRequest.name && tabsState.tabs.includes(openRequest.name)) return;
      const tabs = tabsState.tabs.includes(openRequest.name)
        ? tabsState.tabs
        : [...tabsState.tabs, openRequest.name];
      onTabsStateChange({ tabs, active: openRequest.name });
    }, [onTabsStateChange, openRequest?.name, openRequest?.nonce, tabsState.tabs]);
    return (
      <div data-testid="file-workspace">
        {headerActions}
        {gameControls ? <output data-testid="workspace-game-controls" data-reads-held={projectReadsHeld ? 'true' : 'false'}>
          {`${gameControls.verifyAvailable ? 'verify' : 'run-only'}:${gameControls.startRequest?.kind ?? 'none'}:${gameControls.startRequest?.nonce ?? 0}`}
        </output> : null}
        <output data-testid="workspace-game-view-request">{gameViewRequest ?? 0}</output>
        <output data-testid="workspace-active-tab">{tabsState.active ?? ''}</output>
        <output data-testid="workspace-game-tab">{gameTabRequest?.tab ?? ''}</output>

        <button
          type="button"
          data-testid="close-all-tabs"
          onClick={() => onTabsStateChange({ tabs: [], active: null })}
        >
          close all tabs
        </button>
      </div>
    );
  },
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => <div data-testid="loader" />,
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: () => <div data-testid="chat-pane" />,
}));

vi.mock('../../src/components/game/EngineBadge', () => ({
  EngineBadge: () => null,
}));


const mockedListConversations = vi.mocked(listConversations);
const mockedCreateConversation = vi.mocked(createConversation);
const mockedListMessages = vi.mocked(listMessages);
const mockedLoadTabs = vi.mocked(loadTabs);
const mockedCacheTabsLocally = vi.mocked(cacheTabsLocally);
const mockedFetchProjectFiles = vi.mocked(fetchProjectFiles);
const mockedNavigate = vi.mocked(navigate);

// Read during collection: every vi.importActual call waits on Vitest's main
// process, even for a module that is already loaded. Its thread can be blocked
// for seconds spawning workers for other test files, and inside a test body that
// wait is charged to the 5s test budget.
const actualProjects = await vi.importActual<typeof import('../../src/state/projects')>(
  '../../src/state/projects',
);

const config: AppConfig = {
  mode: 'api',
  apiKey: '',
  baseUrl: '',
  model: '',
  agentId: null,
  skillId: null,
};

const project: Project = {
  id: 'project-1',
  name: 'Project 1',
  skillId: null,
  createdAt: 1,
  updatedAt: 1,
};

const conversation: Conversation = {
  id: 'conv-1',
  projectId: project.id,
  title: null,
  createdAt: 1,
  updatedAt: 1,
};

function renderProjectView(props?: {
  project?: Project;
  routeFileName?: string | null;
  routeConversationId?: string | null;
  onOpenSettings?: ComponentProps<typeof ProjectView>['onOpenSettings'];
  creationHandoff?: ComponentProps<typeof ProjectView>['creationHandoff'];
}) {
  return render(
    <ProjectView
      project={props?.project ?? project}
      routeFileName={props?.routeFileName ?? null}
      routeConversationId={props?.routeConversationId ?? null}
      creationHandoff={props?.creationHandoff}
      config={config}
      agents={[] as AgentInfo[]}
      skills={[] as SkillSummary[]}
      designTemplates={[] as SkillSummary[]}
      daemonLive
      onModeChange={vi.fn()}
      onAgentChange={vi.fn()}
      onAgentModelChange={vi.fn()}
      onRefreshAgents={vi.fn()}
      onOpenSettings={props?.onOpenSettings ?? vi.fn()}
      onBack={vi.fn()}
      onClearPendingPrompt={vi.fn()}
      onTouchProject={vi.fn()}
      onProjectChange={vi.fn()}
      onProjectsRefresh={vi.fn()}
    />,
  );
}

describe('ProjectView tab URL hydration', () => {
  beforeEach(() => {
    mockedListConversations.mockResolvedValue([conversation]);
    mockedCreateConversation.mockResolvedValue(conversation);
    mockedListMessages.mockResolvedValue([]);
    mockedLoadTabs.mockResolvedValue({ tabs: ['index.html'], active: 'index.html' });
    mockedFetchProjectFiles.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('syncs a persisted active tab to the URL before the file list has hydrated', async () => {
    renderProjectView();

    await waitFor(() => {
      expect(mockedNavigate).toHaveBeenCalledWith(
        // The active conversation id is threaded into the URL alongside
        // the active tab so a reload / share preserves the conversation
        // segment of `/projects/:id/conversations/:cid/files/...`
        // (PerishCode + Codex P1 on PR #1508).
        {
          kind: 'project',
          projectId: project.id,
          conversationId: 'conv-1',
          fileName: 'index.html',
        },
        { replace: true },
      );
    });
  });

  it('preserves a restarted deep-linked conversation while its DB conversation list hydrates', async () => {
    // Race shape: `loadTabs` resolves and sets the active tab BEFORE
    // `listConversations` resolves and restores `activeConversationId`. The
    // route already identifies the persisted DB conversation, so the interim
    // tab sync must retain it instead of replacing
    // `/projects/:id/conversations/:cid/files/...` with `/projects/:id/files/...`.
    // Once the list resolves, the same id becomes active and remains canonical.
    let resolveConversations: (value: Conversation[]) => void = () => {};
    const conversationsPromise = new Promise<Conversation[]>((resolve) => {
      resolveConversations = resolve;
    });
    mockedListConversations.mockReturnValue(conversationsPromise);
    mockedLoadTabs.mockResolvedValue({ tabs: ['index.html'], active: 'index.html' });

    renderProjectView({ routeConversationId: conversation.id });

    // First navigate: active tab synced, conversation still loading. The
    // existing route is the only conversation authority available.
    await waitFor(() => {
      expect(mockedNavigate).toHaveBeenCalledWith(
        {
          kind: 'project',
          projectId: project.id,
          conversationId: conversation.id,
          fileName: 'index.html',
        },
        { replace: true },
      );
    });
    expect(mockedNavigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null }),
      { replace: true },
    );

    // Now resolve the conversation list. The routed conversation is present in
    // DB and becomes the active conversation without an intermediate route loss.
    resolveConversations([conversation]);

    await waitFor(() => {
      expect(mockedNavigate).toHaveBeenCalledWith(
        {
          kind: 'project',
          projectId: project.id,
          conversationId: 'conv-1',
          fileName: 'index.html',
        },
        { replace: true },
      );
    });
  });

  it('does not reopen the primary file after the user closes the last tab', async () => {
    mockedLoadTabs.mockResolvedValue({ tabs: [], active: null });
    mockedFetchProjectFiles.mockResolvedValue([
      {
        name: 'index.html',
        path: 'index.html',
        type: 'file',
        size: 1,
        mtime: 1,
        mime: 'text/html',
        kind: 'html',
        artifactManifest: {
          version: 1,
          kind: 'html',
          title: 'Index',
          entry: 'index.html',
          renderer: 'html',
          primary: true,
          exports: ['html'],
        },
      },
    ]);

    renderProjectView();

    await waitFor(() => expect(screen.getByTestId('workspace-active-tab').textContent).toBe('index.html'));
    // Tab state persists synchronously through cacheTabsLocally (the daemon PUT
    // is debounced via persistTabsToDaemonNow); assert on the synchronous cache
    // write so the test stays deterministic without driving the debounce timer.
    expect(mockedCacheTabsLocally).toHaveBeenCalledWith(
      project.id,
      { tabs: ['index.html'], active: 'index.html' },
    );

    fireEvent.click(screen.getByTestId('close-all-tabs'));

    await waitFor(() => expect(screen.getByTestId('workspace-active-tab').textContent).toBe(''));
    await waitFor(() => {
      expect(mockedCacheTabsLocally.mock.calls.at(-1)).toEqual([
        project.id,
          { tabs: [], active: null },
      ]);
    });
    // Exactly two writes — the initial primary open and the close-all — proving
    // the primary file is not silently reopened after the last tab closes.
    expect(mockedCacheTabsLocally).toHaveBeenCalledTimes(2);
  });

  it.each([
    { tabs: ['restore-me.png'], active: '__design_files__' },
    { tabs: [], active: null },
  ])('keeps a locally restored selection over the default primary file: $active', async (selection) => {
    const cachedProjectId = `local-restoration-${selection.active ?? 'empty'}`;
    const cacheKey = `pixo:project-tabs:v1:${cachedProjectId}`;
    window.localStorage.setItem(cacheKey, JSON.stringify({ ...selection, updatedAt: 2 }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      tabs: [], active: null, hasSavedState: false,
    }));
    let restored;
    try {
      restored = await actualProjects.loadTabs(cachedProjectId, {
        reconcileNewerCacheToDaemon: false,
      });
    } finally {
      fetchSpy.mockRestore();
      window.localStorage.removeItem(cacheKey);
    }
    mockedLoadTabs.mockResolvedValue(restored);
    mockedFetchProjectFiles.mockResolvedValue([{
      name: 'restore-me.png', path: 'restore-me.png', type: 'file',
      size: 1, mtime: 1, mime: 'image/png', kind: 'image',
    }]);

    renderProjectView({ project: { ...project, id: cachedProjectId } });

    await waitFor(() => expect(mockedFetchProjectFiles).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('workspace-active-tab').textContent)
      .toBe(selection.active ?? ''));
    expect(mockedCacheTabsLocally).not.toHaveBeenCalledWith(
      cachedProjectId, expect.objectContaining({ active: 'restore-me.png' }),
    );
  });

  it('does not auto-open the primary file when saved tabs were explicitly empty', async () => {
    mockedLoadTabs.mockResolvedValue({ tabs: [], active: null, hasSavedState: true });
    mockedFetchProjectFiles.mockResolvedValue([
      {
        name: 'index.html',
        path: 'index.html',
        type: 'file',
        size: 1,
        mtime: 1,
        mime: 'text/html',
        kind: 'html',
        artifactManifest: {
          version: 1,
          kind: 'html',
          title: 'Index',
          entry: 'index.html',
          renderer: 'html',
          primary: true,
          exports: ['html'],
        },
      },
    ]);

    renderProjectView();

    await waitFor(() => expect(screen.getByTestId('workspace-active-tab').textContent).toBe(''));
    expect(mockedCacheTabsLocally).not.toHaveBeenCalled();
  });

  it('does not mount the game run control before the project has been persisted', () => {
    renderProjectView({
      creationHandoff: { prompt: 'Build a game', conversationId: 'conv-seed', persisted: false },
    });

    expect(screen.getByTestId('file-workspace')).toBeTruthy();
    // The 游戏 view reads nothing (no run polling) while the project row is held.
    expect(screen.getByTestId('workspace-game-controls').getAttribute('data-reads-held')).toBe('true');
  });
});
