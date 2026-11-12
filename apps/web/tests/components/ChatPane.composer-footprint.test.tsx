// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/components/ChatPane';
import type { ChatMessage } from '../../src/types';

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef(() => <div data-testid="composer-fixture" />),
}));
vi.mock('../../src/components/AssistantMessage', () => ({
  AssistantMessage: () => <div data-testid="last-message-actions">Message actions</div>,
}));

type Observer = { callback: ResizeObserverCallback; targets: Set<Element> };
const observers: Observer[] = [];
const PANE_HEIGHT = 640;
const CONTENT_HEIGHT = 1200;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let composerHeight: number;
let scrollTop: number;
let originalScrollTo: PropertyDescriptor | undefined;

function rect(top: number, height: number): DOMRect {
  return { x: 0, y: top, left: 0, right: 420, width: 420, top, bottom: top + height, height, toJSON() {} };
}
function isLog(element: Element): boolean {
  return element.getAttribute('data-testid') === 'chat-log';
}
function queueHeight(): number {
  return document.querySelector('[data-testid="chat-queued-send-strip"]') ? 80 : 0;
}
// jsdom has no layout: model the flow placeholder's browser sizing, then
// assert action/composer geometry rather than a class or CSS declaration.
function reservedHeight(): number {
  const slot = document.querySelector<HTMLElement>('[data-testid="chat-composer-slot"]');
  return slot ? Math.max(Number.parseFloat(slot.style.height) || 0, Number.parseFloat(slot.style.minHeight) || 0) : 0;
}
function viewportHeight(): number { return PANE_HEIGHT - reservedHeight() - queueHeight(); }
function notifyResize(target: Element): void {
  for (const observer of observers) {
    if (observer.targets.has(target)) observer.callback([], observer as unknown as ResizeObserver);
  }
}
async function flushFrame(): Promise<void> {
  await act(async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(performance.now()));
  });
}

beforeEach(() => {
  composerHeight = 120;
  scrollTop = 0;
  frameId = 0;
  frames = new Map();
  observers.length = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class {
    private observer: Observer;
    constructor(callback: ResizeObserverCallback) {
      this.observer = { callback, targets: new Set() };
      observers.push(this.observer);
    }
    observe(target: Element) { this.observer.targets.add(target); }
    unobserve(target: Element) { this.observer.targets.delete(target); }
    disconnect() { this.observer.targets.clear(); }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const id = this.getAttribute('data-testid');
    if (id === 'chat-composer-slot') {
      const height = this.childElementCount ? composerHeight : reservedHeight();
      return rect(PANE_HEIGHT - height, height);
    }
    if (id === 'chat-composer-layer') return rect(PANE_HEIGHT - composerHeight, composerHeight);
    if (id === 'last-message-actions') {
      const gap = screen.queryByTestId('chat-plan-pill') ? 52 : 20;
      return rect(CONTENT_HEIGHT - gap - scrollTop - 24, 24);
    }
    if (id === 'chat-log') return rect(0, viewportHeight());
    return rect(0, this.closest('[data-testid="chat-queued-send-strip"]') ? 48 : PANE_HEIGHT);
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isLog(this) ? viewportHeight() : PANE_HEIGHT;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isLog(this) ? CONTENT_HEIGHT : PANE_HEIGHT;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
    return isLog(this) ? scrollTop : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, value) {
    if (isLog(this)) scrollTop = Math.max(0, Math.min(value, CONTENT_HEIGHT - viewportHeight()));
  });
  originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo;
});

const messages: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'Build a game', createdAt: 1 },
  { id: 'a1', role: 'assistant', content: 'Ready.', createdAt: 2, endedAt: 3, runStatus: 'succeeded' },
];
async function mountChat(withQueueAndPlan = false) {
  const transcript: ChatMessage[] = withQueueAndPlan ? [messages[0]!, {
    ...messages[1]!, endedAt: undefined, runStatus: 'running',
    events: [{ kind: 'tool_use', id: 'todo1', name: 'TodoWrite', input: { todos: [{ content: 'Build the game', status: 'in_progress' }] } }],
  }] : messages;
  const view = render(<ChatPane
    messages={transcript} streaming={withQueueAndPlan} error={null}
    projectId="composer-footprint" projectFiles={[]}
    queuedItems={withQueueAndPlan ? [{ id: 'q1', prompt: 'Add sound effects' }] : []}
    onEnsureProject={async () => 'composer-footprint'} onSend={() => {}} onStop={() => {}}
    conversations={[]} activeConversationId={null}
    onSelectConversation={() => {}} onDeleteConversation={() => {}}
  />);
  await flushFrame();
  await flushFrame();
  const log = screen.getByTestId('chat-log');
  fireEvent.scroll(log);
  expect(scrollTop).toBe(CONTENT_HEIGHT - viewportHeight());
  return { ...view, log };
}

describe('ChatPane composer footprint', () => {
  it.each([['multiline text', 220], ['attachments and wrapped toolbar', 360]])(
    'keeps final actions above %s after the first resize frame', async (_label, height) => {
      const { log } = await mountChat();
      const layer = screen.getByTestId('chat-composer-layer');
      composerHeight = height;
      act(() => { notifyResize(layer); });
      await flushFrame();
      expect(screen.getByTestId('last-message-actions').getBoundingClientRect().bottom)
        .toBeLessThanOrEqual(layer.getBoundingClientRect().top);
      fireEvent.scroll(log);
      expect(screen.getByTestId('last-message-actions').getBoundingClientRect().bottom)
        .toBeLessThanOrEqual(layer.getBoundingClientRect().top);
    },
  );

  it('observes composer, queue and log across a remount with an active plan', async () => {
    const first = await mountChat();
    const previousSlot = screen.getByTestId('chat-composer-slot');
    first.unmount();
    expect(observers.every((observer) => !observer.targets.has(previousSlot))).toBe(true);
    const { log } = await mountChat(true);
    const slot = screen.getByTestId('chat-composer-slot');
    const queue = screen.getByTestId('chat-queued-send-strip');
    expect(screen.getByTestId('chat-plan-pill')).toBeTruthy();
    expect(slot.getAttribute('aria-hidden')).toBe('true');
    expect(observers.some((observer) => [log, slot, queue].every((target) => observer.targets.has(target)))).toBe(true);
    composerHeight = 360;
    act(() => { notifyResize(screen.getByTestId('chat-composer-layer')); notifyResize(queue); });
    await flushFrame();
    expect(screen.getByTestId('last-message-actions').getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(screen.getByTestId('chat-composer-layer').getBoundingClientRect().top);
  });

  it('preserves a reader position while the composer grows', async () => {
    const { log } = await mountChat();
    fireEvent.wheel(log, { deltaY: -120 });
    scrollTop -= 120;
    fireEvent.scroll(log);
    const readingPosition = scrollTop;
    composerHeight = 360;
    act(() => { notifyResize(screen.getByTestId('chat-composer-layer')); });
    await flushFrame();
    expect(scrollTop).toBe(readingPosition);
  });
});
