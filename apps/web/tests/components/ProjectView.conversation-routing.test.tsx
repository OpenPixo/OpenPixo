// @vitest-environment jsdom

// The sidebar highlights the conversation the URL names; the chat pane shows
// the conversation ProjectView holds as active. These tests mount the real
// router and the real sidebar group next to ProjectView, so "the sidebar and
// the pane agree" is observed instead of assumed from a mocked navigate.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectConversationGroup } from '../../src/components/entry-nav-rail/ProjectConversationGroup';
import { ProjectView } from '../../src/components/ProjectView';
import {
  fetchChatRunStatus,
  listActiveChatRuns,
  listProjectRuns,
  reattachDaemonRun,
  streamViaDaemon,
} from '../../src/providers/daemon';
import { navigate, useRoute } from '../../src/router';
import { listConversations } from '../../src/state/projects';
import type {
  AgentInfo,
  AppConfig,
  ChatMessage,
  Conversation,
  Project,
  SkillSummary,
} from '../../src/types';

const db = vi.hoisted(() => ({
  conversations: [] as Array<{ id: string; projectId: string; title: string | null; createdAt: number; updatedAt: number }>,
  messages: {} as Record<string, unknown[]>,
  nextId: 1,
  // Lets a test hold a read open, to reproduce a list that was read before the
  // conversation it needs existed.
  beforeListResolves: null as null | (() => Promise<void>),
}));

const chatPane = vi.hoisted(() => ({
  mounts: 0,
  renders: [] as Array<{ conversationId: string | null; messageIds: string[] }>,
}));

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

vi.mock('../../src/hooks/useProjectRunStatuses', () => ({
  acknowledgeProjectCompletion: vi.fn(),
}));

vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));

vi.mock('../../src/providers/daemon', () => ({
  GENERIC_DAEMON_DISCONNECT_CODE: 'GENERIC_DAEMON_DISCONNECT',
  RUNS_CHANGED_EVENT: 'pixo:runs-changed',
  GENERIC_DAEMON_DISCONNECT_MESSAGE: 'daemon stream disconnected before run completed',
  fetchChatRunStatus: vi.fn(),
  listActiveChatRuns: vi.fn(),
  listProjectRuns: vi.fn(),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: vi.fn(),
}));

vi.mock('../../src/providers/project-events', () => ({ useProjectFileEvents: vi.fn() }));

vi.mock('../../src/providers/registry', () => ({
  deletePreviewComment: vi.fn(),
  fetchPreviewComments: vi.fn().mockResolvedValue([]),
  fetchProjectFiles: vi.fn().mockResolvedValue([]),
  fetchSkill: vi.fn().mockResolvedValue(null),
  patchPreviewCommentStatus: vi.fn(),
  upsertPreviewComment: vi.fn(),
  writeProjectTextFile: vi.fn(),
}));

vi.mock('../../src/state/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state/projects')>();
  return {
    ...actual,
    cacheTabsLocally: (_projectId: string, state: unknown) => state,
    createConversation: vi.fn(async (projectId: string) => {
      const created = {
        id: `created-${db.nextId++}`, projectId, title: null, createdAt: 10, updatedAt: 10,
      };
      db.conversations = [created, ...db.conversations];
      db.messages[created.id] = [];
      window.dispatchEvent(new CustomEvent(actual.CONVERSATIONS_CHANGED_EVENT, { detail: { projectId } }));
      return created;
    }),
    deleteConversation: vi.fn(async () => true),
    getTemplate: vi.fn().mockResolvedValue(null),
    listConversations: vi.fn(async () => {
      const snapshot = [...db.conversations];
      await db.beforeListResolves?.();
      return snapshot;
    }),
    listMessages: vi.fn(async (_projectId: string, conversationId: string) => {
      if (!(conversationId in db.messages)) throw new Error('missing conversation');
      return db.messages[conversationId];
    }),
    loadTabs: vi.fn().mockResolvedValue({ tabs: [], active: null }),
    patchConversation: vi.fn(),
    patchProject: vi.fn(),
    persistTabsToDaemonNow: vi.fn(),
    saveMessage: vi.fn(),
    saveTabs: vi.fn(),
  };
});

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));

vi.mock('../../src/components/FileWorkspace', () => ({
  FILES_TAB: '__design_files__',
  FileWorkspace: () => <div data-testid="file-workspace" />,
}));

vi.mock('../../src/components/Loading', () => ({ CenteredLoader: () => null }));

