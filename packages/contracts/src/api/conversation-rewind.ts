import type { CheckpointFileChange } from './checkpoints.js';

/**
 * `POST /api/projects/:id/conversations/:cid/rewind`
 *
 * Takes a conversation back to just before one of the user's messages: that
 * message and everything after it are removed, and, when asked, the project's
 * files go back to how they were before the first run that followed it. The
 * caller then sends the edited message the normal way. Used by "Edit" on a
 * sent message and by `pixo conversation rewind`.
 */
export interface RewindConversationRequest {
  /** The user message to take back. It and every later message are removed. */
  fromMessageId: string;
  /** Also put the project's files back to before that message. */
  restoreFiles: boolean;
}

/** Why the files were left as they are. */
export type RewindFilesSkippedReason =
  /** The caller asked to keep the files. */
  | 'not_requested'
  /** No agent run followed the message, so nothing changed files. */
  | 'nothing_to_undo'
  /** The project has no checkpoints (not a folder that can be snapshotted). */
  | 'checkpoints_unavailable'
  /** Checkpoints exist, but none was taken before that run. */
  | 'no_checkpoint';

export type RewindConversationFiles =
  | { restored: true; checkpointId: string; restoredFiles: CheckpointFileChange[] }
  | { restored: false; reason: RewindFilesSkippedReason };

/**
 * Errors besides the shared ones: `RUN_ACTIVE` (409) while a run in this
 * project has not ended; `MESSAGE_NOT_FOUND` (404); `NOT_A_USER_MESSAGE` (400);
 * and checkpoint codes such as `CHECKPOINT_WORKTREE_CONFLICT` (409), in which
 * case no message was removed.
 */
export interface RewindConversationResponse {
  conversationId: string;
  /** Every removed message id, oldest first; the first is `fromMessageId`. */
  removedMessageIds: string[];
  files: RewindConversationFiles;
}

