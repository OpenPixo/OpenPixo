import type Database from 'better-sqlite3';
import {
  CONVERSATION_COMPACT_COMMAND,
  renderConversationCompactionRequest,
} from '@openpixo/contracts';

/**
 * `/compact` on the daemon side (contract: `prompts/conversation-compaction.ts`).
 *
 * What must hold:
 * - A summary exists only for a compaction turn that succeeded with a reply.
 *   The record is the daemon's, in its own table, because the web client writes
 *   message rows back through PUT /messages and would not carry it.
 * - The runtime session that wrote a summary is never resumed. The resume guard
 *   asks `isCompactionMessage` about the session's last reply, so this holds
 *   whatever order the session row and this record are written in.
 * - A rewind that removes the summary removes the record with it (the foreign
 *   key cascades), and the conversation is again sent in full.
 */

type SqliteDb = Database.Database;

export function migrateConversationCompactions(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_compactions (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_compactions_conversation
      ON conversation_compactions(conversation_id);
  `);
}

/** The summary replies of one conversation, for marking messages in one query. */
export function compactionMessageIds(db: SqliteDb, conversationId: string): Set<string> {
  try {
    const rows = db.prepare('SELECT message_id AS id FROM conversation_compactions WHERE conversation_id = ?')
      .all(conversationId) as Array<{ id: string }>;
    return new Set(rows.map(row => row.id));
  } catch {
    return new Set();
  }
}

export function isCompactionMessage(db: SqliteDb, messageId: string | null | undefined): boolean {
  if (!messageId) return false;
  try {
    return db.prepare('SELECT 1 FROM conversation_compactions WHERE message_id = ?').get(messageId) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Records a finished compaction turn. Returns whether it became the summary:
 * only a succeeded turn whose reply is still in the conversation and not empty.
 */
export function recordConversationCompaction(
  db: SqliteDb,
  input: { conversationId: string; assistantMessageId: string; status: string },
  now: () => number = Date.now,
): boolean {
  if (input.status !== 'succeeded') return false;
  const row = db.prepare(`SELECT content FROM messages WHERE id = ? AND conversation_id = ? AND role = 'assistant'`)
    .get(input.assistantMessageId, input.conversationId) as { content?: unknown } | undefined;
  if (typeof row?.content !== 'string' || !row.content.trim()) return false;
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO conversation_compactions (message_id, conversation_id, created_at) VALUES (?, ?, ?)')
      .run(input.assistantMessageId, input.conversationId, now());
    db.prepare('DELETE FROM agent_sessions WHERE conversation_id = ?').run(input.conversationId);
  })();
  return true;
}

/**
 * The turn a `/compact` run sends. A resumed session gets the request alone as
 * the latest turn; a fresh one gets the transcript the client rendered, which
 * ends with the user's `/compact`, followed by the request.
 */
export function compactionTurnPrompt(message: unknown): { message: string; currentPrompt: string } {
  const request = renderConversationCompactionRequest();
  const transcript = typeof message === 'string' ? message.trim() : '';
  const typedOnly = transcript === CONVERSATION_COMPACT_COMMAND || transcript === '';
  return { message: typedOnly ? request : `${transcript}\n\n${request}`, currentPrompt: request };
}
