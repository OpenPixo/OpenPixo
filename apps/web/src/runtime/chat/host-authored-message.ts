import type { ChatMessage } from '../../types';

/**
 * Saved conversations may contain auxiliary assistant notices without a physical
 * run. Optimistic API/BYOK placeholders do carry a start time, so run identity
 * alone cannot distinguish a real turn from a historical host notice.
 */
export function assistantMessageNeverHadARun(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false;
  return (
    message.runId === undefined
    && message.runStatus === undefined
    && message.startedAt === undefined
    && message.endedAt === undefined
  );
}

/** The latest actual assistant turn owns continuation and next-step actions. */
export function lastAssistantTurnId(messages: readonly ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    if (assistantMessageNeverHadARun(message)) continue;
    return message.id;
  }
  return undefined;
}

/** Historical auxiliary notices do not displace the transcript recovery owner. */
export function trailingMessageIgnoringHostCards(
  messages: readonly ChatMessage[],
): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    if (assistantMessageNeverHadARun(message)) continue;
    return message;
  }
  return null;
}
