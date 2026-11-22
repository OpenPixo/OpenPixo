// @vitest-environment jsdom
//
// 红测(OPEND-2602 · 接线那一半):**「引导对话」按下去走的是「中断 + 立即发送」。**
//
// `tests/components/chat/w117-queue-steer-interrupt.test.tsx` 断言的是这颗按钮
// 长什么样;这一页断言的是它接在哪条路上,以及**它什么时候出现**。
//
// 两件必须同时成立的事:
//
//   1. **对 `promptInputFormat` 不是 `stream-json` 的 agent 也出现。**
//      原来这颗由 `agentSupportsMidTurnSteering` 把关 —— 27 个 runtime 里只有
//      `claude` / `codebuddy` 过得了那道关,其余 25 个连按钮都没有。中断对所有
//      agent 都成立,所以那道关整个作废。这一页用 `codex`(`text`)当样本。
//
//      2026-09-08 产品又把最后一道 `canSteerCurrentTurn`(此刻有没有一轮可中断)
//      也裁掉了 —— 「引导对话就是原本的立即发送,只不过换了个名字跟 codex 对齐」。
//      两边喂的本来就是同一个 `sendQueuedChatSendNow`,所以现在 ProjectView 只
//      交出一个 `onSendQueuedNow`,按钮永远在。
//
//   2. **点下去是 `handleStop()` + 重排队列,不是往 stdin 写字。**
//      证据钉在真实副作用上,不是「某个函数被调了」:在跑那一轮的 `cancelSignal`
//      真的被 abort,而且队列里那条真的作为**第二次** `streamViaDaemon` 发了出去;
//      同时 `steerChatRun` 一次都没被调用。
//
// C18(2026-11-21)之后:这条「中断 + 立即发送」路的名字是「停止并发送」,停的时候
// 带 `queued_send` 理由;只有 daemon 说这个 agent 接得住中途消息
// (`AgentInfo.midTurnSteering`,app-server 上的 Codex)时,才另给一条真正的引导路
// (`onSteerQueuedSend` → `steerChatRun`),那条不停、不重发。
//
// `ChatPane` 在这一层是 mock 的(它自带半个应用),所以这里操作的是
// **ProjectView 交给 ChatPane 的那几个 prop**;两段靠同一个 prop 名接在一起。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';

import { steerChatRun, streamViaDaemon } from '../../src/providers/daemon';
import {
  createConversation,
  listConversations,
  listMessages,
  loadTabs,
} from '../../src/state/projects';
import { fetchProjectFiles } from '../../src/providers/registry';
import type {
  AgentInfo,
  AppConfig,
  ChatMessage,
  Conversation,
  Project,
  SkillSummary,
} from '../../src/types';

const PROJECT_ID = 'steer-interrupt-project';
const FIRST_PROMPT = '先把首屏排出来';
const QUEUED_PROMPT = '顺手把 CTA 换成深色';

const chatPaneSpy = vi.hoisted(() => vi.fn());


vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

vi.mock('../../src/router', () => ({ navigate: vi.fn() }));

vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));

vi.mock('../../src/providers/daemon', () => ({
  GENERIC_DAEMON_DISCONNECT_CODE: 'DAEMON_STREAM_DISCONNECTED',
  GENERIC_DAEMON_DISCONNECT_MESSAGE: 'daemon stream disconnected before run completed',
  QUEUED_SEND_CANCEL_REASON: 'queued_send',
  fetchChatRunStatus: vi.fn(),
  listActiveChatRuns: vi.fn().mockResolvedValue([]),
  listProjectRuns: vi.fn().mockResolvedValue([]),
  publishDaemonRunFinishedEvent: vi.fn(),
  reattachDaemonRun: vi.fn(),
  streamViaDaemon: vi.fn(),
  // 这一页最要紧的一条断言就是「它一次都没被调用」,所以它必须在 mock 里存在,
  // 否则 ProjectView 连模块都导不进来,断言会赢在「根本没跑起来」上。
  steerChatRun: vi.fn(),
  fetchAmrWalletSnapshot: vi.fn().mockResolvedValue(null),
}));



vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/hooks/useDesignMdState', () => ({
  useDesignMdState: () => ({
    exists: false,
    generatedAt: null,
    transcriptMessageCount: null,
    currentArtifact: null,
    isStale: false,
    staleReason: null,
    loading: false,
    error: null,
    refresh: async () => {},
  }),
  computeStale: () => ({ isStale: false, staleReason: null }),
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
}));
vi.mock('../../src/components/FileWorkspace', () => ({
  FileWorkspace: () => <div data-testid="file-workspace" />,
}));
vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => <div data-testid="loader" />,
}));

type MockChatPaneProps = {
  activeConversationId?: string | null;
  messages?: ChatMessage[];
  streaming?: boolean;
  sendDisabled?: boolean;
  queuedItems?: Array<{ id: string; prompt: string }>;
  onSend?: (prompt: string, attachments: [],) => unknown;
  onSendQueuedNow?: (id: string) => void;
  onSteerQueuedSend?: (id: string) => void;
  queuedMidTurnSteering?: boolean;
  queuedTurnInFlight?: boolean;
};

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: (props: MockChatPaneProps) => {
    chatPaneSpy(props);
    const first = props.queuedItems?.[0];
    return (
      <div>
        <div data-testid="active-conversation">{props.activeConversationId ?? ''}</div>
        <div data-testid="queued-count">{String(props.queuedItems?.length ?? 0)}</div>
        {/* 「引导对话」那一颗按不按得动,完全由这个 prop 有没有值决定
            (`QueuedSendStrip` 里就是 `disabled={!onSendNow}`)。 */}
        <div data-testid="steer-offered">{props.onSendQueuedNow ? 'yes' : 'no'}</div>
        <button
          type="button"
          data-testid="normal-send"
          disabled={props.sendDisabled}
          onClick={() => props.onSend?.(FIRST_PROMPT, [],)}
        >
          send
        </button>
        <button
          type="button"
          data-testid="queue-send"
          onClick={() => props.onSend?.(QUEUED_PROMPT, [],)}
        >
          queue
        </button>
        <button
          type="button"
          data-testid="steer-click"
          disabled={!first || !props.onSendQueuedNow}
          onClick={() => first && props.onSendQueuedNow?.(first.id)}
        >
          steer
        </button>
        <div data-testid="mid-turn-steering">{props.queuedMidTurnSteering ? 'yes' : 'no'}</div>
        <button
          type="button"
          data-testid="real-steer-click"
          disabled={!first || !props.onSteerQueuedSend}
          onClick={() => first && props.onSteerQueuedSend?.(first.id)}
        >
          real steer
        </button>
      </div>
    );
  },
}));

const mockedStreamViaDaemon = vi.mocked(streamViaDaemon);
const mockedSteerChatRun = vi.mocked(steerChatRun);
const mockedListConversations = vi.mocked(listConversations);
const mockedCreateConversation = vi.mocked(createConversation);
const mockedListMessages = vi.mocked(listMessages);
const mockedLoadTabs = vi.mocked(loadTabs);
const mockedFetchProjectFiles = vi.mocked(fetchProjectFiles);

/**
 * `codex` as the daemon lists it when its transport cannot steer (exec --json,
 * or an older daemon that does not say): stop-and-send is the only way.
 */
const CODEX: AgentInfo = {
  id: 'codex',
  name: 'Codex',
  available: true,
  promptInputFormat: 'text',
} as AgentInfo;

/** `codex` over app-server: the daemon says its running turn takes a message (`turn/steer`). */
const CODEX_STEERS: AgentInfo = { ...CODEX, midTurnSteering: true } as AgentInfo;

