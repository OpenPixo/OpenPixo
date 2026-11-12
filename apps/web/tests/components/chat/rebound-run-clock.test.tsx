// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { ChatMessage } from '@openpixo/contracts';
import { AssistantMessage } from '../../../src/components/AssistantMessage';
import { I18nProvider } from '../../../src/i18n';

// The field split is produced by the real daemon DB/pin/projection in
// apps/daemon/tests/chat-run-message-clock.test.ts. No cross-app imports:
// this side consumes the public message shape, including legacy variants.
const CREATED = 1_788_000_000_000;
const RESTARTED = CREATED + 300_000;

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'clock-message', role: 'assistant', content: '', runId: 'new-run',
    runStatus: 'succeeded', createdAt: CREATED, startedAt: RESTARTED, endedAt: RESTARTED + 20_000,
    events: [
      { kind: 'done_key', key: 'a7f3c91ed2b40561' },
      { kind: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'brief.md' } },
      { kind: 'tool_result', toolUseId: 'read-1', content: 'Brief', isError: false },
    ],
    ...overrides,
  };
}

const turn = (value: ChatMessage, streaming = false) => (
  <I18nProvider initial="en"><AssistantMessage message={value} streaming={streaming} projectId="clock-project" /></I18nProvider>
);
const clocks = (container: HTMLElement) => [...container.querySelectorAll('[data-testid="chat-foldable-elapsed"]')].map(el => el.textContent);

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('OPEND-2946: rebound run clocks use the physical start', () => {
  it('shows 20 seconds for a completed rebound run, not five minutes of previous message history', () => {
    const view = render(turn(message()));
    expect(clocks(view.container)).toEqual(['20s']);
  });

  it('ticks from the rebound start and freezes at terminal time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(RESTARTED + 20_000);
    const running = message({ runStatus: 'running', endedAt: undefined });
    const view = render(turn(running, true));
    expect(clocks(view.container)).toEqual(['20s']);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(clocks(view.container)).toEqual(['21s']);
    view.rerender(turn(message({ endedAt: RESTARTED + 21_000 })));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(clocks(view.container)).toEqual(['21s']);
  });

  it('updates an already mounted historical message when its authoritative start arrives', () => {
    const legacy = message({ startedAt: undefined });
    const view = render(turn(legacy));
    expect(clocks(view.container)).toEqual(['5m 20s']);
    // Preserve events and all other fields: this is a timestamp-only update.
    view.rerender(turn({ ...legacy, startedAt: RESTARTED }));
    expect(clocks(view.container)).toEqual(['20s']);
  });

  it('preserves the creation-time fallback for legacy messages without startedAt', () => {
    const view = render(turn(message({ startedAt: undefined, createdAt: RESTARTED })));
    expect(clocks(view.container)).toEqual(['20s']);
  });

  it('can time a persisted run with startedAt but no message creation timestamp', () => {
    const view = render(turn(message({ createdAt: undefined })));
    expect(clocks(view.container)).toEqual(['20s']);
  });
});
