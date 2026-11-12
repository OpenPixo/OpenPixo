import type { ChatMessage } from '../../types';

/** Fork through the clicked persisted message; return -1 if it is not saved. */
export function forkBoundaryMessageIndex(
  messages: readonly ChatMessage[],
  clickedMessageId: string,
): number {
  return messages.findIndex((message) => message.id === clickedMessageId);
}