/**
 * `claude` keeps stdin open (`stream-json`) but the daemon does not list it as
 * steerable: a mid-turn frame is not acted on. An open stdin must not light up
 * 「引导对话」.
 */
const CLAUDE: AgentInfo = {
  id: 'claude',
  name: 'Claude',
  available: true,
  promptInputFormat: 'stream-json',
} as AgentInfo;

const config: AppConfig = {
  mode: 'daemon',
  apiProtocol: 'openai',
  apiKey: '',
  baseUrl: '',
  model: '',
  agentId: 'codex',
  skillId: null,
};

const project = (): Project => ({
  id: PROJECT_ID,
  name: 'Steer Interrupt',
  skillId: null,
  createdAt: 1,
  updatedAt: 1,
  metadata: { kind: 'prototype' },
} as Project);

const conversation = (projectId: string): Conversation => ({
  id: `conv-${projectId}`,
  projectId,
  title: null,
  createdAt: 1,
  updatedAt: 1,
});

function renderProjectView(overrides: Partial<ComponentProps<typeof ProjectView>> = {}) {
  return render(
    <ProjectView
      project={project()}
      routeFileName={null}
      config={config}
      agents={[CODEX]}
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
    />,
  );
}

type DaemonRunOptions = {
  history?: Array<{ role: string; content: string }>;
  cancelSignal?: AbortSignal;
  onRunCreated?: (runId: string) => void;
  handlers: Record<string, unknown>;
};

const startedRuns: DaemonRunOptions[] = [];

/** 每一轮都起来就挂住 —— 只有挂住,会话才停在 busy 上等我们点那颗按钮。 */
function hangEveryRun() {
  mockedStreamViaDaemon.mockImplementation((options: unknown) => {
    const opts = options as DaemonRunOptions;
    startedRuns.push(opts);
    opts.onRunCreated?.(`run-${startedRuns.length}`);
    return new Promise<never>(() => {});
  });
}

function lastChatPaneProps(): MockChatPaneProps {
  return chatPaneSpy.mock.calls.at(-1)?.[0] as MockChatPaneProps;
}

