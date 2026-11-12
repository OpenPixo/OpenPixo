// @vitest-environment jsdom
// Existing behavior guard, expected green on fbbadcc. Not a new bug red spec.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectView } from '../../src/components/ProjectView';
import type { ChatMessage } from '../../src/types';
import type { DaemonReattachOptions } from '../../src/providers/daemon';

const listConversations = vi.fn();
const listMessages = vi.fn();
const fetchPreviewComments = vi.fn();
const loadTabs = vi.fn();
const fetchProjectFiles = vi.fn();
const fetchProjectDesignSystemPackageAudit = vi.fn();
const fetchSkill = vi.fn();
const fetchDesignSystem = vi.fn();
const getTemplate = vi.fn();
const fetchChatRunStatus = vi.fn();
const listActiveChatRuns = vi.fn();
const listProjectRuns = vi.fn();
const reattachDaemonRun = vi.fn();
const publishDaemonRunFinishedEvent = vi.fn();
const streamViaDaemon = vi.fn();
const saveMessage = vi.fn();
const createConversation = vi.fn();
const patchConversation = vi.fn();
const patchProject = vi.fn();
const saveTabs = vi.fn();

/** ChatPane 收到的最后一份 props —— 发送闸与停止按钮的可见判据都在这里。 */
const paneHarness = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  streaming: false,
  sendDisabled: false,
}));

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: (value: string) => value }),
  useT: () => ((value: string) => value),
}));

vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));

vi.mock('../../src/providers/daemon', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/providers/daemon')>(),
  GENERIC_DAEMON_DISCONNECT_CODE: 'GENERIC_DAEMON_DISCONNECT',
  GENERIC_DAEMON_DISCONNECT_MESSAGE: 'daemon stream disconnected before run completed',
  fetchChatRunStatus: (...args: unknown[]) => fetchChatRunStatus(...args),
  listActiveChatRuns: (...args: unknown[]) => listActiveChatRuns(...args),
  listProjectRuns: (...args: unknown[]) => listProjectRuns(...args),
  publishDaemonRunFinishedEvent: (...args: unknown[]) => publishDaemonRunFinishedEvent(...args),
  reattachDaemonRun: (...args: unknown[]) => reattachDaemonRun(...args),
  streamViaDaemon: (...args: unknown[]) => streamViaDaemon(...args),
}));

vi.mock('../../src/providers/registry', () => ({
  deletePreviewComment: vi.fn(),
  fetchPreviewComments: (...args: unknown[]) => fetchPreviewComments(...args),
  fetchProjectFiles: (...args: unknown[]) => fetchProjectFiles(...args),
  fetchSkill: (...args: unknown[]) => fetchSkill(...args),
  patchPreviewCommentStatus: vi.fn(),
  upsertPreviewComment: vi.fn(),
  writeProjectTextFile: vi.fn(),
}));

vi.mock('../../src/providers/project-events', () => ({ useProjectFileEvents: vi.fn() }));
vi.mock('../../src/router', () => ({ navigate: vi.fn() }));

vi.mock('../../src/state/projects', () => ({
  cacheTabsLocally: vi.fn((projectId: string, tabs: unknown) => ({ projectId, tabs })),
  createConversation: (...args: unknown[]) => createConversation(...args),
  deleteConversation: vi.fn(),
  getTemplate: (...args: unknown[]) => getTemplate(...args),
  listConversations: (...args: unknown[]) => listConversations(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
  loadTabs: (...args: unknown[]) => loadTabs(...args),
  patchConversation: (...args: unknown[]) => patchConversation(...args),
  patchProject: (...args: unknown[]) => patchProject(...args),
  persistTabsToDaemonNow: vi.fn(),
  saveMessage: (...args: unknown[]) => saveMessage(...args),
  saveTabs: (...args: unknown[]) => saveTabs(...args),
}));

vi.mock('../../src/components/AppChromeHeader', () => ({ AppChromeHeader: () => null }));
vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: (props: {
    messages: ChatMessage[];
    streaming: boolean;
    sendDisabled: boolean;
  }) => {
    paneHarness.messages = props.messages;
    paneHarness.streaming = props.streaming;
    paneHarness.sendDisabled = props.sendDisabled;
    return null;
  },
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  FileWorkspace: () => null,
}));

vi.mock('../../src/components/Loading', () => ({ CenteredLoader: () => null }));

// Read during collection: every vi.importActual call waits on Vitest's main
// process, even for a module that is already loaded. Its thread can be blocked
// for seconds spawning workers for other test files, and inside a test body that
// wait is charged to the 5s test budget.
const actualDaemon = await vi.importActual<typeof import('../../src/providers/daemon')>('../../src/providers/daemon');

