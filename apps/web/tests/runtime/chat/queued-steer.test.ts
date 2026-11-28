import { describe, expect, it, vi } from 'vitest';

import { createQueuedSteerer, type QueuedSteerHost, type QueuedSteerResult } from '../../../src/runtime/chat/queued-steer';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(showing = 'conv-a') {
  const pending: Array<ReturnType<typeof deferred<QueuedSteerResult>>> = [];
  const state = { showing };
  const host: QueuedSteerHost = {
    steer: vi.fn(() => {
      const next = deferred<QueuedSteerResult>();
      pending.push(next);
      return next.promise;
    }),
    removeQueued: vi.fn(),
    isShowing: (conversationId) => conversationId === state.showing,
    appendUserMessage: vi.fn(),
    showError: vi.fn(),
    onSettled: vi.fn(),
  };
  return { host, pending, state, steerer: createQueuedSteerer(() => host) };
}

const row = { id: 'q1', conversationId: 'conv-a', prompt: 'also add a jump', attachments: [] };

describe('createQueuedSteerer', () => {
  it('sends a row once however often the button is pressed while it is on its way', async () => {
    const { host, pending, steerer } = setup();
    const first = steerer.steer(row, 'run-1');
    const second = steerer.steer(row, 'run-1');
    expect(await second).toBe('busy');
    expect(steerer.isSteering('q1')).toBe(true);
    pending[0]!.resolve({ ok: true, messageId: 'm1' });
    expect(await first).toBe('delivered');
    expect(host.steer).toHaveBeenCalledTimes(1);
    expect(host.appendUserMessage).toHaveBeenCalledTimes(1);
    expect(steerer.isSteering('q1')).toBe(false);
  });

  it('does not write into another conversation the user switched to meanwhile', async () => {
    const { host, pending, state, steerer } = setup();
    const done = steerer.steer(row, 'run-1');
    state.showing = 'conv-b';
    pending[0]!.resolve({ ok: true, messageId: 'm1' });
    await done;
    expect(host.removeQueued).toHaveBeenCalledWith('q1');
    expect(host.appendUserMessage).not.toHaveBeenCalled();
  });

  it('keeps a failure out of another conversation', async () => {
    const { host, pending, state, steerer } = setup();
    const done = steerer.steer(row, 'run-1');
    state.showing = 'conv-b';
    pending[0]!.resolve({ ok: false, code: 'HTTP_500', message: 'boom' });
    await done;
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.removeQueued).not.toHaveBeenCalled();
  });

  it('shows a failure in the conversation it belongs to', async () => {
    const { host, pending, steerer } = setup();
    const done = steerer.steer(row, 'run-1');
    pending[0]!.resolve({ ok: false, code: 'RUN_STEERING_UNSUPPORTED', message: 'no' });
    await done;
    expect(host.showError).toHaveBeenCalledWith('chat.queuedSteerUnsupported');
    expect(host.onSettled).toHaveBeenCalled();
  });

  it('leaves a row queued without an error when the turn ended first', async () => {
    const { host, pending, steerer } = setup();
    const done = steerer.steer(row, 'run-1');
    pending[0]!.resolve({ ok: false, code: 'RUN_STEERING_CLOSED', message: 'closed' });
    expect(await done).toBe('stays-queued');
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.removeQueued).not.toHaveBeenCalled();
    expect(host.onSettled).toHaveBeenCalled();
  });

  it('refuses a row with files instead of sending its text alone', async () => {
    const { host, steerer } = setup();
    const withFile = { ...row, attachments: [{ path: 'sprite.png' }] };
    expect(await steerer.steer(withFile, 'run-1')).toBe('text-only');
    expect(host.steer).not.toHaveBeenCalled();
    expect(host.removeQueued).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith('chat.queuedSteerTextOnly');
  });
});