describe('OPEND-2602:队列里的「引导对话」按下去中断当前运行', () => {
  beforeEach(() => {
    startedRuns.length = 0;
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    mockedListConversations.mockImplementation(async (projectId: string) => [
      conversation(projectId),
    ]);
    mockedCreateConversation.mockImplementation(async (projectId: string) =>
      conversation(projectId),
    );
    mockedListMessages.mockResolvedValue([]);
    mockedFetchProjectFiles.mockResolvedValue([]);
    mockedLoadTabs.mockResolvedValue({ tabs: [], active: null });

    hangEveryRun();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /** 起一轮并挂住,然后排一条队 —— 这一页每条用例的起手式。 */
  async function startRunAndQueueOne(agent: AgentInfo = CODEX) {
    renderProjectView({
      agents: [agent],
      config: { ...config, agentId: agent.id },
    });
    await screen.findByTestId('normal-send');
    await waitFor(() =>
      expect((screen.getByTestId('normal-send') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('normal-send'));
    await waitFor(() => expect(startedRuns).toHaveLength(1));
    // 队列只在会话 busy 的时候才收得下 —— 这正是产品说的那个场景。
    fireEvent.click(screen.getByTestId('queue-send'));
    await waitFor(() => expect(screen.getByTestId('queued-count').textContent).toBe('1'));
  }

  // 两头都钉:25 个中途不读 stdin 的 runtime 里挑 codex,原来唯二过得了旧关卡的
  // 挑 claude。旧实现下前者是红的、后者是绿的 —— 只钉一头照不出「判据接反了」。
  it.each([
    ['codex(promptInputFormat: text)', CODEX],
    ['claude(promptInputFormat: stream-json)', CLAUDE],
  ])('%s 都给出停止并发送,而且都不算「接得住中途消息」', async (_name, agent) => {
    await startRunAndQueueOne(agent as AgentInfo);
    expect(screen.getByTestId('steer-offered').textContent).toBe('yes');
    expect(typeof lastChatPaneProps().onSendQueuedNow).toBe('function');
    // C18: the face comes from the daemon's answer, not from stdin format.
    expect(screen.getByTestId('mid-turn-steering').textContent).toBe('no');
    expect(lastChatPaneProps().queuedTurnInFlight).toBe(true);
  });

  it('daemon 说接得住时:引导对话把这条放进在跑的那一轮,不停、不重发', async () => {
    mockedSteerChatRun.mockResolvedValue({ ok: true, messageId: 'steered-user-1' });
    await startRunAndQueueOne(CODEX_STEERS);
    await waitFor(() => expect(screen.getByTestId('mid-turn-steering').textContent).toBe('yes'));

    const running = startedRuns[0]!;
    fireEvent.click(screen.getByTestId('real-steer-click'));

    await waitFor(() => expect(mockedSteerChatRun).toHaveBeenCalledWith({ runId: 'run-1', text: QUEUED_PROMPT }));
    await waitFor(() => expect(screen.getByTestId('queued-count').textContent).toBe('0'));
    // The running turn keeps going: not cancelled, no second run.
    expect(running.cancelSignal?.aborted).toBe(false);
    expect(startedRuns).toHaveLength(1);
    // What the user said is in the transcript right away.
    await waitFor(() => expect(lastChatPaneProps().messages?.some(
      (message) => message.id === 'steered-user-1' && message.role === 'user' && message.content === QUEUED_PROMPT,
    )).toBe(true));
  });

  it('点下去:在跑的那一轮被中断,队列里这条立刻作为新一轮发出去', async () => {
    await startRunAndQueueOne();

    const interrupted = startedRuns[0]!;
    expect(interrupted.cancelSignal?.aborted).toBe(false);

    fireEvent.click(screen.getByTestId('steer-click'));

    // 一、在跑的那一轮真的被掐掉(不是「按钮变灰了」这种表面证据)。
    await waitFor(() => expect(interrupted.cancelSignal?.aborted).toBe(true));
    // …and the stop says why, so the turn reads 「已中断」 for the new message
    // instead of 「按你的操作停止」 (C18).
    expect(interrupted.cancelSignal?.reason).toBe('queued_send');

    // 二、队列里那条真的作为**第二轮**发了出去,而且带的是它自己的话。
    await waitFor(() => expect(startedRuns).toHaveLength(2));
    const resent = startedRuns[1]!;
    const lastUser = [...(resent.history ?? [])].reverse().find((m) => m.role === 'user');
    expect(lastUser?.content).toContain(QUEUED_PROMPT);

    // 三、队列被清空 —— 这条已经在跑了,不能还排在队里等第二次。
    await waitFor(() => expect(screen.getByTestId('queued-count').textContent).toBe('0'));

    // 四、一个字都没往 stdin 里写。
    expect(mockedSteerChatRun).not.toHaveBeenCalled();
  });

  // ——— 对照:一轮都没在跑的时候 ———

  it('一轮都没在跑时这颗也照给 —— 那道可见性的门 2026-09-08 撤了', async () => {
    renderProjectView();
    await screen.findByTestId('normal-send');
    await waitFor(() =>
      expect((screen.getByTestId('normal-send') as HTMLButtonElement).disabled).toBe(false),
    );
    // 等一拍,让任何异步落定 —— 这一格量的是稳态,不能只赢在时序上。
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 前提先钉住:确实一轮都没在跑。旧实现在这一格是 `no`,门就挂在这里。
    expect(startedRuns).toHaveLength(0);
    expect(screen.getByTestId('steer-offered').textContent).toBe('yes');
    // 交出去的仍是同一个函数,它自己按 busy 分支;没在跑就是直接发。
    expect(typeof lastChatPaneProps().onSendQueuedNow).toBe('function');
  });
});
