// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRunStatusResponse } from '@openpixo/contracts';

import { useStaleRunWatchdog } from '../../src/hooks/useStaleRunWatchdog';

function status(value: ChatRunStatusResponse['status']): ChatRunStatusResponse {
  return { id: 'run-1', status: value, createdAt: 0, updatedAt: 0 } as ChatRunStatusResponse;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useStaleRunWatchdog', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('settles a run the daemon has reported ended on two reads a poll apart', async () => {
    const readStatus = vi.fn(async () => status('succeeded'));
    const onStale = vi.fn();
    renderHook(() => useStaleRunWatchdog({ runId: 'run-1', watching: true, readStatus, onStale, intervalMs: 10_000 }));

    await advance(10_000);
    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(onStale).not.toHaveBeenCalled();

    await advance(10_000);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'succeeded' }));

    await advance(30_000);
    expect(readStatus).toHaveBeenCalledTimes(2);
  });

  it('never settles while the daemon says the run is going', async () => {
    const readStatus = vi.fn(async () => status('running'));
    const onStale = vi.fn();
    renderHook(() => useStaleRunWatchdog({ runId: 'run-1', watching: true, readStatus, onStale, intervalMs: 10_000 }));
    await advance(60_000);
    expect(readStatus).toHaveBeenCalledTimes(6);
    expect(onStale).not.toHaveBeenCalled();
  });

  it('stops asking once the chat no longer shows the run going', async () => {
    const readStatus = vi.fn(async () => status('succeeded'));
    const onStale = vi.fn();
    const { rerender } = renderHook(
      ({ watching }) => useStaleRunWatchdog({ runId: 'run-1', watching, readStatus, onStale, intervalMs: 10_000 }),
      { initialProps: { watching: true } },
    );
    await advance(10_000);
    rerender({ watching: false });
    await advance(60_000);
    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(onStale).not.toHaveBeenCalled();
  });

  it('survives a status read that throws', async () => {
    const readStatus = vi.fn(() => { throw new Error('offline'); });
    const onStale = vi.fn();
    renderHook(() => useStaleRunWatchdog({ runId: 'run-1', watching: true, readStatus, onStale, intervalMs: 10_000 }));
    await advance(30_000);
    expect(readStatus).toHaveBeenCalledTimes(3);
    expect(onStale).not.toHaveBeenCalled();
  });
});
