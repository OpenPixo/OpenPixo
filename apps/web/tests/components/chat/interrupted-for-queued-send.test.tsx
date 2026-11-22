// @vitest-environment jsdom
/**
 * C18: a turn the user stopped to send a queued message is not "stopped at
 * your request". Its footer says it was interrupted to send the new message.
 * A plain Stop keeps its own wording.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AssistantMessage } from '../../../src/components/AssistantMessage';
import { en } from '../../../src/i18n/locales/en';
import type { ChatMessage } from '../../../src/types';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => store.delete(k),
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
});

afterEach(cleanup);

function canceledTurn(cancelOrigin: ChatMessage['cancelOrigin']): ChatMessage {
  return {
    id: 'm-1',
    role: 'assistant',
    content: 'Half of the effects are in.',
    startedAt: 1700000000,
    endedAt: 1700000042,
    createdAt: 1700000042,
    events: [] as ChatMessage['events'],
    producedFiles: [],
    runStatus: 'canceled',
    cancelOrigin,
  } as ChatMessage;
}

function renderTurn(message: ChatMessage) {
  return render(
    <AssistantMessage
      message={message}
      streaming={false}
      isLast
      projectId="p1"
      errorCardOwnerId={null}
      onFeedback={vi.fn()}
      onForkFromMessage={vi.fn()}
    />,
  );
}

describe('a turn interrupted to send a queued message', () => {
  it('says it was interrupted for the new message, not stopped at your request', () => {
    renderTurn(canceledTurn('queued_send'));
    expect(screen.getByTestId('assistant-label').textContent).toContain(en['assistant.interruptedForQueuedLabel']);
    const detail = screen.getByTestId('assistant-label-detail').textContent ?? '';
    expect(detail).toBe(en['assistant.interruptedForQueuedDetail']);
    expect(detail).not.toBe(en['assistant.canceledDetail']);
  });

  it('keeps the plain Stop wording for a plain Stop', () => {
    renderTurn(canceledTurn('user_stop'));
    expect(screen.getByTestId('assistant-label').textContent).toContain(en['assistant.canceledLabel']);
    expect(screen.getByTestId('assistant-label-detail').textContent).toBe(en['assistant.canceledDetail']);
  });
});