vi.mock('../../src/components/game/EngineBadge', () => ({ EngineBadge: () => null }));

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({
    activeConversationId,
    conversations,
    loading,
    messages,
    onNewConversation,
    onSelectConversation,
    onSend,
    sendDisabled,
    streaming,
  }: {
    activeConversationId: string | null;
    conversations: Conversation[];
    loading?: boolean;
    messages: ChatMessage[];
    onNewConversation: () => void;
    onSelectConversation: (id: string) => void;
    onSend: (prompt: string, attachments: unknown[]) => void;
    sendDisabled?: boolean;
    streaming: boolean;
  }) => {
    chatPane.renders.push({
      conversationId: activeConversationId,
      messageIds: messages.map((message) => message.id),
    });
    useEffect(() => { chatPane.mounts += 1; }, []);
    return (
      <section>
        <output data-testid="pane-conversation">{activeConversationId}</output>
        <output data-testid="pane-transcript">{messages.map((message) => message.content).join('|')}</output>
        <output data-testid="pane-streaming">{streaming ? 'streaming' : 'idle'}</output>
        <output data-testid="pane-loading">{loading ? 'loading' : 'ready'}</output>
        <button type="button" onClick={onNewConversation}>pane:new</button>
        <button type="button" disabled={sendDisabled} onClick={() => onSend('hello', [])}>pane:send</button>
        {conversations.map((conversation) => (
          <button key={conversation.id} type="button" onClick={() => onSelectConversation(conversation.id)}>
            {`pane:pick:${conversation.id}`}
          </button>
        ))}
      </section>
    );
  },
}));

const project: Project = { id: 'game', name: 'My game', skillId: null, createdAt: 1, updatedAt: 1 };

const config: AppConfig = {
  mode: 'daemon', apiKey: '', baseUrl: '', model: '', agentId: 'agent-1', agentModels: {}, skillId: null,
};

const agents: AgentInfo[] = [{ id: 'agent-1', name: 'OpenCode', bin: 'opencode', available: true, models: [] }];

/** What the view handed the provider for one run it is listening to. */
interface RunStream {
  signal?: AbortSignal;
  cancelSignal?: AbortSignal;
  handlers: { onDelta: (delta: string) => void };
}

function userMessage(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, createdAt: 1 };
}

function canceledTurn(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content, createdAt: 2, runId: `run-${id}`, runStatus: 'canceled', endedAt: 3 };
}

function seed(...ids: string[]) {
  db.conversations = ids.map((id, index) => ({
    id, projectId: project.id, title: `Session ${id}`, createdAt: 1, updatedAt: ids.length - index,
  }));
  db.messages = Object.fromEntries(ids.map((id) => [id, [
    userMessage(`${id}-user`, `first message of ${id}`),
    canceledTurn(`${id}-assistant`, `canceled run of ${id}`),
  ]]));
}

/** ProjectView and the sidebar group, both driven by the one real URL. */
function Workbench() {
  const route = useRoute();
  const routed = route.kind === 'project' ? route : null;
  return (
    <>
      <ProjectConversationGroup
        project={project}
        activeProjectId={routed?.projectId ?? null}
        activeConversationId={routed?.conversationId ?? null}
        activeFileName={routed?.fileName ?? null}
      >
        <button type="button" onClick={() => navigate({ kind: 'project', projectId: project.id, fileName: null })}>
          open project
        </button>
      </ProjectConversationGroup>
      <ProjectView
        project={project}
        routeFileName={routed?.fileName ?? null}
        routeConversationId={routed?.conversationId ?? null}
        config={config}
        agents={agents}
        skills={[] as SkillSummary[]}
        designTemplates={[] as SkillSummary[]}
        daemonLive
        onModeChange={vi.fn()}
        onAgentChange={vi.fn()}
        onAgentModelChange={vi.fn()}
        onRefreshAgents={vi.fn()}
        onOpenSettings={vi.fn()}
        onBack={vi.fn()}
        onClearPendingPrompt={vi.fn()}
        onTouchProject={vi.fn()}
        onProjectChange={vi.fn()}
        onProjectsRefresh={vi.fn()}
      />
    </>
  );
}

const paneConversation = () => screen.getByTestId('pane-conversation').textContent;
const paneTranscript = () => screen.getByTestId('pane-transcript').textContent;
const highlighted = () => screen.getByRole('list', { name: /conversationsHeading/ })
  .querySelector('[aria-current="page"]')?.textContent ?? null;
const newFromSidebar = () => screen.getByRole('button', { name: 'chat.newSession · My game' });

async function openOn(conversationId: string) {
  window.history.replaceState(null, '', `/projects/${project.id}/conversations/${conversationId}`);
  render(<Workbench />);
  await waitFor(() => expect(paneTranscript()).toContain(`first message of ${conversationId}`));
  await waitFor(() => expect(highlighted()).toBe(`Session ${conversationId}`));
}

