// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeRun } from '@openpixo/contracts';

const listStudioRuns = vi.hoisted(() => vi.fn());
vi.mock('../../../src/providers/studio', () => ({ listStudioRuns }));

import { useRunHistory } from '../../../src/components/generate/useRunHistory';

function run(status: RecipeRun['status']): RecipeRun {
  return {
    id: 'r1', projectId: null, recipeId: 'sprite', recipeVersion: '1', inputs: {},
    model: { provider: 'p', id: 'm' }, status, candidates: [], createdAt: 1, updatedAt: 1,
  };
}

/** Answers after `ms`, the way a slow daemon would; an aborted request rejects. */
function slowAnswer(ms: number, runs: RecipeRun[]) {
  return (_projectId: string | null, signal?: AbortSignal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ runs }), ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); });
  });
}

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  listStudioRuns.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useRunHistory polling', () => {
  it('still sees a run finish when each read takes longer than the poll interval', async () => {
    listStudioRuns.mockImplementationOnce(slowAnswer(0, [run('generating')]));
    listStudioRuns.mockImplementation(slowAnswer(3000, [run('ready')]));
    const view = renderHook(() => useRunHistory(null, true));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(view.result.current.runs?.[0]?.status).toBe('generating');

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(view.result.current.runs?.[0]?.status).toBe('ready');
  });

  it('does not read while the page is hidden, and reads again when it shows', async () => {
    listStudioRuns.mockImplementation(slowAnswer(0, [run('generating')]));
    renderHook(() => useRunHistory(null, true));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const afterFirst = listStudioRuns.mock.calls.length;

    visibility = 'hidden';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const whileHidden = listStudioRuns.mock.calls.length;
    expect(whileHidden - afterFirst).toBeLessThanOrEqual(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(listStudioRuns.mock.calls.length).toBe(whileHidden);

    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(listStudioRuns.mock.calls.length).toBeGreaterThan(whileHidden);
  });
});
