// @vitest-environment jsdom
//
// A send from Home must identify its caller to the daemon.
//
// REPRODUCTION (OpenPixo Beta 0.16.2-beta.147, macOS, team workspace): on
// Home, click the 「水面焦散」 example-prompt card — which seeds the composer with
// the 「WebGL 体验」 plugin chip, a 「水面焦散」 template chip and the plugin's
// description as the prompt — then press send. The send fails immediately with
//
//     daemon 401: {"error":{"code":"WORKSPACE_CONTEXT_REQUIRED","message":"workspace context is required"}}
//
// and `run_id: n/a`, because the refusal happens before the run is created.
//
// That string is produced in exactly one place in the repo — the `!createResp.ok`
// branch of the `POST /api/runs` create fetch in `providers/daemon.ts` — so the
// refused call is run creation, gated by `enforceWorkspaceResourceMutation
// ('project', …)` (apps/daemon/src/server.ts wires it via
// `createEnforceWorkspaceProjectMutation`).
//
// The cause is on this side of the wire. Home creates the project WITH the
// caller's workspace headers, so #6201 binds it to the team workspace; the
// follow-on auto-send then went out with NO headers, because it took its
// identity from the project's own workspace scope — an async read that is still
// in flight when the auto-send fires (its gate is `messagesInitialized` +
// `activeConversationId`, never the scope). Every OTHER project write in
// ProjectView (`patchProject`, `uploadProjectFiles`, the comment writes) already
// asserts the caller's own context; run creation was the one that did not.
//
// Nothing here is AMR-specific — the same null identity is passed on the
// CLI-agent and BYOK-OpenCode branches alike — but the report is an AMR run on a
// team workspace, and AMR is also where the second consequence shows up: the
// pre-run balance gate receives the same null and silently prices the run
// against the ACCOUNT wallet instead of the team's.

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { } from '@openpixo/contracts';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';




import { streamViaDaemon } from '../../src/providers/daemon';
import { useProjectFileEvents } from '../../src/providers/project-events';

import {
  createConversation,
  listConversations,
  listMessages,
  loadTabs,
  persistTabsToDaemonNow,
  ProjectMessageListError,
} from '../../src/state/projects';
import {
  fetchProjectFiles,
} from '../../src/providers/registry';
import type {
  AgentInfo,
  AppConfig,
  ChatMessage,
  Conversation,
  Project,
  SkillSummary,
} from '../../src/types';

const PROJECT_ID = 'caustic-pool-project';
/** The 「水面焦散」 card's seeded prompt. */
const SEED_PROMPT =
  '自包含 WebGL2 主视觉：由域扭曲涟漪织成的动态水面焦散；点击水面掉涟漪。无网格、无贴图。';


const chatPaneSpy = vi.hoisted(() => vi.fn());
const resourceContextObservations = vi.hoisted(
  () => [] as null[],
);
const projectCollabMocks = vi.hoisted(() => ({
  writerAuthority: 'allowed' as 'allowed' | 'denied' | 'pending',
  viewerOnly: false,
}));

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'zh-CN', setLocale: () => undefined, t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

vi.mock('../../src/router', () => ({ navigate: vi.fn() }));

vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));







vi.mock('../../src/providers/daemon', () => ({
  fetchChatRunStatus: vi.fn(),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
  listProjectRuns: vi.fn().mockResolvedValue([]),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: vi.fn(),
}));

