// @vitest-environment jsdom
/**
 * 输入框上方那一行状态(`chat/RunStatusLine`)—— 画什么、读屏念什么。
 * 判据本身在 `tests/runtime/chat/run-status.test.ts`;这里只钉「结论 → 一句话」。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedAgentEvent } from '@openpixo/contracts';
import { ChatPane } from '../../../src/components/ChatPane';
import { RunStatusLine } from '../../../src/components/chat/RunStatusLine';
import type { ChatMessage } from '../../../src/types';

let originalResizeObserver: typeof ResizeObserver | undefined;

beforeEach(() => {
  originalResizeObserver = globalThis.ResizeObserver;
  class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: MockResizeObserver });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: originalResizeObserver });
});

function line() {
  return screen.getByTestId('chat-run-status');
}

describe('RunStatusLine', () => {
  it('says the activity in plain words and exposes it as a status', () => {
    render(<RunStatusLine status={{ activity: 'coding', tone: 'busy' }} />);
    expect(line().getAttribute('data-activity')).toBe('coding');
    expect(within(line()).getByRole('status').textContent).toBe('Writing code');
  });

  it('leads with the current step and keeps the activity as the detail', () => {
    render(<RunStatusLine status={{ activity: 'previewing', tone: 'busy', step: 'Run the game preview' }} />);
    expect(within(line()).getByRole('status').textContent).toBe('Run the game preview·Running the game preview');
  });

  it('does not say the same sentence twice', () => {
    render(<RunStatusLine status={{ activity: 'coding', tone: 'busy', step: 'Writing code' }} />);
    expect(within(line()).getByRole('status').textContent).toBe('Writing code');
  });

  it('writes N/M for a media batch, or just the total when N is unknown', () => {
    const { rerender } = render(
      <RunStatusLine status={{ activity: 'generating', tone: 'busy', surface: 'image', progress: { done: 2, total: 5 } }} />,
    );
    expect(within(line()).getByRole('status').textContent).toBe('Generating images(2/5)');
    rerender(<RunStatusLine status={{ activity: 'generating', tone: 'busy', surface: 'audio', progress: { total: 3 } }} />);
    expect(within(line()).getByRole('status').textContent).toBe('Generating audio(3 in all)');
  });

  it.each([
    ['awaitingAnswer', 'attention', 'Waiting for your answer'],
    ['done', 'success', 'Done — you can ask for the next change'],
    ['failed', 'error', 'Stopped with an error'],
    ['idle', 'idle', 'Ready — tell me what to make'],
  ] as const)('%s reads as "%s"', (activity, tone, text) => {
    render(<RunStatusLine status={{ activity, tone }} />);
    expect(line().getAttribute('data-tone')).toBe(tone);
    expect(within(line()).getByRole('status').textContent).toBe(text);
  });

  it('turns the waiting sentence into a "question above" button when it can jump to the form', () => {
    const onJump = vi.fn();
    const { rerender } = render(
      <RunStatusLine status={{ activity: 'awaitingAnswer', tone: 'attention' }} onJumpToQuestion={onJump} />,
    );
    const jump = screen.getByTestId('chat-run-status-jump');
    expect(jump.textContent).toBe('A question above is waiting for you ↑');
    fireEvent.click(jump);
    expect(onJump).toHaveBeenCalledTimes(1);
    // Any other activity ignores the jump handler.
    rerender(<RunStatusLine status={{ activity: 'done', tone: 'success' }} onJumpToQuestion={onJump} />);
    expect(screen.queryByTestId('chat-run-status-jump')).toBeNull();
  });
});

describe('RunStatusLine inside ChatPane', () => {
  const user: ChatMessage = { id: 'u1', role: 'user', content: '做个跑酷游戏', createdAt: 1 };

  function assistant(overrides: Partial<ChatMessage>): ChatMessage {
    return { id: 'a1', role: 'assistant', content: '', createdAt: 2, ...overrides };
  }

  function renderPane(
    messages: ChatMessage[],
    streaming = false,
    extra: Partial<Parameters<typeof ChatPane>[0]> = {},
  ) {
    render(
      <ChatPane
        {...extra}
        messages={messages}
        streaming={streaming}
        error={null}
        projectId="p1"
        projectFiles={[]}
        onEnsureProject={async () => 'p1'}
        onSend={() => {}}
        onStop={() => {}}
        conversations={[]}
        activeConversationId={null}
        onSelectConversation={() => {}}
        onDeleteConversation={() => {}}
      />,
    );
  }

  it('is there before anything has run', () => {
    renderPane([]);
    expect(line().getAttribute('data-activity')).toBe('idle');
  });

  it('follows the open tool call of the running turn, with the plan step as detail', () => {
    const events: PersistedAgentEvent[] = [
      { kind: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [{ content: 'Write the player', activeForm: 'Writing the player', status: 'in_progress' }] } },
      { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
      { kind: 'tool_use', id: 'w1', name: 'Bash', input: { command: 'npm run dev' } },
    ];
    renderPane([user, assistant({ runStatus: 'running', events })], true);
    expect(line().getAttribute('data-activity')).toBe('previewing');
    expect(within(line()).getByRole('status').textContent).toContain('Writing the player');
  });

  it('waits for the user when the last turn asked a question form', () => {
    const content = '<question-form id="q" title="One thing">\n{"questions":[{"id":"a","type":"text","label":"Goal?","required":true}]}\n</question-form>';
    renderPane([user, assistant({ runStatus: 'succeeded', content, events: [{ kind: 'text', text: content }] })]);
    expect(line().getAttribute('data-activity')).toBe('awaitingAnswer');
  });

  it('while a question waits: the composer asks for the answer and the hint jumps to the form', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView });
    const content = '<question-form id="q-wait" title="One thing">\n{"questions":[{"id":"a","type":"text","label":"Goal?","required":true}]}\n</question-form>';
    renderPane(
      [user, assistant({ runStatus: 'succeeded', content, events: [{ kind: 'text', text: content }] })],
      false,
      { onSubmitQuestionForm: () => true },
    );
    expect(screen.getAllByText('Answer the question above, or type your own reply here').length).toBeGreaterThan(0);
    const form = document.querySelector<HTMLElement>('[data-form-id="q-wait"]');
    expect(form?.dataset.state).toBe('pending');
    scrollIntoView.mockClear();
    fireEvent.click(screen.getByTestId('chat-run-status-jump'));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(form);
    expect(form!.contains(document.activeElement)).toBe(true);
  });

  it('says done once the turn succeeded', () => {
    renderPane([user, assistant({ runStatus: 'succeeded', content: 'ok', events: [{ kind: 'text', text: 'ok' }] })]);
    expect(line().getAttribute('data-activity')).toBe('done');
  });
});
