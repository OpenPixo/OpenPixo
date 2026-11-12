import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ListProjectCheckpointsResponse, ProjectCheckpoint, RewindConversationResponse } from '@openpixo/contracts';
import { resolveAgentResumeContext } from '../../src/agent-session-resume.js';
import { closeDatabase, insertConversation, insertProject, listMessages, openDatabase, upsertAgentSession, upsertMessage } from '../../src/db.js';
import { CheckpointError } from '../../src/projects/checkpoints.js';
import { registerConversationRewindRoutes, type RewindCheckpoints } from '../../src/routes/project/conversation-rewind.js';

/*
 * "Edit" on a sent message and `pixo conversation rewind` share this route.
 * What it must guarantee: the message and everything after it are gone, the
 * agent cannot carry the removed replies over in a resumed session, and the
 * files are only rolled back to before the first run that answered it.
 */

const checkpoint = (id: string, runId: string): ProjectCheckpoint => ({
  id, runId, conversationId: 'conv-1', createdAt: new Date().toISOString(), summary: 's',
  kind: 'run', changedFileCount: 1, runChanges: [], completedAt: null,
});

describe('POST /api/projects/:id/conversations/:cid/rewind', () => {
  let dir = '';
  let server: Server | undefined;
  let base = '';
  let busy = false;
  let listed: ListProjectCheckpointsResponse;
  let restored: string[] = [];
  let restoreFails = false;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'pixo-rewind-'));
    busy = false;
    restored = [];
    restoreFails = false;
    listed = { status: 'available', busy: false, checkpoints: [checkpoint('cp-2', 'run-2'), checkpoint('cp-1', 'run-1')] };
    const db = openDatabase(dir, { dataDir: dir });
    const now = Date.now();
    insertProject(db, { id: 'proj-1', name: 'P', createdAt: now, updatedAt: now });
    insertConversation(db, { id: 'conv-1', projectId: 'proj-1', title: 'C', createdAt: now, updatedAt: now });
    upsertMessage(db, 'conv-1', { id: 'u1', role: 'user', content: 'make a jump' });
    upsertMessage(db, 'conv-1', { id: 'a1', role: 'assistant', content: 'done', runId: 'run-1', runStatus: 'succeeded' });
    upsertMessage(db, 'conv-1', { id: 'u2', role: 'user', content: 'make it higher' });
    upsertMessage(db, 'conv-1', { id: 'a2', role: 'assistant', content: 'higher', runId: 'run-2', runStatus: 'succeeded' });
    upsertAgentSession(db, { conversationId: 'conv-1', agentId: 'codex', sessionId: 's-1', lastMessageId: 'a2' });

    const checkpoints: RewindCheckpoints = {
      list: async () => listed,
      restore: async (id) => {
        if (restoreFails) throw new CheckpointError('CHECKPOINT_WORKTREE_CONFLICT', 'conflict');
        restored.push(id);
        return { checkpoint: checkpoint(id, 'x'), backupCheckpoint: checkpoint('backup', 'x'), restoredFiles: [{ path: 'game.js', status: 'modified' }] };
      },
    };
    const app = express();
    app.use(express.json());
    registerConversationRewindRoutes(app, {
      db,
      http: {
        requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
        sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
        isLocalSameOrigin: () => true,
        resolvedPortRef: { current: 0 },
      },
      paths: { PROJECTS_DIR: dir, RUNTIME_DATA_DIR: dir },
      authorizeProjectRequest: async () => true,
      isProjectBusy: () => busy,
      checkpointsFor: () => checkpoints,
    });
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    const address = server!.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  const rewind = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/projects/proj-1/conversations/conv-1/rewind`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const ids = () => listMessages(openDatabase(dir, { dataDir: dir }), 'conv-1').map((m: { id: string }) => m.id);

  it('removes the message and every later one, and rolls files back to before its answer', async () => {
    const response = await rewind({ fromMessageId: 'u2', restoreFiles: true });
    expect(response.status).toBe(200);
    const body = await response.json() as RewindConversationResponse;
    expect(body.removedMessageIds).toEqual(['u2', 'a2']);
    expect(body.files).toEqual({ restored: true, checkpointId: 'cp-2', restoredFiles: [{ path: 'game.js', status: 'modified' }] });
    expect(restored).toEqual(['cp-2']);
    expect(ids()).toEqual(['u1', 'a1']);
  });

  it('starts the next turn without the agent session that heard the removed replies', async () => {
    await rewind({ fromMessageId: 'u2', restoreFiles: false });
    const context = resolveAgentResumeContext(openDatabase(dir, { dataDir: dir }), { conversationId: 'conv-1', agentId: 'codex' });
    expect(context.isResuming).toBe(false);
    expect(context.storedSessionId).toBeNull();
  });

  it('keeps the files when asked, and says why nothing was restored', async () => {
    const kept = await (await rewind({ fromMessageId: 'u1', restoreFiles: false })).json() as RewindConversationResponse;
    expect(kept.files).toEqual({ restored: false, reason: 'not_requested' });
    expect(restored).toEqual([]);
    expect(ids()).toEqual([]);
  });

  it('reports a project without checkpoints instead of failing', async () => {
    listed = { status: 'unavailable', reason: 'not_git', checkpoints: [] };
    const body = await (await rewind({ fromMessageId: 'u1', restoreFiles: true })).json() as RewindConversationResponse;
    expect(body.files).toEqual({ restored: false, reason: 'checkpoints_unavailable' });
    expect(ids()).toEqual([]);
  });

  it('leaves every message in place when the files cannot be restored', async () => {
    restoreFails = true;
    const response = await rewind({ fromMessageId: 'u1', restoreFiles: true });
    expect(response.status).toBe(409);
    expect(ids()).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('only takes back the user’s own messages, and only while nothing runs', async () => {
    expect((await rewind({ fromMessageId: 'a1', restoreFiles: false })).status).toBe(400);
    expect((await rewind({ fromMessageId: 'nope', restoreFiles: false })).status).toBe(404);
    busy = true;
    expect((await rewind({ fromMessageId: 'u1', restoreFiles: false })).status).toBe(409);
    busy = false;
    expect((await rewind({ fromMessageId: 'u1', restoreFiles: false }, { Authorization: 'Bearer pixott_agent' })).status).toBe(403);
    expect(ids()).toEqual(['u1', 'a1', 'u2', 'a2']);
  });
});