// The balance gate is not what is under test; it must simply allow the send so
// the run POST is reached. Its ARGUMENT is asserted below.


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
    fetchPreviewComments: vi.fn().mockResolvedValue([]),
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
    createConversation: vi.fn(),
    listConversations: vi.fn(),
    listMessages: vi.fn(),
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
  APP_CHROME_FILE_ACTIONS_ID: 'test-file-actions',
}));
vi.mock('../../src/components/FileWorkspace', () => ({
  FileWorkspace: ({ onTabsStateChange }: {
    onTabsStateChange?: (state: { tabs: string[]; active: string | null }) => void;
  }) => <button data-testid="queue-tab-write" onClick={() => onTabsStateChange?.({
    tabs: ['index.html'], active: 'index.html',
  })}>queue tab write</button>,
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => <div data-testid="loader" />,
}));
vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: (props: {
    activeConversationId?: string | null;
    conversations?: Conversation[];
    loading?: boolean;
    messages?: ChatMessage[];
    messagesConversationId?: string | null;
    onDeleteComment?: (commentId: string) => void;
    onSelectConversation?: (conversationId: string) => void;
    sendDisabled?: boolean;
    queuedItems?: Array<{ prompt: string }>;
    onSend?: (
      prompt: string,
      attachments: [],
    ) => unknown;
  }) => {
    chatPaneSpy(props);
    return (
      <div>
        <div data-testid="active-conversation">{props.activeConversationId ?? ''}</div>
        <div data-testid="transcript">{props.messages?.map((message) => message.content).join('\n')}</div>
        <button
          type="button"
          data-testid="normal-send"
          disabled={props.sendDisabled}
          onClick={() => props.onSend?.('normal prompt', [],)}
        >
          send
        </button>
      </div>
    );
  },
}));

const mockedStreamViaDaemon = vi.mocked(streamViaDaemon);

const mockedListConversations = vi.mocked(listConversations);
const mockedCreateConversation = vi.mocked(createConversation);
const mockedListMessages = vi.mocked(listMessages);
const mockedLoadTabs = vi.mocked(loadTabs);
const mockedPersistTabsToDaemonNow = vi.mocked(persistTabsToDaemonNow);
const mockedFetchProjectFiles = vi.mocked(fetchProjectFiles);
const mockedUseProjectFileEvents = vi.mocked(useProjectFileEvents);

/** AMR on a daemon runtime — the reported configuration. */
const config: AppConfig = {
  mode: 'daemon',
  apiProtocol: 'openai',
  apiKey: '',
  baseUrl: '',
  model: 'deepseek-v4-flash',
  agentId: 'amr',
  skillId: null,
};

const conversation = (projectId: string): Conversation => ({
  id: `conv-${projectId}`,
  projectId,
  title: null,
  createdAt: 1,
  updatedAt: 1,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

/**
 * The project Home just created from the example card: bound to the team
 * workspace, carrying the seeded prompt and the applied plugin.
 */
const project = (): Project => ({
  id: PROJECT_ID,
  name: 'Caustic Pool',
  skillId: null,
  createdAt: 1,
  updatedAt: 1,
  pendingPrompt: SEED_PROMPT,
  metadata: { kind: 'prototype', pluginId: 'fixture-game-prototype' },
  // The daemon's read model of the project's single `workspace_projects` row,
  // carried on the project record itself (`Project.workspaceId`). Home created
  // this project in the caller's workspace, so it names that workspace.

} as Project);

/**
 * Answer the caller-identity read, and leave the PROJECT-scope read pending
 * forever. That is the window the auto-send fires in: `useProjectWorkspaceScope`
 * needs a round trip, while the auto-send gate only waits for the conversation
 * and message reads.
 */
function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (new URL(url, 'http://localhost').pathname.endsWith('/assets')) {
        return Response.json({ assets: [], nextCursor: null });
      }
      return new Response('{}', { status: 200 });
    }),
  );
}

function projectViewElement(overrides: Partial<ComponentProps<typeof ProjectView>> = {}) {
  return (
    <ProjectView
      project={project()}
      routeFileName={null}
      config={config}
      agents={[{
        id: 'amr',
        name: 'amr',
        available: true,
        models: [{
          id: 'deepseek-v4-flash',
          label: 'DeepSeek V4 Flash',
          default: true,
        }],
      }] as unknown as AgentInfo[]}
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
      {...overrides}
    />
  );
}

