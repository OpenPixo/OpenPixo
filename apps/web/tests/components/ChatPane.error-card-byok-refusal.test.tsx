// @vitest-environment jsdom
//
// A BYOK send the browser refuses before any run exists names what is missing
// and how to fix it, and its card leads with the way to fix it. Retrying before
// the fix is a guaranteed repeat, so it must not be what the card leads with.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import type { ComponentProps } from 'react';
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The copy the refusal was written with. It stands in for whatever is on the
// persisted event, which the card must never read back out.
const REFUSAL_DETAIL = 'detail text persisted on the failure event';

function refusedTurn(code: string, failureDetail?: string): ChatMessage {
  return {
    id: 'msg-refused',
    role: 'assistant',
    content: '',
    createdAt: 1,
    runStatus: 'failed',
    agentId: 'byok-opencode',
    events: [
      {
        kind: 'status',
        label: 'error',
        detail: REFUSAL_DETAIL,
        code,
        ...(failureDetail ? { failureDetail } : {}),
      },
    ],
  } as ChatMessage;
}

function renderChat(
  message: ChatMessage,
  extraProps: Partial<ComponentProps<typeof ChatPane>> = {},
) {
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
      conversations={[
        { projectId: 'project-1', id: 'conv-1', title: 'Current', createdAt: 1, updatedAt: 1 },
      ]}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      config={{ agentId: 'byok-opencode', agentCliEnv: {} } as unknown as AppConfig}
      {...extraProps}
    />,
  );
}

function footerActionIds(container: HTMLElement): Array<string | null> {
  const footer = container.querySelector('[data-user-action-footer="true"]');
  return Array.from(footer?.querySelectorAll('button') ?? []).map((button) =>
    button.getAttribute('data-testid'),
  );
}

const REFUSALS = [
  ['BYOK_OPENCODE_UNAVAILABLE', 'OpenCode', 'chat.runError.byokOpencodeUnavailableMessage'],
  ['BYOK_CODEX_UNAVAILABLE', 'Codex', 'chat.runError.byokCodexUnavailableMessage'],
] as const;

describe.each(REFUSALS)('BYOK refusal %s', (code, runtime, messageKey) => {
  it('names the missing runtime and how to fix it, not the retry fallback', () => {
    renderChat(refusedTurn(code), { onOpenSettings: vi.fn() });

    const card = screen.getByTestId('chat-run-error-card');
    expect(card.textContent).toContain(`chat.runError.title.cliMissing ${runtime}`);
    expect(screen.getByTestId('chat-run-error-description').textContent).toBe(
      `${messageKey} ${runtime}`,
    );
    expect(card.textContent).not.toContain('chat.runError.fallbackMessage');
    expect(card.textContent).not.toContain(REFUSAL_DETAIL);
  });

  it('keeps the same words while the pane slot still holds the run error', () => {
    renderChat(refusedTurn(code), {
      onOpenSettings: vi.fn(),
      error: REFUSAL_DETAIL,
      errorSourceAssistantId: 'msg-refused',
    });

    expect(screen.getByTestId('chat-run-error-description').textContent).toBe(
      `${messageKey} ${runtime}`,
    );
  });

  it('leads with Open settings and keeps Retry for after the fix', () => {
    const onOpenSettings = vi.fn();
    const { container } = renderChat(refusedTurn(code), { onOpenSettings });

    const settings = screen.getByTestId('chat-error-open-settings');
    expect(settings.dataset.runErrorAction).toBe('primary');
    expect(settings.textContent).toContain('chat.runError.openSettingsCta');
    expect(screen.getByTestId('chat-error-retry').dataset.runErrorAction).toBe('secondary');
    // The row reads secondary actions first and the primary last.
    expect(footerActionIds(container).at(-1)).toBe('chat-error-open-settings');

    fireEvent.click(settings);
    expect(onOpenSettings).toHaveBeenCalledWith('execution');
  });

  it('keeps Retry as the lead when the host cannot open Settings', () => {
    renderChat(refusedTurn(code));

    expect(screen.queryByTestId('chat-error-open-settings')).toBeNull();
    expect(screen.getByTestId('chat-error-retry').dataset.runErrorAction).toBe('primary');
  });
});

describe('the rest of the failure card family', () => {
  it('leaves other Settings-fixable failures on their fixed action row', () => {
    renderChat(refusedTurn('AGENT_EXECUTION_FAILED', 'invalid_api_key'), {
      onOpenSettings: vi.fn(),
    });

    expect(screen.queryByTestId('chat-error-open-settings')).toBeNull();
    expect(screen.getByTestId('chat-error-retry').dataset.runErrorAction).toBe('primary');
  });

  it('still refuses to render run text the mapping table does not claim', () => {
    renderChat(refusedTurn('SOME_UNMAPPED_CODE'), {
      onOpenSettings: vi.fn(),
      error: REFUSAL_DETAIL,
      errorSourceAssistantId: 'msg-refused',
    });

    expect(screen.getByTestId('chat-run-error-description').textContent).toBe(
      'chat.runError.fallbackMessage',
    );
  });
});
