import { describe, expect, it } from 'vitest';

import { STALE_RUN_GRACE_MS, staleRunVerdict, watchedRunId } from '../../../src/runtime/chat/stale-run';
import type { ChatMessage } from '../../../src/types';

describe('staleRunVerdict', () => {
  it('keeps watching while the daemon says the run is going', () => {
    expect(staleRunVerdict({ status: 'running', terminalSeenAt: null, now: 1_000 })).toEqual({ kind: 'keep', terminalSeenAt: null });
    expect(staleRunVerdict({ status: 'queued', terminalSeenAt: 500, now: 1_000 })).toEqual({ kind: 'keep', terminalSeenAt: null });
  });

  it('notes the first terminal answer but does not settle on it', () => {
    expect(staleRunVerdict({ status: 'succeeded', terminalSeenAt: null, now: 1_000 })).toEqual({ kind: 'keep', terminalSeenAt: 1_000 });
  });

  it('settles once the daemon has said terminal for the whole grace period', () => {
    expect(staleRunVerdict({ status: 'failed', terminalSeenAt: 1_000, now: 1_000 + STALE_RUN_GRACE_MS - 1 }))
      .toEqual({ kind: 'keep', terminalSeenAt: 1_000 });
    expect(staleRunVerdict({ status: 'canceled', terminalSeenAt: 1_000, now: 1_000 + STALE_RUN_GRACE_MS }))
      .toEqual({ kind: 'settle' });
  });

  it('treats an unreadable status as no proof and starts over', () => {
    expect(staleRunVerdict({ status: null, terminalSeenAt: 1_000, now: 99_000 })).toEqual({ kind: 'keep', terminalSeenAt: null });
  });
});

describe('watchedRunId', () => {
  const user = (id: string): ChatMessage => ({ id, role: 'user', content: 'hi', createdAt: 1 });
  const assistant = (id: string, extra: Partial<ChatMessage>): ChatMessage => ({ id, role: 'assistant', content: '', createdAt: 1, ...extra });

  it('follows the latest turn that has a run', () => {
    expect(watchedRunId([user('u1'), assistant('a1', { runId: 'r1', runStatus: 'running', startedAt: 1 })])).toBe('r1');
  });

  it('watches nothing while the latest send has no run id yet', () => {
    expect(watchedRunId([
      assistant('a1', { runId: 'r1', runStatus: 'running', startedAt: 1 }),
      user('u2'),
      assistant('a2', { runStatus: 'running', startedAt: 2 }),
    ])).toBeNull();
  });

  it('skips host notices that never had a run', () => {
    expect(watchedRunId([
      assistant('a1', { runId: 'r1', runStatus: 'succeeded', startedAt: 1 }),
      assistant('host', {}),
    ])).toBe('r1');
  });
});
