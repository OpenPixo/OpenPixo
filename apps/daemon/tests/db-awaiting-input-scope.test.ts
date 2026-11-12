// `GET /api/runs?projectId=` is polled every few seconds per subscribed project.
// Its awaiting-input answer must come from that project's messages alone: the
// marker prefilter is a substring scan of assistant text, so an unscoped query
// costs the whole database's history on every poll.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeDatabase,
  getProject,
  insertConversation,
  insertProject,
  listConversationsAwaitingInput,
  listProjectsAwaitingInput,
  openDatabase,
  upsertMessage,
} from '../src/db.js';
import { createAuthorizeProjectRequest } from '../src/projects/project-access.js';
import { registerRunRoutes } from '../src/routes/runs.js';

const FORM = '<question-form>{"questions":[{"id":"dir","label":"Direction?"}]}</question-form>';

let directory: string | null = null;
let server: http.Server | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    const closing = server;
    server = null;
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
  closeDatabase();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  directory = null;
});

function openFixture() {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixo-awaiting-scope-'));
  return openDatabase(directory, { dataDir: directory });
}

function seedProject(db: ReturnType<typeof openDatabase>, id: string, ...turns: Array<['assistant' | 'user', string]>) {
  insertProject(db, { id, name: id, createdAt: 1, updatedAt: 1 });
  insertConversation(db, { id: `conversation-${id}`, projectId: id, createdAt: 1, updatedAt: 1 });
  turns.forEach(([role, content], index) => {
    upsertMessage(db, `conversation-${id}`, { id: `${id}-${index}`, role, createdAt: 10 + index, content });
  });
}

describe('listProjectsAwaitingInput scoped to one project', () => {
  it('never evaluates the content match on another project', () => {
    const db = openFixture();
    seedProject(db, 'requested', ['assistant', `requested ${FORM}`]);
    seedProject(db, 'unrelated', ['assistant', `unrelated ${FORM}`]);
    const evaluated: string[] = [];
    db.function('lower', (value: string) => {
      evaluated.push(value);
      return value.toLowerCase();
    });
    expect(listProjectsAwaitingInput(db, 'requested')).toEqual(new Set(['requested']));
    expect(evaluated.some((content) => content.startsWith('requested'))).toBe(true);
    expect(evaluated.some((content) => content.startsWith('unrelated'))).toBe(false);
  });

  it('reaches the messages through the project and conversation indexes', () => {
    const db = openFixture();
    seedProject(db, 'requested', ['assistant', FORM]);
    const prepare = vi.spyOn(db, 'prepare');
    listProjectsAwaitingInput(db, 'requested');
    const sql = prepare.mock.calls.map(([text]) => text).find((text) => text.includes('AS partitionKey'));
    expect(sql).toBeDefined();
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('requested') as Array<{ detail: string }>;
    const details = plan.map((row) => row.detail);
    expect(details.some((detail) => /SEARCH c USING .*idx_conv_project.*project_id=\?/i.test(detail))).toBe(true);
    expect(details.some((detail) => /SEARCH m USING .*idx_messages_conv.*conversation_id=\?/i.test(detail))).toBe(true);
    expect(details.some((detail) => /SCAN (m|messages)\b/i.test(detail))).toBe(false);
  });

  it('answers exactly what the unscoped read answers for that project', () => {
    const db = openFixture();
    seedProject(db, 'waiting', ['assistant', FORM]);
    seedProject(db, 'answered', ['assistant', FORM], ['user', 'Left.']);
    seedProject(db, 'quiet', ['assistant', 'No form here.']);
    seedProject(db, 'stray-after-form', ['assistant', FORM], ['assistant', 'An unrendered <question-form> mention.']);
    seedProject(db, 'empty');
    const everything = listProjectsAwaitingInput(db);
    expect(everything).toEqual(new Set(['waiting', 'stray-after-form']));
    for (const id of ['waiting', 'answered', 'quiet', 'stray-after-form', 'empty', 'no-such-project']) {
      expect(listProjectsAwaitingInput(db, id)).toEqual(everything.has(id) ? new Set([id]) : new Set());
    }
  });
});

