import type { RewindConversationFiles, RewindConversationRequest, RewindConversationResponse } from '@openpixo/contracts';
import { checkpointsChanged } from '../components/checkpoints/client';
import { forgetPendingMessageSave } from './pending-message-saves';
import { CONVERSATIONS_CHANGED_EVENT } from './projects';

/** What "Edit" on a sent message tells the message it came from. */
export type EditUserMessageOutcome =
  | { ok: true; files: RewindConversationFiles }
  | { ok: false; code: string };

export class ConversationRewindError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Takes a conversation back to just before one of the user's messages
 * (`POST /api/projects/:id/conversations/:cid/rewind`), the first half of
 * "Edit" on a sent message; the caller sends the edited text afterwards.
 */
export async function rewindConversation(
  projectId: string,
  conversationId: string,
  body: RewindConversationRequest,
): Promise<RewindConversationResponse> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/rewind`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    },
  );
  const result = await response.json().catch(() => null) as
    | (RewindConversationResponse & { error?: { code?: string; message?: string } })
    | null;
  if (!response.ok || !result) {
    throw new ConversationRewindError(result?.error?.code ?? 'REWIND_FAILED', result?.error?.message ?? `HTTP ${response.status}`);
  }
  // A save of a removed message still waiting in storage would bring it back on the next load.
  for (const id of result.removedMessageIds) forgetPendingMessageSave(id);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONVERSATIONS_CHANGED_EVENT, { detail: { projectId } }));
  }
  if (result.files.restored) checkpointsChanged(projectId, true);
  return result;
}
