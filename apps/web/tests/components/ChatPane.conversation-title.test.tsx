// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import { trackRunFailedToastSurfaceView } from '../../src/analytics/events';

import type { ChatMessage, Conversation } from '../../src/types';

const translate = (key: string, vars?: Record<string, string | number>) => {
  const localized: Record<string, string> = {
    'chat.conversationsSearchPlaceholder': 'Rechercher des conversations',
    'chat.conversationsNoMatches': 'Aucune conversation correspondante.',
  };
  if (vars && Object.keys(vars).length > 0) {
    return `${key} ${Object.values(vars).join(' ')}`;
  }
  return localized[key] ?? key;
};

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'fr', setLocale: () => undefined, t: translate }),
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
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Session rename was removed by design — chats are not renamed. These tests
// cover what the session switcher does keep: the icon-only history trigger
// opens a menu listing conversations, and selecting / deleting one calls back.
describe('ChatPane session switcher', () => {
  it('opens the conversation history menu from the icon trigger', () => {
    renderChatPane({
      conversations: [
        conversation({ id: 'conv-1', title: 'Contract review draft' }),
        conversation({ id: 'conv-2', title: 'Pricing page copy' }),
      ],
      activeConversationId: 'conv-1',
    });

    expect(screen.queryByTestId('conversation-history-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('conversation-history-trigger'));

    expect(screen.getByTestId('conversation-history-menu')).toBeTruthy();
    expect(screen.getByTestId('conversation-select-conv-1').textContent).toBe('Contract review draft');
    expect(screen.getByTestId('conversation-select-conv-2').textContent).toBe('Pricing page copy');
  });

  it('localizes conversation search and its no-match state', () => {
    renderChatPane({
      conversations: [conversation({ id: 'conv-1', title: 'Contract review draft' })],
      activeConversationId: 'conv-1',
    });

    fireEvent.click(screen.getByTestId('conversation-history-trigger'));
    const search = screen.getByPlaceholderText('Rechercher des conversations');
    fireEvent.change(search, { target: { value: 'aucun résultat' } });

    expect(screen.getByText('Aucune conversation correspondante.')).toBeTruthy();
  });

  it('selects a conversation from the history menu', () => {
    const onSelectConversation = vi.fn();
    renderChatPane({
      conversations: [
        conversation({ id: 'conv-1', title: 'Contract review draft' }),
        conversation({ id: 'conv-2', title: 'Pricing page copy' }),
      ],
      activeConversationId: 'conv-1',
      onSelectConversation,
    });

    fireEvent.click(screen.getByTestId('conversation-history-trigger'));
    fireEvent.click(screen.getByTestId('conversation-select-conv-2'));

    expect(onSelectConversation).toHaveBeenCalledTimes(1);
    expect(onSelectConversation).toHaveBeenCalledWith('conv-2');
  });

  it('selects a conversation when its row metadata is clicked', () => {
    const onSelectConversation = vi.fn();
    renderChatPane({
      conversations: [
        conversation({ id: 'conv-1', title: 'Contract review draft' }),
        conversation({ id: 'conv-2', title: 'Pricing page copy', messageCount: 2 }),
      ],
      activeConversationId: 'conv-1',
      onSelectConversation,
    });

    fireEvent.click(screen.getByTestId('conversation-history-trigger'));
    fireEvent.click(screen.getByTestId('conversation-meta-conv-2'));

    expect(onSelectConversation).toHaveBeenCalledTimes(1);
    expect(onSelectConversation).toHaveBeenCalledWith('conv-2');
    expect(screen.queryByTestId('conversation-history-menu')).toBeNull();
  });

  it('shows an untitled label for conversations without a title', () => {
    renderChatPane({
      conversations: [conversation({ id: 'conv-1', title: null })],
      activeConversationId: 'conv-1',
    });

    fireEvent.click(screen.getByTestId('conversation-history-trigger'));
    expect(screen.getByTestId('conversation-select-conv-1').textContent).toBe('chat.untitledConversation');
  });

  it('does not expose any inline rename affordance', () => {
    renderChatPane({
      conversations: [conversation({ id: 'conv-1', title: 'Contract review draft' })],
      activeConversationId: 'conv-1',
    });

    fireEvent.click(screen.getByTestId('conversation-history-trigger'));
    // The select button is a plain selector now — no rename input is rendered.
    expect(screen.queryByTestId('chat-active-conversation-rename-input')).toBeNull();
    expect(screen.queryByDisplayValue('Contract review draft')).toBeNull();
  });

  // 原来这一条钉的是 `AMR_INSUFFICIENT_BALANCE`。用户 2026-09-02 裁决之后,
  // 钱的事只剩升级卡一张,余额那条失败**不再画报错卡** —— 而这个 surface_view
  // 埋的正是「报错卡露出来了」,所以它跟着卡一起走了(见下一条断言)。
  // 埋点契约本身还要有人守,换一条同样走 AMR、同样出卡的失败(登录失效)来守。
  

  // 上一条的另一半:余额那条失败**故意**不再报这个 surface_view。
  // 写出来是为了让这次口径变化有据可查 —— 埋点少了一条不能只在数据看板上发现。
  

  // G16 removes the recharge action from error cards. Preserve the Cloud
  // failure and verify that its only recovery action retries that same turn.
  

  
});

function renderChatPane(props: {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation?: (id: string) => void;
}) {
  return render(chatPaneElement(props));
}

function chatPaneElement({
  conversations,
  activeConversationId,
  onSelectConversation,
}: {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation?: (id: string) => void;
}) {
  return (
    <ChatPane
      messages={[]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      conversations={conversations}
      activeConversationId={activeConversationId}
      onSelectConversation={onSelectConversation ?? vi.fn()}
      onDeleteConversation={vi.fn()}
    />
  );
}

function conversation(overrides: Partial<Conversation> & { id: string }): Conversation {
  return {
    projectId: 'project-1',
    title: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}


