// @vitest-environment jsdom
//
// The run-status poll is a backstop for runs started elsewhere, and only glyphs
// read it, so a hidden window has no one to show a 4 s answer to. It eases off
// while hidden and catches up the moment the window is visible again.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetProjectRunStatusStore,
  useProjectRunStatuses,
} from '../../src/hooks/useProjectRunStatuses';
import { RUNS_CHANGED_EVENT } from '../../src/providers/daemon';

const originalFetch = globalThis.fetch;
let visibility: DocumentVisibilityState = 'visible';
let projectStatus = 'running';

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function requests(): number {
  return vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/runs?projectId=')).length;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  visibility = 'visible';
  projectStatus = 'running';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  resetProjectRunStatusStore();
  globalThis.fetch = vi.fn(async () => new Response(
    JSON.stringify({
      runs: [{
        id: 'run-1',
        projectId: 'p1',
        conversationId: null,
        assistantMessageId: null,
        agentId: 'claude',
        status: projectStatus,
        createdAt: 1,
        updatedAt: 2,
      }],
      awaitingInputProjectIds: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(document, 'visibilityState');
  vi.useRealTimers();
});

describe('useProjectRunStatuses — hidden windows', () => {
  it('polls every 4 s while visible', async () => {
    renderHook(() => useProjectRunStatuses(['p1']));
    await advance(0);
    expect(requests()).toBe(1);
    await advance(12_000);
    expect(requests()).toBe(4);
  });

  it('polls every 30 s while hidden', async () => {
    renderHook(() => useProjectRunStatuses(['p1']));
    await advance(0);
    const baseline = requests();
    await act(async () => { setVisibility('hidden'); });
    await advance(29_999);
    expect(requests()).toBe(baseline);
    await advance(1);
    expect(requests()).toBe(baseline + 1);
    await advance(30_000);
    expect(requests()).toBe(baseline + 2);
  });

  it('starts at the slow pace when a surface subscribes in a hidden window', async () => {
    visibility = 'hidden';
    renderHook(() => useProjectRunStatuses(['p1']));
    await advance(0);
    expect(requests()).toBe(1);
    await advance(29_999);
    expect(requests()).toBe(1);
    await advance(1);
    expect(requests()).toBe(2);
  });

  it('refreshes at once on becoming visible, then returns to 4 s', async () => {
    const { result } = renderHook(() => useProjectRunStatuses(['p1']));
    await advance(0);
    expect(result.current.get('p1')).toBe('running');
    await act(async () => { setVisibility('hidden'); });
    await advance(10_000);
    projectStatus = 'failed';
    const baseline = requests();

    await act(async () => { setVisibility('visible'); });
    await advance(0);
    expect(requests()).toBe(baseline + 1);
    expect(result.current.get('p1')).toBe('failed');

    await advance(4_000);
    expect(requests()).toBe(baseline + 2);
    await advance(4_000);
    expect(requests()).toBe(baseline + 3);
  });

  it('still answers a run change the client caused while hidden', async () => {
    renderHook(() => useProjectRunStatuses(['p1']));
    await advance(0);
    await act(async () => { setVisibility('hidden'); });
    const baseline = requests();
    await act(async () => {
      window.dispatchEvent(new Event(RUNS_CHANGED_EVENT));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requests()).toBe(baseline + 1);
  });

  it('stops listening when the last surface leaves', async () => {
    const { unmount } = renderHook(() => useProjectRunStatuses(['p1']));
    await advance(0);
    unmount();
    const baseline = requests();
    await act(async () => { setVisibility('hidden'); });
    await act(async () => { setVisibility('visible'); });
    await advance(60_000);
    expect(requests()).toBe(baseline);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one timer however often visibility flips', async () => {
    renderHook(() => useProjectRunStatuses(['p1']));
    await advance(0);
    for (let flip = 0; flip < 3; flip += 1) {
      await act(async () => { setVisibility('hidden'); });
      await act(async () => { setVisibility('visible'); });
    }
    await advance(0);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { setVisibility('hidden'); });
    expect(vi.getTimerCount()).toBe(1);
  });
});
