/**
 * C18: a turn stopped to deliver a queued message is not a plain Stop.
 *
 * The queue row's 「停止并发送」 aborts the run's cancel signal with the
 * `queued_send` reason. The cancel request must say so, so the daemon records
 * `cancelOrigin: 'queued_send'` and the transcript can say the turn was
 * interrupted to send the new message instead of "stopped at your request".
 * A plain Stop keeps sending the bare request it always sent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QUEUED_SEND_CANCEL_REASON, streamViaDaemon } from '../../src/providers/daemon';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(value: unknown, status = 202): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function stopWith(reason: unknown) {
  const streamController = new AbortController();
  const cancelController = new AbortController();
  const onCancelOrigin = vi.fn();
  const onError = vi.fn();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/runs') return jsonResponse({ runId: 'run-1' });
    if (url === '/api/runs/run-1/cancel') {
      const asked = _init?.body ? (JSON.parse(String(_init.body)) as { origin?: string }).origin : undefined;
      return jsonResponse({ ok: true, run: { cancelOrigin: asked === 'queued_send' ? 'queued_send' : 'user_stop' } }, 200);
    }
    if (url === '/api/runs/run-1/events') {
      cancelController.abort(reason);
      streamController.abort();
      throw new DOMException('aborted', 'AbortError');
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  await streamViaDaemon({
    agentId: 'mock',
    history: [{ id: '1', role: 'user', content: 'hello' }],
    systemPrompt: '',
    signal: streamController.signal,
    cancelSignal: cancelController.signal,
    handlers: {
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError,
      onAgentEvent: vi.fn(),
      onArtifactCount: vi.fn(),
      onReconnect: vi.fn(),
    },
    onCancelOrigin,
  });
  await vi.waitFor(() => expect(onCancelOrigin).toHaveBeenCalled());
  const cancelCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/runs/run-1/cancel');
  return { init: cancelCall?.[1], onCancelOrigin };
}

describe('cancel request for a queued send', () => {
  it('names queued_send when the stop delivers a queued message', async () => {
    const { init, onCancelOrigin } = await stopWith(QUEUED_SEND_CANCEL_REASON);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ origin: 'queued_send' });
    expect(onCancelOrigin).toHaveBeenCalledWith('queued_send');
  });

  it('keeps a plain Stop a bare request', async () => {
    const { init, onCancelOrigin } = await stopWith(undefined);
    expect(init).toEqual({ method: 'POST' });
    expect(onCancelOrigin).toHaveBeenCalledWith('user_stop');
  });
});
