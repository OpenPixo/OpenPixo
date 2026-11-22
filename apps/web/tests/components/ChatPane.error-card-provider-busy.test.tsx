// @vitest-environment jsdom
//
// C19 · 模型服务商繁忙(`provider_high_demand`)有自己的一张卡。
//
// 真机:Codex(gpt-6.1-sol)干了约 20 分钟、写了 35 个文件后,上游回了
// 「high demand」,daemon 自动重试一次也没接上,这一轮 `resumable: true`。卡上只有
// 「模型服务暂不可用 / 当前模型暂不可用，请稍后再试，或更换模型。」外加〔联系我们〕
// —— 读起来像模型或账号坏了、该去找客服,而实际情况是「服务商这会儿忙,活都在,
// 过一分钟接着做」。
//
// 这张卡要说的是后者:标题与正文是自己的一对键,主按钮是接着做(能续就续,
// 不能续就重试),〔联系我们〕不在这张卡上。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { AppConfig, ChatMessage } from '../../src/types';

const translate = (key: string, vars?: Record<string, string | number>) => {
  if (vars && Object.keys(vars).length > 0) {
    return `${key} ${Object.values(vars).join(' ')}`;
  }
  return key;
};

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: translate }),
  useT: () => translate,
}));

vi.mock('../../src/components/AssistantMessage', () => ({
  AssistantMessage: ({ message }: { message: ChatMessage }) => (
    <div data-testid={`assistant-${message.id}`}>{message.content}</div>
  ),
}));

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

vi.mock('../../src/analytics/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/events')>();
  return {
    ...actual,
    trackChatPanelClick: vi.fn(),
    trackRunFailedToastSurfaceView: vi.fn(),
    trackRunRecoveryActionClick: vi.fn(),
    trackRunRecoveryActionSurfaceView: vi.fn(),
  };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** The upstream sentence Codex surfaces for this detail (shape, not a recording). */
const RAW_HIGH_DEMAND =
  'We are currently experiencing high demand, which may cause temporary errors.';

function busyFailedMessage(opts: { resumable: boolean; failureDetail?: string }): ChatMessage {
  return {
    id: 'msg-busy',
    role: 'assistant',
    content: 'Wrote 35 files before the provider stopped answering.',
    createdAt: 1,
    runId: 'run-busy',
    runStatus: 'failed',
    agentId: 'codex',
    ...(opts.resumable ? { resumable: true } : {}),
    events: [
      {
        kind: 'status',
        label: 'error',
        detail: RAW_HIGH_DEMAND,
        code: 'AGENT_EXECUTION_FAILED',
        failureCategory: 'upstream_unavailable',
        failureDetail: opts.failureDetail ?? 'provider_high_demand',
        failureAction: 'retry',
        retryable: true,
      },
    ],
  } as unknown as ChatMessage;
}

function renderChat(
  message: ChatMessage,
  handlers: { onRetry?: (m: ChatMessage) => void; onResumeRun?: (m: ChatMessage) => void } = {},
) {
  return render(
    <ChatPane
      messages={[message]}
      streaming={false}
      error={RAW_HIGH_DEMAND}
      errorSourceAssistantId="msg-busy"
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onRetry={handlers.onRetry ?? vi.fn()}
      onResumeRun={handlers.onResumeRun}
      conversations={[
        { projectId: 'project-1', id: 'conv-1', title: 'Current', createdAt: 1, updatedAt: 1 },
      ]}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      config={{ agentId: 'codex', agentCliEnv: {} } as unknown as AppConfig}
    />,
  );
}

const cardOf = (container: HTMLElement) =>
  container.querySelector('[data-user-action-card="run-recovery"]');

describe('C19 · 模型服务商繁忙', () => {
  it('说「服务商忙,活还在」,不说「模型不可用」', () => {
    const { container } = renderChat(busyFailedMessage({ resumable: true }), { onResumeRun: vi.fn() });
    const card = cardOf(container)!;
    expect(card).toBeTruthy();
    expect(card.firstElementChild!.textContent).toContain('chat.runError.title.providerBusy');
    const description = card.querySelector('[data-testid="chat-run-error-description"]')!;
    expect(description.textContent).toContain('chat.runError.providerBusyMessage');
    expect(card.textContent).not.toContain('chat.runError.title.upstreamUnavailable');
    expect(description.textContent).not.toContain('high demand');
  });

  it('能续的一轮:主按钮是〔继续运行〕,点了接着原会话做,不从头重跑', () => {
    const onResumeRun = vi.fn();
    const onRetry = vi.fn();
    const { container } = renderChat(busyFailedMessage({ resumable: true }), { onResumeRun, onRetry });
    const card = cardOf(container)!;
    const resume = screen.getByTestId('chat-error-resume');
    expect(resume.textContent).toContain('chat.resumeRunCta');
    expect(resume.getAttribute('data-run-error-action')).toBe('primary');
    expect(card.querySelector('[data-testid="chat-error-retry"]')).toBeNull();
    fireEvent.click(resume);
    expect(onResumeRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-busy' }));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('续不了的一轮:主按钮是〔重试〕', () => {
    const onRetry = vi.fn();
    const { container } = renderChat(busyFailedMessage({ resumable: false }), {
      onRetry,
      onResumeRun: vi.fn(),
    });
    const card = cardOf(container)!;
    expect(card.querySelector('[data-testid="chat-error-resume"]')).toBeNull();
    const retry = card.querySelector('[data-testid="chat-error-retry"]')!;
    expect(retry.getAttribute('data-run-error-action')).toBe('primary');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-busy' }), 'manual_retry');
  });

  it('宿主接不住续跑时退回〔重试〕,不静默发一句继续', () => {
    const { container } = renderChat(busyFailedMessage({ resumable: true }));
    const card = cardOf(container)!;
    expect(card.querySelector('[data-testid="chat-error-resume"]')).toBeNull();
    expect(card.querySelector('[data-testid="chat-error-retry"]')).toBeTruthy();
  });

  it('这张卡上不放〔联系我们〕', () => {
    const { container } = renderChat(busyFailedMessage({ resumable: true }), { onResumeRun: vi.fn() });
    expect(cardOf(container)!.querySelector('[data-testid="chat-error-contact-support"]')).toBeNull();
  });

  it('别的上游故障照旧:通用「服务不可用」卡,仍有〔联系我们〕,能续也不出〔继续运行〕', () => {
    const { container } = renderChat(
      busyFailedMessage({ resumable: true, failureDetail: 'upstream_5xx' }),
      { onResumeRun: vi.fn() },
    );
    const card = cardOf(container)!;
    expect(card.firstElementChild!.textContent).toContain('chat.runError.title.upstreamUnavailable');
    expect(card.querySelector('[data-testid="chat-error-contact-support"]')).toBeTruthy();
    expect(card.querySelector('[data-testid="chat-error-resume"]')).toBeNull();
    expect(card.querySelector('[data-testid="chat-error-retry"]')).toBeTruthy();
  });
});
