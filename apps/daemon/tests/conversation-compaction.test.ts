import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderConversationCompactionRequest } from '@openpixo/contracts';
import { resolveAgentResumeContext } from '../src/agent-session-resume.js';
import {
  compactionTurnPrompt,
  isCompactionMessage,
  recordConversationCompaction,
} from '../src/conversation-compaction.js';
import { closeDatabase, insertConversation, insertProject, listMessages, openDatabase, upsertAgentSession, upsertMessage } from '../src/db.js';

let dir: string;
let db: ReturnType<typeof openDatabase>;
const CONVERSATION = 'conv-1';

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pixo-compaction-'));
  db = openDatabase(dir, { dataDir: dir });
  const now = Date.now();
  insertProject(db, { id: 'p1', name: 'Game', createdAt: now, updatedAt: now });
  insertConversation(db, { id: CONVERSATION, projectId: 'p1', title: null, createdAt: now, updatedAt: now });
  upsertMessage(db, CONVERSATION, { id: 'u1', role: 'user', content: 'make a game' });
  upsertMessage(db, CONVERSATION, { id: 'a1', role: 'assistant', content: 'made it', runStatus: 'succeeded' });
  upsertMessage(db, CONVERSATION, { id: 'u2', role: 'user', content: '/compact' });
  upsertMessage(db, CONVERSATION, { id: 'a2', role: 'assistant', content: '## Goal\nA game.', runStatus: 'succeeded' });
  upsertAgentSession(db, { conversationId: CONVERSATION, agentId: 'opencode', sessionId: 'ses_1', lastMessageId: 'a2' });
});

afterEach(async () => {
  closeDatabase();
  await rm(dir, { recursive: true, force: true });
});

describe('recording a /compact summary', () => {
  it('records a succeeded reply, marks it in the transcript and drops the session', () => {
    expect(recordConversationCompaction(db, { conversationId: CONVERSATION, assistantMessageId: 'a2', status: 'succeeded' })).toBe(true);
    expect(isCompactionMessage(db, 'a2')).toBe(true);
    const messages = listMessages(db, CONVERSATION) as Array<{ id: string; compaction?: true }>;
    expect(messages.filter((message) => message.compaction).map((message) => message.id)).toEqual(['a2']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_sessions WHERE conversation_id = ?').get(CONVERSATION)).toEqual({ n: 0 });
  });

  it('records nothing for a failed run or an empty reply', () => {
    expect(recordConversationCompaction(db, { conversationId: CONVERSATION, assistantMessageId: 'a2', status: 'failed' })).toBe(false);
    upsertMessage(db, CONVERSATION, { id: 'a3', role: 'assistant', content: '   ', runStatus: 'succeeded' });
    expect(recordConversationCompaction(db, { conversationId: CONVERSATION, assistantMessageId: 'a3', status: 'succeeded' })).toBe(false);
    expect(isCompactionMessage(db, 'a2')).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_sessions WHERE conversation_id = ?').get(CONVERSATION)).toEqual({ n: 1 });
  });

  it('never resumes the session that wrote the summary, even if it was saved after the record', () => {
    recordConversationCompaction(db, { conversationId: CONVERSATION, assistantMessageId: 'a2', status: 'succeeded' });
    // The run saves its session when it finishes; that may land after the record.
    upsertAgentSession(db, { conversationId: CONVERSATION, agentId: 'opencode', sessionId: 'ses_1', lastMessageId: 'a2' });
    const context = resolveAgentResumeContext(db, { conversationId: CONVERSATION, agentId: 'opencode' });
    expect(context.isResuming).toBe(false);
    expect(context.invalidationReason).toBe('conversation_compacted');
  });

  it('goes away with the summary when a rewind removes it', () => {
    recordConversationCompaction(db, { conversationId: CONVERSATION, assistantMessageId: 'a2', status: 'succeeded' });
    db.prepare('DELETE FROM messages WHERE id = ?').run('a2');
    expect(isCompactionMessage(db, 'a2')).toBe(false);
  });
});

describe('the /compact turn', () => {
  it('sends the summary request after the transcript, and alone to a resumed session', () => {
    const request = renderConversationCompactionRequest();
    expect(compactionTurnPrompt('## user\nmake a game\n\n## user\n/compact')).toEqual({
      message: `## user\nmake a game\n\n## user\n/compact\n\n${request}`,
      currentPrompt: request,
    });
    expect(compactionTurnPrompt('/compact')).toEqual({ message: request, currentPrompt: request });
  });
});