function renderProjectView(overrides: Partial<ComponentProps<typeof ProjectView>> = {}) {
  return render(projectViewElement(overrides));
}

describe('a Home auto-send identifies its caller before the project scope resolves', () => {
  beforeEach(() => {
    resourceContextObservations.length = 0;
    window.sessionStorage.clear();
    window.localStorage.clear();

    stubFetch();
    mockedListConversations.mockImplementation(async (projectId: string) => [
      conversation(projectId),
    ]);
    mockedCreateConversation.mockImplementation(async (projectId: string) =>
      conversation(projectId),
    );
    mockedListMessages.mockResolvedValue([]);
    mockedFetchProjectFiles.mockResolvedValue([]);
    mockedStreamViaDaemon.mockResolvedValue(undefined);



    projectCollabMocks.writerAuthority = 'allowed';
    projectCollabMocks.viewerOnly = false;
    mockedLoadTabs.mockResolvedValue({ tabs: [], active: null });
    // Home's hand-off: this flag is what makes ProjectView fire the seeded
    // prompt without a second click.
    window.sessionStorage.setItem(`pixo:auto-send-first:${PROJECT_ID}`, '1');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();

  });

  it('automatically reloads a transiently unavailable transcript without another user action', async () => {
    vi.useFakeTimers();
    const persisted: ChatMessage = {
      id: 'persisted-after-outage', role: 'assistant', content: 'Recovered conversation', createdAt: 1,
    };
    mockedListMessages.mockRejectedValueOnce(
      new ProjectMessageListError('Network unavailable', null, null, true),
    ).mockResolvedValue([persisted]);
    const view = renderProjectView({ project: { ...project(), pendingPrompt: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // A failed read must never become an empty, sendable conversation.
    expect(mockedListMessages).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('normal-send')).toBeDisabled();
    expect(mockedStreamViaDaemon).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(mockedListMessages).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(mockedListMessages).toHaveBeenCalledTimes(2);
    expect(view.getByTestId('transcript').textContent).toBe('Recovered conversation');
    expect(view.getByTestId('normal-send')).not.toBeDisabled();
    expect(chatPaneSpy.mock.calls.at(-1)?.[0].loading).toBe(false);
    expect(mockedStreamViaDaemon).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(mockedListMessages).toHaveBeenCalledTimes(2);
  });

  it('does not retry an authoritative transcript that loaded successfully', async () => {
    vi.useFakeTimers();
    const persisted: ChatMessage = {
      id: 'persisted-on-first-read', role: 'assistant', content: 'Existing conversation', createdAt: 1,
    };
    mockedListMessages.mockResolvedValue([persisted]);
    const view = renderProjectView({ project: { ...project(), pendingPrompt: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.getByTestId('transcript').textContent).toBe('Existing conversation');
    expect(view.getByTestId('normal-send')).not.toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(mockedListMessages).toHaveBeenCalledTimes(1);
  });

  it('stops automatically reloading after three transient transcript retries', async () => {
    vi.useFakeTimers();
    mockedListMessages.mockRejectedValue(
      new ProjectMessageListError('Network unavailable', null, null, true),
    );
    const view = renderProjectView({ project: { ...project(), pendingPrompt: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    for (const [delay, count] of [[500, 2], [1_000, 3], [2_000, 4]] as const) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
      expect(mockedListMessages).toHaveBeenCalledTimes(count);
    }
    expect(view.getByTestId('normal-send')).toBeDisabled();
    expect(chatPaneSpy.mock.calls.at(-1)?.[0].loading).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mockedListMessages).toHaveBeenCalledTimes(4);
    expect(mockedStreamViaDaemon).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])('does not automatically repeat an HTTP %i transcript refusal', async (status) => {
    vi.useFakeTimers();
    // Even a server's generic retryable bit cannot make unchanged credentials
    // or a missing conversation recover by replaying the same GET.
    mockedListMessages.mockRejectedValue(
      new ProjectMessageListError('Transcript refused', status, 'WORKSPACE_CONTEXT_REQUIRED', true),
    );
    const view = renderProjectView({ project: { ...project(), pendingPrompt: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.getByTestId('normal-send')).toBeDisabled();
    expect(chatPaneSpy.mock.calls.at(-1)?.[0].loading).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mockedListMessages).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending automatic transcript retry when the project unmounts', async () => {
    vi.useFakeTimers();
    mockedListMessages.mockRejectedValue(
      new ProjectMessageListError('Network unavailable', null, null, true),
    );
    const view = renderProjectView({ project: { ...project(), pendingPrompt: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockedListMessages).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mockedListMessages).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('settles a hung transcript read within the original budget (retry: %s)', async (retry) => {
    vi.useFakeTimers();
    mockedListMessages.mockReturnValue(new Promise(() => {}));
    if (retry) {
      mockedListMessages.mockRejectedValueOnce(
        new ProjectMessageListError('Network unavailable', null, null, true),
      );
    }
    const view = renderProjectView({ project: { ...project(), pendingPrompt: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(chatPaneSpy.mock.calls.at(-1)?.[0].loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(chatPaneSpy.mock.calls.at(-1)?.[0].loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(chatPaneSpy.mock.calls.at(-1)?.[0].loading).toBe(false);
    expect(view.getByTestId('normal-send')).toBeDisabled();
    expect(mockedListMessages).toHaveBeenCalledTimes(retry ? 2 : 1);
    expect(mockedListMessages.mock.calls.at(-1)?.[2]?.aborted).toBe(true);
    expect(mockedStreamViaDaemon).not.toHaveBeenCalled();
  });

  it('starts the pending Home send only once after automatic transcript recovery', async () => {
    vi.useFakeTimers();
    mockedListMessages.mockRejectedValueOnce(
      new ProjectMessageListError('Network unavailable', null, null, true),
    ).mockResolvedValue([]);
    renderProjectView();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockedListMessages).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(mockedStreamViaDaemon).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mockedStreamViaDaemon).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(mockedStreamViaDaemon).toHaveBeenCalledTimes(1);
  });

  it.each(['retry-delay', 'request'] as const)(
    'cancels a transcript %s on a conversation switch and ignores the old result',
    async (phase) => {
      vi.useFakeTimers();
      const oldRead = deferred<ChatMessage[]>();
      mockedListConversations.mockResolvedValue([
        conversation(PROJECT_ID),
        { ...conversation(PROJECT_ID), id: 'conv-second' },
      ]);
      mockedListMessages.mockImplementation(async (_projectId, conversationId) => {
        if (conversationId === 'conv-second') {
          return [{ id: 'second-message', role: 'assistant', content: 'Second conversation', createdAt: 2 }];
        }
        if (phase === 'retry-delay') {
          throw new ProjectMessageListError('Network unavailable', null, null, true);
        }
        return oldRead.promise;
      });
      const view = renderProjectView({ project: { ...project(), pendingPrompt: '' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const oldSignal = mockedListMessages.mock.calls[0]?.[2];
      expect(oldSignal?.aborted).toBe(false);

      await act(async () => {
        chatPaneSpy.mock.calls.at(-1)?.[0].onSelectConversation?.('conv-second');
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(oldSignal?.aborted).toBe(true);
      expect(view.getByTestId('transcript').textContent).toBe('Second conversation');
      await act(async () => {
        oldRead.resolve([{ id: 'stale', role: 'assistant', content: 'Stale result', createdAt: 1 }]);
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(view.getByTestId('transcript').textContent).toBe('Second conversation');
      expect(mockedListMessages).toHaveBeenCalledTimes(2);
    },
  );



  it('reuses one Home handoff identity across ProjectView remounts', async () => {
    const firstView = renderProjectView();
    await waitFor(() => expect(mockedStreamViaDaemon).toHaveBeenCalledTimes(1));
    const firstRun = mockedStreamViaDaemon.mock.calls[0]?.[0];
    firstView.unmount();

    window.sessionStorage.setItem(`pixo:auto-send-first:${PROJECT_ID}`, '1');
    renderProjectView();
    await waitFor(() => expect(mockedStreamViaDaemon).toHaveBeenCalledTimes(2));
    const replayedRun = mockedStreamViaDaemon.mock.calls[1]?.[0];

    expect({
      clientRequestId: replayedRun?.clientRequestId,
      userMessageId: replayedRun?.userMessageId,
      assistantMessageId: replayedRun?.assistantMessageId,
    }).toEqual({
      clientRequestId: firstRun?.clientRequestId,
      userMessageId: firstRun?.userMessageId,
      assistantMessageId: firstRun?.assistantMessageId,
    });
    expect(firstRun?.clientRequestId).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(firstRun?.userMessageId).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(firstRun?.assistantMessageId).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('keeps Home handoff identities within the daemon limit for a maximum-length project id', async () => {
    const maximumLengthProjectId = 'p'.repeat(128);
    window.sessionStorage.setItem(`pixo:auto-send-first:${maximumLengthProjectId}`, '1');

    renderProjectView({
      project: {
        ...project(),
        id: maximumLengthProjectId,
      },
    });

    await waitFor(() => expect(mockedStreamViaDaemon).toHaveBeenCalledTimes(1));
    const run = mockedStreamViaDaemon.mock.calls[0]?.[0];
    const ids = [run?.clientRequestId, run?.userMessageId, run?.assistantMessageId];

    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(id?.length).toBeLessThanOrEqual(128);
    }
  });
});

describe('a Home auto-send observes a project billing scope that settles after mount', () => {
  beforeEach(() => {
    resourceContextObservations.length = 0;
    window.sessionStorage.clear();
    window.localStorage.clear();

    mockedListConversations.mockImplementation(async (projectId: string) => [
      conversation(projectId),
    ]);
    mockedCreateConversation.mockImplementation(async (projectId: string) =>
      conversation(projectId),
    );
    mockedListMessages.mockResolvedValue([]);



    projectCollabMocks.writerAuthority = 'allowed';
    projectCollabMocks.viewerOnly = false;
    mockedLoadTabs.mockResolvedValue({ tabs: [], active: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();

  });















  it('preserves Personal project daemon tab persistence', async () => {
    window.sessionStorage.removeItem(`pixo:auto-send-first:${PROJECT_ID}`);
    projectCollabMocks.writerAuthority = 'denied';


    const view = renderProjectView({
      project: {
        ...project(),
        pendingPrompt: '',

      },
    });
    await waitFor(() => expect(mockedLoadTabs).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    fireEvent.click(view.getByTestId('queue-tab-write'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(mockedPersistTabsToDaemonNow).toHaveBeenCalledTimes(1);

  });

  it('preserves anonymous unbound project daemon tab persistence', async () => {
    window.sessionStorage.removeItem(`pixo:auto-send-first:${PROJECT_ID}`);
    projectCollabMocks.writerAuthority = 'pending';


    const view = renderProjectView({
      project: {
        ...project(),
        pendingPrompt: '',

      },
    });
    await waitFor(() => expect(mockedLoadTabs).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    fireEvent.click(view.getByTestId('queue-tab-write'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(mockedPersistTabsToDaemonNow).toHaveBeenCalledTimes(1);

  });







  it('keeps anonymous unbound project SSE enabled', async () => {
    window.sessionStorage.removeItem(`pixo:auto-send-first:${PROJECT_ID}`);



    renderProjectView({
      project: {
        ...project(),
        pendingPrompt: '',

      },
    });
    await waitFor(() => expect(mockedUseProjectFileEvents).toHaveBeenCalled());
    expect(mockedUseProjectFileEvents.mock.calls.at(-1)?.[1]).toBe(true);
  });
});