describe('listConversationsAwaitingInput scoped to one project', () => {
  // The sidebar's "needs you" mark reads this on every conversation-list load.
  it('answers what the unscoped read answers for that project, without reading other projects', () => {
    const db = openFixture();
    seedProject(db, 'waiting', ['assistant', FORM]);
    seedProject(db, 'answered', ['assistant', FORM], ['user', 'Left.']);
    seedProject(db, 'unrelated', ['assistant', `unrelated ${FORM}`]);
    const everything = listConversationsAwaitingInput(db);
    expect(everything).toEqual(new Set(['conversation-waiting', 'conversation-unrelated']));
    const evaluated: string[] = [];
    db.function('lower', (value: string) => {
      evaluated.push(value);
      return value.toLowerCase();
    });
    expect(listConversationsAwaitingInput(db, 'waiting')).toEqual(new Set(['conversation-waiting']));
    expect(listConversationsAwaitingInput(db, 'answered')).toEqual(new Set());
    expect(evaluated.some((content) => content.startsWith('unrelated'))).toBe(false);
  });
});

describe('GET /api/runs — awaiting-input query scope', () => {
  async function startRoutes(db: ReturnType<typeof openDatabase>) {
    const runs = ['requested', 'unrelated'].map((projectId) => ({
      id: `run-${projectId}`,
      projectId,
      status: 'succeeded',
      clients: new Set(),
    }));
    const app = express();
    registerRunRoutes(app, {
      db,
      design: {
        runs: {
          list: ({ projectId }: { projectId?: unknown }) =>
            runs.filter((run) => typeof projectId !== 'string' || run.projectId === projectId),
          statusBody: (run: { id: string; projectId: string }) => ({ id: run.id, projectId: run.projectId }),
          isTerminal: () => true,
        },
        analytics: { capture: () => {} },
        getAppVersion: () => 'test',
      },
      http: {
        createSseResponse: () => ({ send() {}, end() {}, cleanup() {} }),
        sendApiError: (res: any, status: number, code: string, message: string) =>
          res.status(status).json({ error: { code, message } }),
      },
      paths: { PROJECTS_DIR: directory, RUNTIME_DATA_DIR: directory },
      agents: { detectAgents: async () => [], getAgentDef: () => null },
      chat: { startChatRun: async () => undefined },
      byokCredentials: { has: async () => false },
      lifecycle: { isDaemonShuttingDown: () => false },
      plugins: {
        detectSkillPluginCandidateOnRunSuccess: () => {},
        firePipelineForRun: () => {},
        loadPluginRegistryView: async () => ({}),
        renderPluginBriefTemplate: (template: string) => template,
      },
      telemetry: {
        resolveRunProjectKindForAnalytics: () => null,
        runArtifactBaselines: { take: () => undefined },
        runRetryEventsForAnalytics: () => [],
      },
      messages: {
        pinAssistantMessageOnRunCreate: () => ({ ok: true }),
        reconcileAssistantMessageOnRunEnd: () => {},
      },
      authorizeProjectRequest: createAuthorizeProjectRequest({
        db,
        PROJECTS_DIR: directory!,
        getProject,
        sendApiError: (res: any, status: number, code: string, message: string) =>
          res.status(status).json({ error: { code, message } }),
      }),
      projectStore: {},
    } as any);
    const created = http.createServer(app);
    server = created;
    await new Promise<void>((resolve) => created.listen(0, resolve));
    const address = created.address();
    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  }

  it('asks only about the requested project on a project poll, and still about all without one', async () => {
    const db = openFixture();
    seedProject(db, 'requested', ['assistant', `requested ${FORM}`]);
    seedProject(db, 'unrelated', ['assistant', `unrelated ${FORM}`]);
    const baseUrl = await startRoutes(db);
    const evaluated: string[] = [];
    db.function('lower', (value: string) => {
      evaluated.push(value);
      return value.toLowerCase();
    });

    const scoped = await (await fetch(`${baseUrl}/api/runs?projectId=requested`)).json() as { awaitingInputProjectIds: string[] };
    expect(scoped.awaitingInputProjectIds).toEqual(['requested']);
    expect(evaluated.some((content) => content.startsWith('unrelated'))).toBe(false);

    const all = await (await fetch(`${baseUrl}/api/runs`)).json() as { awaitingInputProjectIds: string[] };
    expect([...all.awaitingInputProjectIds].sort()).toEqual(['requested', 'unrelated']);
  });
});
