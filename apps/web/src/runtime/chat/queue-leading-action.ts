/**
 * What the queue row's leading button does, and therefore what it is called.
 *
 * C18 (2026-11-21): the button read 「引导对话」 (steer) on every agent, while a
 * click on Codex stopped the running turn and resent the message, and the
 * turn was recorded as cancelled by the user. The face must name what a click
 * does:
 *
 *   · `steer` — a turn is running and the daemon says this agent can take a
 *     message into it (`AgentInfo.midTurnSteering`, decided by the daemon's
 *     `run-steering.ts`). The turn keeps its work. Only a plain-text row can
 *     be steered: a mid-turn message carries text, nothing else.
 *   · `stop-and-send` — a turn is running and cannot take this row. A click
 *     stops the turn, then sends; the UI asks first.
 *   · `send-now` — nothing is running; a click just sends.
 *
 * The agent's name is never consulted here: the daemon's answer is the rule.
 */

export type QueuedLeadingAction = 'steer' | 'stop-and-send' | 'send-now';

/** The parts of a queued row that decide whether it is plain text. */
export interface QueuedRowPayload {
  attachments?: readonly unknown[];
  meta?: {
    research?: unknown;
    skillIds?: readonly string[];
    appliedPluginSnapshot?: unknown;
    appliedPluginSnapshotId?: string;
    inlineAppliedPlugin?: unknown;
    context?: object | null;
  } | null;
}

function nonEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * True when the row carries something a mid-turn message cannot: files,
 * picked skills or plugins, research, or selected context. Those only travel
 * with a full send.
 */
export function queuedRowCarriesMoreThanText(row: QueuedRowPayload): boolean {
  if (nonEmptyList(row.attachments)) return true;
  const meta = row.meta;
  if (!meta) return false;
  if (meta.research || meta.appliedPluginSnapshot || meta.appliedPluginSnapshotId || meta.inlineAppliedPlugin) return true;
  if (nonEmptyList(meta.skillIds)) return true;
  const context = meta.context;
  if (context && typeof context === 'object') {
    return Object.values(context).some(nonEmptyList);
  }
  return false;
}

export function queuedLeadingAction(input: {
  turnInFlight: boolean;
  midTurnSteering: boolean;
  row: QueuedRowPayload;
}): QueuedLeadingAction {
  if (!input.turnInFlight) return 'send-now';
  if (input.midTurnSteering && !queuedRowCarriesMoreThanText(input.row)) return 'steer';
  return 'stop-and-send';
}
