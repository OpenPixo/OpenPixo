// @vitest-environment jsdom
//
// A failure that only a fresh conversation can get past (the model service
// refused this conversation's request, or the context no longer fits) leads
// with New conversation. Retry sends the same conversation again, so it stays
// on the card but never leads.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { AppConfig, ChatMessage } from '../../src/types';

const translate = (key: string, vars?: Record<string, string | number>) => {
  if (vars && Object.keys(vars).length > 0) return `${key} ${Object.values(vars).join(' ')}`;
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function failedTurn(code: string, failureDetail?: string): ChatMessage {
  return {
    id: 'msg-failed',
    role: 'assistant',
    content: '',
    createdAt: 1,
    runStatus: 'failed',
    agentId: 'codex',
    events: [{ kind: 'status', label: 'error', detail: '{"detail":"Bad Request"}', code, ...(failureDetail ? { failureDetail } : {}) }],
  } as ChatMessage;
}

function renderChat(message: ChatMessage, extraProps: Partial<ComponentProps<typeof ChatPane>> = {}) {
  return render(
    <ChatPane
      messages={[message]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onRetry={vi.fn()}
      conversations={[{ projectId: 'project-1', id: 'conv-1', title: 'Current', createdAt: 1, updatedAt: 1 }]}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      config={{ agentId: 'codex', agentCliEnv: {} } as unknown as AppConfig}
      {...extraProps}
    />,
  );
}

const NEEDS_NEW_CONVERSATION = [
  ['a refused request', 'AGENT_EXECUTION_FAILED', 'request_rejected', 'chat.runError.title.requestRejected', 'chat.runError.requestRejectedMessage'],
  ['a context that no longer fits', 'AGENT_PROMPT_TOO_LARGE', undefined, 'chat.runError.title.promptTooLarge', 'chat.runError.promptTooLargeMessage'],
  ['a classified oversized prompt', 'AGENT_EXECUTION_FAILED', 'prompt_too_large', 'chat.runError.title.promptTooLarge', 'chat.runError.promptTooLargeMessage'],
] as const;

describe.each(NEEDS_NEW_CONVERSATION)('%s', (_name, code, detail, titleKey, messageKey) => {
  it('says why and leads with New conversation, keeping Retry second', () => {
    const onNewConversation = vi.fn();
    renderChat(failedTurn(code, detail), { onNewConversation });

    expect(screen.getByTestId('chat-run-error-card').textContent).toContain(titleKey);
    // The stand-in translator appends the copy's variables (the agent name).
    expect(screen.getByTestId('chat-run-error-description').textContent?.split(' ')[0]).toBe(messageKey);
    const fresh = screen.getByTestId('chat-error-new-conversation');
    expect(fresh.dataset.runErrorAction).toBe('primary');
    expect(fresh.textContent).toContain('chat.runError.newConversationCta');
    expect(screen.getByTestId('chat-error-retry').dataset.runErrorAction).toBe('secondary');

    fireEvent.click(fresh);
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  it('keeps Retry as the lead when the host cannot start a conversation', () => {
    renderChat(failedTurn(code, detail));
    expect(screen.queryByTestId('chat-error-new-conversation')).toBeNull();
    expect(screen.getByTestId('chat-error-retry').dataset.runErrorAction).toBe('primary');
  });
});

it('leaves a dropped connection on Retry', () => {
  renderChat(failedTurn('AGENT_EXECUTION_FAILED', 'stream_disconnected'), { onNewConversation: vi.fn() });
  expect(screen.queryByTestId('chat-error-new-conversation')).toBeNull();
  expect(screen.getByTestId('chat-error-retry').dataset.runErrorAction).toBe('primary');
});
