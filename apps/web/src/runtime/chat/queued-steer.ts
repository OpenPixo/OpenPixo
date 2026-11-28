/**
 * 「引导对话」: put one queued row into the turn that is running now
 * (`POST /api/runs/:id/steer`). The daemon decides whether an agent can take
 * it (`run-steering.ts`); this decides what the page does around the request.
 *
 * Three things must hold whatever the user does while the request is out:
 *
 *   · One row goes out once. A second press, or the queue's auto-start when the
 *     turn ends, must not send it again while its steer is on its way
 *     (`isSteering`).
 *   · The answer lands in the conversation the row belongs to. If the user has
 *     opened another conversation meanwhile, nothing is written on screen: the
 *     daemon already stored a delivered message, and the transcript shows it
 *     when that conversation is opened again.
 *   · Only text fits into a running turn. A row with files, skills, plugins or
 *     context is refused with the reason instead of losing its files; it can
 *     still go out as a full send. The queue strip normally offers
 *     「停止并发送」 for such a row, so this is the handler's own guarantee.
 */

import { queuedRowCarriesMoreThanText, type QueuedRowPayload } from './queue-leading-action';

export interface QueuedSteerRow extends QueuedRowPayload {
  id: string;
  conversationId: string;
  prompt: string;
}

export type QueuedSteerResult =
  | { ok: true; messageId: string }
  | { ok: false; code: string; message: string };

export type QueuedSteerErrorKey =
  | 'chat.queuedSteerTextOnly'
  | 'chat.queuedSteerUnsupported'
  | 'chat.queuedSteerFailed';

export interface QueuedSteerHost {
  steer(request: { runId: string; text: string }): Promise<QueuedSteerResult>;
  removeQueued(id: string): void;
  /** True while this conversation's transcript is the one on screen. */
  isShowing(conversationId: string): boolean;
  appendUserMessage(row: QueuedSteerRow, messageId: string): void;
  showError(key: QueuedSteerErrorKey): void;
  /** A steer that left its row queued has settled; the queue may move again. */
  onSettled?(): void;
}

export type QueuedSteerOutcome = 'delivered' | 'stays-queued' | 'busy' | 'text-only';

export function createQueuedSteerer(host: () => QueuedSteerHost) {
  const inFlight = new Set<string>();
  return {
    isSteering(id: string): boolean {
      return inFlight.has(id);
    },
    async steer(row: QueuedSteerRow, runId: string): Promise<QueuedSteerOutcome> {
      if (inFlight.has(row.id)) return 'busy';
      if (queuedRowCarriesMoreThanText(row)) {
        if (host().isShowing(row.conversationId)) host().showError('chat.queuedSteerTextOnly');
        return 'text-only';
      }
      inFlight.add(row.id);
      let result: QueuedSteerResult;
      try {
        result = await host().steer({ runId, text: row.prompt });
      } catch (cause) {
        result = { ok: false, code: 'NETWORK_ERROR', message: cause instanceof Error ? cause.message : String(cause) };
      } finally {
        inFlight.delete(row.id);
      }
      const current = host();
      const showing = current.isShowing(row.conversationId);
      if (result.ok) {
        current.removeQueued(row.id);
        if (showing) current.appendUserMessage(row, result.messageId);
        return 'delivered';
      }
      // The turn ended before it could take the message: the row stays queued
      // and goes out as the next turn, the way a queued message always does.
      if (result.code !== 'RUN_STEERING_CLOSED' && showing) {
        current.showError(result.code === 'RUN_STEERING_UNSUPPORTED' ? 'chat.queuedSteerUnsupported' : 'chat.queuedSteerFailed');
      }
      current.onSettled?.();
      return 'stays-queued';
    },
  };
}