/** The pane and the sidebar name the same conversation, and it is `id`. */
async function expectSettledOn(id: string, title: string) {
  await waitFor(() => {
    expect(paneConversation()).toBe(id);
    expect(highlighted()).toBe(title);
    expect(window.location.pathname).toBe(`/projects/${project.id}/conversations/${id}`);
    expect(screen.getByTestId('pane-loading').textContent).toBe('ready');
  });
}

beforeEach(() => {
  window.localStorage.clear();
  db.nextId = 1;
  db.beforeListResolves = null;
  chatPane.mounts = 0;
  chatPane.renders = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  vi.mocked(listActiveChatRuns).mockResolvedValue([]);
  vi.mocked(listProjectRuns).mockResolvedValue([]);
  vi.mocked(fetchChatRunStatus).mockResolvedValue({
    id: 'run-live',
    projectId: project.id,
    conversationId: 'old',
    assistantMessageId: 'old-assistant',
    agentId: 'agent-1',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    exitCode: null,
    signal: null,
  });
  vi.mocked(reattachDaemonRun).mockImplementation(async () => new Promise<void>(() => {}));
  vi.mocked(streamViaDaemon).mockImplementation(async () => new Promise<void>(() => {}));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the chat pane and the sidebar show the same conversation', () => {
  it('leaves the stopped transcript at once when the sidebar creates a conversation', async () => {
    seed('old');
    await openOn('old');

    fireEvent.click(newFromSidebar());

    await expectSettledOn('created-1', 'chat.untitledConversation');
    expect(paneTranscript()).toBe('');
    expect(screen.getByTestId('pane-streaming').textContent).toBe('idle');
    // Not one painted frame of the old turn under the new conversation.
    const framesOnNew = chatPane.renders.filter((frame) => frame.conversationId === 'created-1');
    expect(framesOnNew.length).toBeGreaterThan(0);
    expect(framesOnNew.flatMap((frame) => frame.messageIds)).toEqual([]);
  });

  it('remounts the pane once per switch, with no loop', async () => {
    seed('old');
    await openOn('old');
    const mountsBefore = chatPane.mounts;

    fireEvent.click(newFromSidebar());
    await expectSettledOn('created-1', 'chat.untitledConversation');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(chatPane.mounts).toBe(mountsBefore + 1);
    expect(paneConversation()).toBe('created-1');
  });

  it('lets a conversation created from the sidebar be picked inside the pane afterwards', async () => {
    seed('old');
    await openOn('old');

    fireEvent.click(newFromSidebar());
    await expectSettledOn('created-1', 'chat.untitledConversation');
    // The pane's own list has caught up with the conversation it now shows.
    await screen.findByRole('button', { name: 'pane:pick:created-1' });

    fireEvent.click(screen.getByRole('button', { name: 'pane:pick:old' }));
    await expectSettledOn('old', 'Session old');
    expect(paneTranscript()).toContain('first message of old');
  });

  it('lands on the conversation the pane itself creates', async () => {
    seed('old');
    await openOn('old');

    fireEvent.click(screen.getByRole('button', { name: 'pane:new' }));

    await expectSettledOn('created-1', 'chat.untitledConversation');
    expect(paneTranscript()).toBe('');
  });

  it('follows sidebar clicks between existing conversations in both directions', async () => {
    seed('one', 'two');
    await openOn('one');

    fireEvent.click(await screen.findByRole('button', { name: 'Session two' }));
    await expectSettledOn('two', 'Session two');
    expect(paneTranscript()).toContain('first message of two');

    fireEvent.click(screen.getByRole('button', { name: 'Session one' }));
    await expectSettledOn('one', 'Session one');
    expect(paneTranscript()).toContain('first message of one');
  });

  it('follows the sidebar back to a conversation after a pick made inside the pane', async () => {
    seed('one', 'two');
    await openOn('one');

    fireEvent.click(await screen.findByRole('button', { name: 'Session two' }));
    await expectSettledOn('two', 'Session two');
    fireEvent.click(screen.getByRole('button', { name: 'pane:pick:one' }));
    await expectSettledOn('one', 'Session one');

    fireEvent.click(screen.getByRole('button', { name: 'Session two' }));
    await expectSettledOn('two', 'Session two');
    expect(paneTranscript()).toContain('first message of two');
  });

  it('keeps the highlight when the project row is clicked while a conversation is open', async () => {
    seed('one', 'two');
    await openOn('two');

    fireEvent.click(screen.getByRole('button', { name: 'open project' }));

    await expectSettledOn('two', 'Session two');
  });

  it('lands on a conversation created while the first list read was still in flight', async () => {
    seed('old');
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    db.beforeListResolves = () => held;
    window.history.replaceState(null, '', `/projects/${project.id}/conversations/old`);
    render(<Workbench />);

    db.beforeListResolves = null;
    fireEvent.click(newFromSidebar());
    await waitFor(() => expect(window.location.pathname).toContain('created-1'));
    await act(async () => { release(); });

    await expectSettledOn('created-1', 'chat.untitledConversation');
    expect(paneTranscript()).toBe('');
  });

  it('corrects the URL when it names a conversation that does not exist', async () => {
    seed('one', 'two');
    await openOn('one');

    act(() => { navigate({ kind: 'project', projectId: project.id, conversationId: 'deleted', fileName: null }); });

    await waitFor(() => expect(window.location.pathname).not.toContain('deleted'));
    const settled = paneConversation()!;
    await expectSettledOn(settled, `Session ${settled}`);
    expect(['one', 'two']).toContain(settled);
  });

  it('keeps a pending list read from replacing the conversation just followed', async () => {
    seed('old');
    await openOn('old');

    fireEvent.click(newFromSidebar());
    await expectSettledOn('created-1', 'chat.untitledConversation');
    // Every list read the switch caused has settled on the new conversation.
    expect(vi.mocked(listConversations).mock.calls.length).toBeGreaterThan(1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(paneConversation()).toBe('created-1');
  });
});

describe('a running turn in the other conversation', () => {
  /** The reattached stream of the turn `id` is still running when the view opens. */
  async function openOnRunningConversation(id: string): Promise<RunStream> {
    db.messages[id] = [
      userMessage(`${id}-user`, `first message of ${id}`),
      { id: `${id}-assistant`, role: 'assistant', content: 'still running', createdAt: 2, runId: 'run-live', runStatus: 'running' },
    ];
    await openOn(id);
    await waitFor(() => expect(screen.getByTestId('pane-streaming').textContent).toBe('streaming'));
    return vi.mocked(reattachDaemonRun).mock.calls.at(-1)![0] as unknown as RunStream;
  }

  it.each([
    ['the sidebar', () => fireEvent.click(newFromSidebar())],
    ['the pane', () => fireEvent.click(screen.getByRole('button', { name: 'pane:new' }))],
  ])('keeps running and stays out of a conversation created from %s', async (_source, create) => {
    seed('old');
    const stream = await openOnRunningConversation('old');

    create();

    await expectSettledOn('created-1', 'chat.untitledConversation');
    expect(paneTranscript()).toBe('');
    expect(screen.getByTestId('pane-streaming').textContent).toBe('idle');
    // Switching away only drops this view's listener: the abort that reaches the
    // daemon as a cancel request was never pulled.
    expect(stream.cancelSignal?.aborted).toBe(false);

    await act(async () => { stream.handlers.onDelta('late output of the old turn'); });
    expect(paneTranscript()).toBe('');
    expect(screen.getByTestId('pane-streaming').textContent).toBe('idle');
  });

  it('is picked up again when the sidebar returns to its conversation', async () => {
    seed('old');
    await openOnRunningConversation('old');
    const attachments = vi.mocked(reattachDaemonRun).mock.calls.length;

    fireEvent.click(newFromSidebar());
    await expectSettledOn('created-1', 'chat.untitledConversation');

    fireEvent.click(await screen.findByRole('button', { name: 'Session old' }));
    await expectSettledOn('old', 'Session old');
    expect(paneTranscript()).toContain('first message of old');
    await waitFor(() => expect(screen.getByTestId('pane-streaming').textContent).toBe('streaming'));
    expect(vi.mocked(reattachDaemonRun).mock.calls.length).toBe(attachments + 1);
  });

  it('keeps a turn just sent out of the conversation the sidebar opens next', async () => {
    seed('old');
    db.messages.old = [];
    await act(async () => {
      window.history.replaceState(null, '', `/projects/${project.id}/conversations/old`);
      render(<Workbench />);
    });
    await waitFor(() => expect(screen.getByTestId('pane-loading').textContent).toBe('ready'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'pane:send' })).toHaveProperty('disabled', false));

    fireEvent.click(screen.getByRole('button', { name: 'pane:send' }));
    await waitFor(() => expect(streamViaDaemon).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('pane-streaming').textContent).toBe('streaming'));
    const stream = vi.mocked(streamViaDaemon).mock.calls[0]![0] as unknown as RunStream;

    fireEvent.click(newFromSidebar());
    await expectSettledOn('created-1', 'chat.untitledConversation');
    expect(paneTranscript()).toBe('');
    expect(stream.cancelSignal?.aborted).toBe(false);

    await act(async () => { stream.handlers.onDelta('late output of the sent turn'); });
    expect(paneTranscript()).toBe('');
    expect(screen.getByTestId('pane-streaming').textContent).toBe('idle');
  });
});