const RUN_ID = '2746-full-replay-run';
const MESSAGE_ID = '2746-full-replay-assistant';
const CONVERSATION_ID = '2746-full-replay-conversation';
const HEAD = 'Existing reasoning prefix. ';
const TAIL = 'Already persisted reasoning tail.';
const ANSWER = 'The normal chat response is complete.';
const stored: ChatMessage = {
  id: MESSAGE_ID, role: 'assistant', content: '', agentId: 'claude',
  sessionMode: 'chat', runId: RUN_ID, runStatus: 'running',
  // Review hypothesis: retained TAIL is newer than the stored cursor.
  // The actual mounted host must not pass this stale cursor into reattach.
  lastRunEventId: '6', startedAt: 1000,
  events: [{ kind: 'thinking', text: HEAD + TAIL }],
};
function renderProjectView(options?: { daemonLive?: boolean }) {
  const project = {
    id: 'project-1',
    name: 'Project',
    skillId: null,
  } as never;
  return render(
    <ProjectView
      project={project}
      initialProjectDetail={{ project, resolvedDir: null }}
      routeFileName={null}
      config={{ mode: 'daemon', agentId: 'claude', notifications: undefined, agentModels: {} } as never}
      agents={[{ id: 'claude', name: 'Claude', models: [] } as never]}
      skills={[]}
      designTemplates={[]}
      daemonLive={options?.daemonLive ?? true}
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
}


function paneMessage() { return paneHarness.messages.find(message => message.id === MESSAGE_ID); }
function thinking(message: ChatMessage | undefined) {
  return (message?.events ?? []).flatMap(event => event.kind === 'thinking' ? [event.text] : []).join('');
}
function frame(id: number, event: string, data: Record<string, unknown>) {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('OPEND-2746 current mounted host recovery contract', () => {
  it.each(['succeeded', 'failed'] as const)('ordinary %s reattach replaces stale buffers once and keeps the physical Run identity', async (terminalStatus) => {
    paneHarness.messages = [];
    let terminal = false;
    listConversations.mockResolvedValue([{ id: CONVERSATION_ID, projectId: 'project-1', title: 'T', sessionMode: 'chat', createdAt: 0, updatedAt: 0 }]);
    listMessages.mockResolvedValue([structuredClone(stored)]);
    loadTabs.mockResolvedValue({ tabs: [], activeTabId: null });
    fetchProjectFiles.mockResolvedValue([]);
    fetchProjectDesignSystemPackageAudit.mockResolvedValue(null);
    listActiveChatRuns.mockResolvedValue([]);
    listProjectRuns.mockResolvedValue([]);
    fetchSkill.mockResolvedValue(null);
    fetchDesignSystem.mockResolvedValue(null);
    getTemplate.mockResolvedValue(null);
    saveMessage.mockResolvedValue(undefined);
    fetchChatRunStatus.mockImplementation(async () => ({
      id: RUN_ID, projectId: 'project-1', conversationId: CONVERSATION_ID,
      assistantMessageId: MESSAGE_ID, agentId: 'claude',
      status: terminal ? terminalStatus : 'running', createdAt: 1000,
      updatedAt: terminal ? 2000 : 1000, artifactCount: 0,
    }));
    let releaseReplay!: () => void;
    const replayAllowed = new Promise<void>(resolve => { releaseReplay = resolve; });
    let providerCompleted!: () => void;
    const providerDone = new Promise<void>(resolve => { providerCompleted = resolve; });
    reattachDaemonRun.mockImplementation(async (options: DaemonReattachOptions) => {
      await replayAllowed;
      try { await actualDaemon.reattachDaemonRun(options); }
      finally { providerCompleted(); }
    });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
      if (url.pathname !== `/api/runs/${RUN_ID}/events`) throw new Error(`Unexpected network request: ${url.pathname}`);
      requests.push(url.pathname + url.search);
      terminal = true;
      const wire = frame(1, 'start', { bin: 'claude' })
        + frame(6, 'agent', { type: 'thinking_delta', delta: HEAD })
        + frame(7, 'agent', { type: 'thinking_delta', delta: TAIL })
        + frame(8, 'stdout', { chunk: ANSWER })
        + frame(9, 'end', { status: terminalStatus, code: terminalStatus === 'failed' ? 1 : 0, artifactCount: 0 });
      return new Response(wire, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }));
    renderProjectView();
    await waitFor(() => expect(reattachDaemonRun).toHaveBeenCalledTimes(1));
    const options = reattachDaemonRun.mock.calls[0]![0] as DaemonReattachOptions;
    expect(options.runId).toBe(RUN_ID);
    expect(options.initialLastEventId).toBeNull();
    expect(stored.lastRunEventId).toBe('6');
    expect(thinking(stored)).toBe(HEAD + TAIL);
    await waitFor(() => {
      expect(paneMessage()?.events).toEqual([]);
      expect(paneMessage()?.content).toBe('');
    });
    expect(requests).toEqual([]);
    await act(async () => { releaseReplay(); await providerDone; });
    await waitFor(() => {
      expect(paneMessage()?.runStatus).toBe(terminalStatus);
      expect(paneMessage()?.runId).toBe(RUN_ID);
      expect(paneHarness.messages.filter(message => message.id === MESSAGE_ID)).toHaveLength(1);
      expect(paneMessage()?.content).toBe(ANSWER);
      expect(thinking(paneMessage())).toBe(HEAD + TAIL);
      expect(saveMessage.mock.calls.some(call => {
        const message = call[2] as ChatMessage | undefined;
        return message?.id === MESSAGE_ID && message.runStatus === terminalStatus
          && thinking(message) === HEAD + TAIL && message.content === ANSWER;
      })).toBe(true);
    });
    expect(requests).toEqual([`/api/runs/${RUN_ID}/events`]);
    expect(paneMessage()?.lastRunEventId).toBe('9');
    expect(streamViaDaemon).not.toHaveBeenCalled();
  });
});
