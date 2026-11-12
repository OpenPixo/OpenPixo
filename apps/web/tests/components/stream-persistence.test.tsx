// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantPersistWindowMs, ProjectView } from '../../src/components/ProjectView';
import type { ChatMessage } from '../../src/types';

const listConversations = vi.fn();
const listMessages = vi.fn();
const loadTabs = vi.fn();
const fetchProjectFiles = vi.fn();
const fetchSkill = vi.fn();
const getTemplate = vi.fn();
const listActiveChatRuns = vi.fn();
const listProjectRuns = vi.fn();
const streamViaDaemon = vi.fn();
const saveMessage = vi.fn();

const harness = vi.hoisted(() => ({
  onSend: null as null | ((prompt: string, attachments: unknown[]) => unknown),
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
  fetchChatRunStatus: vi.fn().mockResolvedValue(null),
  fetchAmrWalletSnapshot: vi.fn().mockResolvedValue(null),
  listActiveChatRuns: (...args: unknown[]) => listActiveChatRuns(...args),
  listProjectRuns: (...args: unknown[]) => listProjectRuns(...args),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: (...args: unknown[]) => streamViaDaemon(...args),
}));

vi.mock('../../src/providers/registry', () => ({
  deletePreviewComment: vi.fn(),
  fetchPreviewComments: vi.fn(),
  fetchProjectFiles: (...args: unknown[]) => fetchProjectFiles(...args),
  fetchSkill: (...args: unknown[]) => fetchSkill(...args),
  patchPreviewCommentStatus: vi.fn(),
  upsertPreviewComment: vi.fn(),
  writeProjectTextFile: vi.fn(),
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
  ChatPane: ({ onSend }: { onSend: typeof harness.onSend }) => {
    harness.onSend = onSend;
    return null;
  },
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  FileWorkspace: () => null,
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => null,
}));

interface StreamHandlers {
  onAgentEvent: (event: unknown) => void;
  onDone: (text?: string) => void;
}

/** Renders with real timers, starts a run, and only then hands time to the test. */
async function startRun(): Promise<StreamHandlers> {
  listConversations.mockResolvedValue([{ id: 'conv-1', title: 'Conversation' }]);
  listMessages.mockResolvedValue([]);
  loadTabs.mockResolvedValue({ tabs: [], active: null, hasSavedState: false });
  fetchProjectFiles.mockResolvedValue([]);
  fetchSkill.mockResolvedValue(null);
  getTemplate.mockResolvedValue(null);
  listActiveChatRuns.mockResolvedValue([]);
  listProjectRuns.mockResolvedValue([]);
  saveMessage.mockResolvedValue(undefined);

  let handlers: StreamHandlers | null = null;
  streamViaDaemon.mockImplementation(async (options: any) => {
    options.onRunCreated('run-1');
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
  await waitFor(() => expect(harness.onSend).toBeTruthy());
  void harness.onSend!('make a game', []);
  await waitFor(() => expect(handlers).toBeTruthy());
  vi.useFakeTimers();
  saveMessage.mockClear();
  return handlers!;
}

let nextEventId = 0;
function pushEvents(handlers: StreamHandlers, count: number) {
  for (let i = 0; i < count; i += 1) {
    nextEventId += 1;
    handlers.onAgentEvent({ kind: 'tool_use', id: `tool-${nextEventId}`, name: 'Read', input: { path: 'a.txt' } });
  }
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function assistantSaves() {
  return saveMessage.mock.calls
    .map((call) => ({ message: call[2] as ChatMessage, options: call[3] as Record<string, unknown> | undefined }))
    .filter(({ message }) => message?.role === 'assistant');
}

describe('assistantPersistWindowMs', () => {
  it.each([
    [0, 500],
    [1, 500],
    [50, 500],
    [100, 1_000],
    [250, 2_500],
    [500, 5_000],
    [5_000, 5_000],
  ])('%i events wait %i ms', (eventCount, windowMs) => {
    expect(assistantPersistWindowMs(eventCount)).toBe(windowMs);
  });
});

describe('persisting the assistant message while it streams', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    harness.onSend = null;
    window.sessionStorage.clear();
  });

  it('still writes a small message 500 ms after its first event', async () => {
    const handlers = await startRun();

    await act(async () => { pushEvents(handlers, 1); });
    await advance(499);
    expect(assistantSaves()).toHaveLength(0);

    await advance(1);
    expect(assistantSaves()).toHaveLength(1);
  });

  it('writes a third as often over a 50 s run of 500 events', async () => {
    const handlers = await startRun();

    for (let tick = 0; tick < 500; tick += 1) {
      await act(async () => { pushEvents(handlers, 1); });
      await advance(100);
    }

    // A flat 500 ms window makes 100 writes here.
    const saves = assistantSaves().length;
    expect(saves).toBeGreaterThan(20);
    expect(saves).toBeLessThan(40);
    // The last write is never more than the cap behind the stream.
    expect(assistantSaves().at(-1)!.message.events!.length).toBeGreaterThanOrEqual(450);
  });

  it('never waits more than 5 s, however large the message is', async () => {
    const handlers = await startRun();
    await act(async () => { pushEvents(handlers, 2_000); });
    await advance(5_000);
    saveMessage.mockClear();

    await act(async () => { pushEvents(handlers, 1); });
    await advance(4_999);
    expect(assistantSaves()).toHaveLength(0);

    await advance(1);
    expect(assistantSaves()).toHaveLength(1);
    expect(assistantSaves()[0]!.message.events).toHaveLength(2_001);
  });

  it('writes the terminal message without waiting for the window', async () => {
    const handlers = await startRun();
    await act(async () => { pushEvents(handlers, 2_000); });
    await advance(5_000);
    await act(async () => { pushEvents(handlers, 1); });
    saveMessage.mockClear();

    await act(async () => {
      handlers.onDone('done');
      await vi.advanceTimersByTimeAsync(0);
    });

    const terminal = assistantSaves().find(({ options }) => options?.telemetryFinalized === true);
    expect(terminal?.message.runStatus).toBe('succeeded');
    expect(terminal?.message.events?.length).toBeGreaterThanOrEqual(2_001);
  });

  it('flushes on pagehide with keepalive, cancelling the pending window', async () => {
    const handlers = await startRun();
    await act(async () => { pushEvents(handlers, 2_000); });
    await advance(5_000);
    await act(async () => { pushEvents(handlers, 1); });
    saveMessage.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await vi.advanceTimersByTimeAsync(0);
    });

    const saves = assistantSaves();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.options?.keepalive).toBe(true);
    expect(saves[0]!.message.events).toHaveLength(2_001);

    await advance(6_000);
    expect(assistantSaves()).toHaveLength(1);
  });
});
