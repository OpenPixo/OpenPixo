// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectView } from '../../src/components/ProjectView';
import type { ChatMessage, ProjectFile } from '../../src/types';

const listConversations = vi.fn();
const listMessages = vi.fn();
const loadTabs = vi.fn();
const fetchProjectFiles = vi.fn();
const fetchProjectFileText = vi.fn();
const writeProjectTextFile = vi.fn();
const fetchSkill = vi.fn();
const getTemplate = vi.fn();
const fetchChatRunStatus = vi.fn();
const listActiveChatRuns = vi.fn();
const listProjectRuns = vi.fn();
const reattachDaemonRun = vi.fn();
const saveMessage = vi.fn();

const harness = vi.hoisted(() => ({
  onTabsStateChange: null as null | ((state: { tabs: string[]; active: string | null }) => void),
  activeTab: null as string | null,
  openRequestNames: [] as string[],
}));

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (value: string) => value,
  }),
  useT: () => ((value: string) => value),
}));

vi.mock('../../src/providers/anthropic', () => ({
  streamMessage: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  GENERIC_DAEMON_DISCONNECT_CODE: 'GENERIC_DAEMON_DISCONNECT',
  GENERIC_DAEMON_DISCONNECT_MESSAGE: 'daemon stream disconnected before run completed',
  fetchChatRunStatus: (...args: unknown[]) => fetchChatRunStatus(...args),
  fetchAmrWalletSnapshot: vi.fn().mockResolvedValue(null),
  listActiveChatRuns: (...args: unknown[]) => listActiveChatRuns(...args),
  listProjectRuns: (...args: unknown[]) => listProjectRuns(...args),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: (...args: unknown[]) => reattachDaemonRun(...args),
  streamViaDaemon: vi.fn(),
}));

vi.mock('../../src/providers/registry', () => ({
  deletePreviewComment: vi.fn(),
  fetchPreviewComments: vi.fn(),
  fetchProjectFileText: (...args: unknown[]) => fetchProjectFileText(...args),
  fetchProjectFiles: (...args: unknown[]) => fetchProjectFiles(...args),
  fetchSkill: (...args: unknown[]) => fetchSkill(...args),
  patchPreviewCommentStatus: vi.fn(),
  upsertPreviewComment: vi.fn(),
  writeProjectTextFile: (...args: unknown[]) => writeProjectTextFile(...args),
}));

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
}));

vi.mock('../../src/state/projects', () => ({
  cacheTabsLocally: vi.fn((projectId: string, tabs: unknown) => ({ projectId, tabs })),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getTemplate: (...args: unknown[]) => getTemplate(...args),
  listConversations: (...args: unknown[]) => listConversations(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
  loadTabs: (...args: unknown[]) => loadTabs(...args),
  patchConversation: vi.fn(),
  patchProject: vi.fn(),
  persistTabsToDaemonNow: vi.fn(),
  saveMessage: (...args: unknown[]) => saveMessage(...args),
  saveTabs: vi.fn(),
}));

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: () => null,
}));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: () => null,
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  FileWorkspace: ({
    openRequest,
    onTabsStateChange,
    tabsState,
  }: {
    openRequest?: { name?: string; openBatch?: readonly string[] } | null;
    onTabsStateChange: NonNullable<typeof harness.onTabsStateChange>;
    tabsState: { tabs: string[]; active: string | null };
  }) => {
    harness.onTabsStateChange = onTabsStateChange;
    harness.activeTab = tabsState.active;
    for (const name of [...(openRequest?.openBatch ?? []), openRequest?.name]) {
      if (name && harness.openRequestNames.at(-1) !== name) harness.openRequestNames.push(name);
    }
    return null;
  },
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => null,
}));

const HTML = `<!doctype html><html><head><title>Game</title></head><body>${'<p>level</p>'.repeat(40)}</body></html>`;
const REPLY = `<artifact identifier="game" type="text/html" title="Game">${HTML}</artifact>`;

type Source = 'reattach-done' | 'reattach-error' | 'replay';
type Delivery = 'persisted' | 'same-turn-write';

