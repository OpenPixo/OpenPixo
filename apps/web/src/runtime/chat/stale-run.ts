/**
 * When the chat stops trusting its own picture of a run and takes the daemon's.
 *
 * The chat learns that a run ended from that run's event stream. If the stream
 * never delivers the end (a request that never answered, a connection the
 * browser parked, a consumer that lost the run), the page kept the stop button,
 * the "running" status line and every gated card for as long as it stayed open,
 * while the daemon had long finished. Nothing asked the daemon again.
 *
 * The invariant this module states: **while the open conversation shows its
 * latest run as going, the daemon is asked about that run every
 * `STALE_RUN_POLL_MS`; once the daemon has said "terminal" on two reads at
 * least `STALE_RUN_GRACE_MS` apart and the chat still shows the run going, the
 * chat settles to the daemon's answer.** The grace period leaves a healthy
 * stream time to deliver the end itself, so this never races a normal finish.
 */
import type { ChatRunStatus } from '@openpixo/contracts';
import type { ChatMessage } from '../../types';
import { assistantMessageNeverHadARun } from './host-authored-message';

export const STALE_RUN_POLL_MS = 10_000;
export const STALE_RUN_GRACE_MS = 10_000;

const TERMINAL: ReadonlySet<ChatRunStatus> = new Set<ChatRunStatus>(['succeeded', 'failed', 'canceled']);

export type StaleRunVerdict =
  /** Keep watching. `terminalSeenAt` is when the daemon first said the run ended, if it has. */
  | { kind: 'keep'; terminalSeenAt: number | null }
  /** The daemon has said the run ended for longer than the grace period. */
  | { kind: 'settle' };

/**
 * One read of the daemon's status, folded into the watch.
 *
 * `status` is null when the read failed or the daemon no longer knows the run:
 * neither is proof that it ended, so the watch keeps going and starts over.
 */
export function staleRunVerdict(input: {
  status: ChatRunStatus | null;
  terminalSeenAt: number | null;
  now: number;
  graceMs?: number;
}): StaleRunVerdict {
  const graceMs = input.graceMs ?? STALE_RUN_GRACE_MS;
  if (input.status === null || !TERMINAL.has(input.status)) return { kind: 'keep', terminalSeenAt: null };
  if (input.terminalSeenAt === null) return { kind: 'keep', terminalSeenAt: input.now };
  if (input.now - input.terminalSeenAt >= graceMs) return { kind: 'settle' };
  return { kind: 'keep', terminalSeenAt: input.terminalSeenAt };
}

/**
 * The run the watch follows: the conversation's latest actual assistant turn,
 * and only when it carries a run id. A turn whose `POST /api/runs` has not
 * answered yet has no id, and then nothing is watched: settling an older run
 * there would cut off the send that is still starting.
 */
export function watchedRunId(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    if (assistantMessageNeverHadARun(message)) continue;
    return message.runId ?? null;
  }
  return null;
}
