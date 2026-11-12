import type { ChatMessage } from '../../types';

/**
 * The first run that answered the user's last message: its checkpoint holds
 * the files from before the last reply, which `/undo` restores. Null when the
 * last message has no answer with a run yet.
 */
export function lastTurnFirstRunId(messages: readonly ChatMessage[]): string | null {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === 'user') { lastUser = index; break; }
  }
  for (let index = lastUser + 1; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && message.runId) return message.runId;
  }
  return null;
}
