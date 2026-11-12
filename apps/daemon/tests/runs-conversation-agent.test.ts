import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { closeDatabase, insertConversation, insertProject, openDatabase, upsertMessage } from '../src/db.js';
import { writeAppConfig } from '../src/app-config.js';
import { registerRunRoutes, type RegisterRunRoutesDeps } from '../src/routes/runs.js';

let server: Server | undefined;
let root: string | undefined;
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  closeDatabase();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

it.each([
  [undefined, true, true, 'codex'],
  [undefined, false, true, 'codex'],
  ['opencode', true, true, 'opencode'],
  [undefined, true, false, 'claude'],
  [undefined, true, 'retired', 'claude'],
] as const)('selects the conversation agent through POST /api/runs (explicit=%s, conversation=%s, history=%s)', async (agentId, withConversation, history, expected) => {
  root = mkdtempSync(path.join(tmpdir(), 'pixo-run-agent-'));
  const db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'project', name: 'Game', createdAt: 1, updatedAt: 1 });
  insertConversation(db, { id: 'conversation', projectId: 'project', title: 'Game', createdAt: 1, updatedAt: 1 });
  if (history) upsertMessage(db, 'conversation', { id: 'previous', role: 'assistant', content: 'Done', agentId: history === 'retired' ? 'pi' : 'codex', runId: 'previous-run', runStatus: 'succeeded', startedAt: 1, endedAt: 2 });
  await writeAppConfig(root, { agentId: 'claude' });
  // Reused preparation observes the real HTTP defaulting path without starting a runtime.
  const prepare = vi.fn(({ meta }: { meta: Record<string, unknown> }) => ({ kind: 'reused', run: { ...meta, id: 'run' } }));
  const sendApiError: RegisterRunRoutesDeps['http']['sendApiError'] = (res, status, code, message) => res.status(status).json({ error: { code, message } });
  const app = express(); app.use(express.json());
  registerRunRoutes(app, {
    db,
    design: { runs: { statusBody: (run: unknown) => run } },
    internalRuns: { prepare },
    http: { sendApiError },
    paths: { PROJECTS_DIR: root, RUNTIME_DATA_DIR: root, BUNDLED_PLUGINS_DIR: path.join(root, 'plugins') },
    // Deliberately unavailable Codex: history must not silently switch runtimes.
    agents: { detectAgents: async () => [{ id: 'claude', available: true }], getAgentDef: () => null },
    chat: {}, lifecycle: { isDaemonShuttingDown: () => false },
    plugins: { loadPluginRegistryView: async () => ({}), renderPluginBriefTemplate: () => '' },
    telemetry: {}, messages: {},
  } as unknown as RegisterRunRoutesDeps);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'project', ...(withConversation ? { conversationId: 'conversation' } : {}), ...(agentId ? { agentId } : {}), message: 'Continue' }),
  });
  expect(response.status, await response.text()).toBe(202);
  expect(prepare.mock.calls[0]?.[0].meta).toMatchObject({ agentId: expected, conversationId: 'conversation' });
});