async function runScenario(source: Source, delivery: Delivery, userTakesOver: boolean) {
  const startedAt = Date.now() - 5_000;
  const notes: ProjectFile = {
    name: 'notes.md', path: 'notes.md', size: 10, mtime: startedAt - 60_000, kind: 'text', mime: 'text/markdown',
  };
  const review: ProjectFile = { ...notes, name: 'review.md', path: 'review.md' };
  const game: ProjectFile = {
    name: 'game.html', path: 'game.html', size: HTML.length, mtime: startedAt + 1_000, kind: 'html', mime: 'text/html',
  };
  const terminal = source === 'replay';

  listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
  listMessages.mockResolvedValue([{
    id: 'msg-1', role: 'assistant', content: '', agentId: 'codex',
    createdAt: startedAt, startedAt, runId: 'run-1',
    runStatus: terminal ? 'succeeded' : 'running',
    endedAt: terminal ? startedAt + 2_000 : undefined,
    preTurnFileNames: [notes.name, review.name],
    events: terminal ? [{ kind: 'text', text: REPLY }] : [],
  } satisfies ChatMessage]);
  loadTabs.mockResolvedValue({ tabs: [notes.name], active: notes.name, hasSavedState: true });
  fetchSkill.mockResolvedValue(null);
  getTemplate.mockResolvedValue(null);
  listActiveChatRuns.mockResolvedValue([]);
  listProjectRuns.mockResolvedValue([]);
  saveMessage.mockResolvedValue(undefined);
  fetchProjectFileText.mockResolvedValue(HTML);

  let filesOnDisk = [notes, review];
  fetchProjectFiles.mockImplementation(async () => filesOnDisk);
  writeProjectTextFile.mockImplementation(async () => {
    filesOnDisk = [notes, review, game];
    return game;
  });

  const status = {
    id: 'run-1', status: terminal ? 'succeeded' : 'running', createdAt: startedAt,
    updatedAt: startedAt + 2_000, exitCode: null, signal: null,
  };
  // A replay finishes on its own, so hold it at the status probe while the user
  // picks a tab. A reattached stream waits for the handlers below anyway.
  let releaseStatus!: (value: typeof status) => void;
  const statusReady = new Promise<typeof status>((resolve) => { releaseStatus = resolve; });
  fetchChatRunStatus.mockReturnValue(terminal ? statusReady : Promise.resolve(status));

  let handlers: {
    onDelta: (text: string) => void;
    onDone: () => void;
    onError: (error: Error) => void;
  } | null = null;
  reattachDaemonRun.mockImplementation(async (options: any) => {
    handlers = options.handlers;
    return new Promise<void>(() => {});
  });

  const project = { id: 'project-1', name: 'Project', skillId: null } as never;
  render(
    <ProjectView
      project={project}
      initialProjectDetail={{ project, resolvedDir: null }}
      routeConversationId={null}
      routeFileName={null}
      config={{ mode: 'daemon', agentId: 'agent-1', notifications: undefined, agentModels: {} } as never}
      agents={[{ id: 'agent-1', name: 'OpenCode', models: [] } as never]}
      skills={[]}
      designTemplates={[]}
      daemonLive
      onModeChange={() => {}}
      onAgentChange={() => {}}
      onAgentModelChange={() => {}}
      onRefreshAgents={() => {}}
      onOpenSettings={() => {}}
      onBack={() => {}}
      onClearPendingPrompt={() => {}}
      onTouchProject={() => {}}
      onProjectChange={() => {}}
      onProjectsRefresh={() => {}}
    />,
  );

  if (terminal) await waitFor(() => expect(fetchChatRunStatus).toHaveBeenCalled());
  else await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(harness.activeTab).toBe(notes.name));
  expect(harness.openRequestNames).toEqual([]);

  if (userTakesOver) {
    act(() => {
      harness.onTabsStateChange!({ tabs: [notes.name, review.name], active: review.name });
    });
  }

  // The agent had already written the file itself, so only the matching step
  // can open it; nothing is persisted.
  if (delivery === 'same-turn-write') filesOnDisk = [notes, review, game];

  await act(async () => {
    if (terminal) {
      releaseStatus(status);
      return;
    }
    handlers!.onDelta(REPLY);
    if (source === 'reattach-done') handlers!.onDone();
    else handlers!.onError(new Error('the agent crashed after replying'));
  });

  await waitFor(() => {
    const saved = saveMessage.mock.calls
      .map((call) => call[2] as ChatMessage)
      .filter((message) => message?.id === 'msg-1' && message.producedFiles?.length)
      .at(-1);
    expect(saved?.producedFiles?.map((file) => file.name)).toEqual(['game.html']);
  });
  // Later opens run off the same promise chains as the save above.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}

describe('a run finishing after reload respects the tab the user chose', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    harness.onTabsStateChange = null;
    harness.activeTab = null;
    harness.openRequestNames = [];
    window.sessionStorage.clear();
  });

  const cases: Array<{ source: Source; delivery: Delivery }> = [
    { source: 'reattach-done', delivery: 'persisted' },
    { source: 'reattach-done', delivery: 'same-turn-write' },
    { source: 'reattach-error', delivery: 'persisted' },
    { source: 'reattach-error', delivery: 'same-turn-write' },
    { source: 'replay', delivery: 'persisted' },
    { source: 'replay', delivery: 'same-turn-write' },
  ];

  it.each(cases)('$source, $delivery: stays on the chosen tab and still delivers', async ({ source, delivery }) => {
    await runScenario(source, delivery, true);

    expect(harness.openRequestNames).toEqual([]);
    // Not an exact count: on a replay the recovery poll sees the same row and
    // can write the same file too.
    expect(writeProjectTextFile.mock.calls.length > 0).toBe(delivery === 'persisted');
  });

  it.each(cases)('$source, $delivery: opens the artifact when the user did not choose', async ({ source, delivery }) => {
    await runScenario(source, delivery, false);

    expect(harness.openRequestNames).toContain('game.html');
  });
});
