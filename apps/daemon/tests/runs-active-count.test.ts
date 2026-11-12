// `GET /api/runs/active-count` is the desktop updater's restart-safety probe.
//
// The unscoped `GET /api/runs` listing answers 400 PROJECT_SCOPE_REQUIRED as
// soon as any run belongs to a Workspace-bound project, so a host-level caller
// that only needs "is anything still running?" could never get an answer for
// Workspace users. The count route answers exactly that, without widening the
// listing: it is loopback-only and never names a run, project or conversation.

import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { closeDatabase, insertProject, openDatabase } from '../src/db.js';
import { registerRunRoutes } from '../src/routes/runs.js';

let server: http.Server | null = null;
let tempDir: string | null = null;

afterEach(async () => {
  if (server) {
    const toClose = server;
    server = null;
    await new Promise<void>((resolve) => toClose.close(() => resolve()));
  }
  closeDatabase();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

const TEAM_PROJECT = 'p-team-active-count';
const UNBOUND_PROJECT = 'p-unbound-active-count';
const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

function sendApiError(
  res: any,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return res.status(status).json({ error: { code, message, ...details } });
}

async function startServer(includeInvalidProjects = false) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixo-runs-active-count-'));
  const db = openDatabase(tempDir);
  const now = Date.now();
  for (const id of [TEAM_PROJECT, UNBOUND_PROJECT]) {
    insertProject(db, { id, name: id, createdAt: now, updatedAt: now });
  }


  const runs = new Map<string, any>();
  const seed = (id: string, projectId: string, agentId: string, status: string) =>
    runs.set(id, { id, projectId, agentId, status, conversationId: `conv-${id}`, events: [], clients: new Set() });
  seed('run-team-amr-running', TEAM_PROJECT, 'amr', 'running');
  seed('run-unbound-queued', UNBOUND_PROJECT, 'claude', 'queued');
  seed('run-unbound-done', UNBOUND_PROJECT, 'claude', 'succeeded');
  if (includeInvalidProjects) {
    insertProject(db, { id: 'invalid-local-root', name: 'Invalid', metadata: { baseDir: 'relative-root' }, createdAt: now, updatedAt: now });
    seed('run-invalid-root', 'invalid-local-root', 'claude', 'succeeded');
    seed('run-missing-project', 'missing-local-project', 'claude', 'succeeded');
  }

  const runsService = {
    get: (id: string) => runs.get(id) ?? null,
    list: (filters: { projectId?: unknown; status?: unknown } = {}) =>
      Array.from(runs.values()).filter(
        (run) =>
          (typeof filters.projectId !== 'string' || run.projectId === filters.projectId)
          && (filters.status !== 'active' || !TERMINAL.has(run.status)),
      ),
    statusBody: (run: any) => ({ ...run }),
    isTerminal: (status: string) => TERMINAL.has(status),
  };

  const app = express();
  app.use(express.json());
  registerRunRoutes(app, {
    db,
    design: {
      runs: runsService,
      analytics: { capture: () => {} },
      getAppVersion: () => 'test',
    },
    http: {
      createSseResponse: () => ({ send() {}, end() {}, cleanup() {} }),
      sendApiError,
    },
    paths: { PROJECTS_DIR: tempDir, RUNTIME_DATA_DIR: tempDir },
    agents: { detectAgents: async () => [], getAgentDef: () => null },
    chat: { startChatRun: async () => undefined },
    byokCredentials: { has: async () => false },
    lifecycle: { isDaemonShuttingDown: () => false },
    plugins: {
      detectSkillPluginCandidateOnRunSuccess: () => {},
      firePipelineForRun: () => {},
      loadPluginRegistryView: async () => ({} as any),
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

    projectStore: {


    },
  } as any);
  const created = http.createServer(app);
  server = created;
  await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', resolve));
  const address = created.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, port };
}

// `fetch` cannot override Host, so spoofed-authority cases go through
// `http.request`, which sends the header verbatim.
function rawGet(port: number, pathname: string, headers: Record<string, string>) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method: 'GET', headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/runs/active-count', () => {
  it('filters records with a missing project or an invalid local storage root', async () => {
    const { baseUrl } = await startServer(true);
    const response = await fetch(`${baseUrl}/api/runs`);
    expect(response.status).toBe(200);
    const body = await response.json() as { runs: Array<{ id: string }> };
    expect(body.runs).toHaveLength(3);
    expect(body.runs.map(run => run.id)).not.toContain('run-invalid-root');
    expect(body.runs.map(run => run.id)).not.toContain('run-missing-project');
  });
  it('counts active runs across local projects', async () => {
    const { baseUrl } = await startServer();

    // Every listed row still passes the local project-storage gate; the
    // missing-project/invalid-root case above verifies that boundary.
    const listing = await fetch(`${baseUrl}/api/runs?status=active`);
    expect(listing.status).toBe(200);
    expect(((await listing.json()) as any).runs).toHaveLength(2);

    const response = await fetch(`${baseUrl}/api/runs/active-count`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ activeRunCount: 2 });
  });

  it('reveals no run, project or conversation identifiers', async () => {
    const { baseUrl } = await startServer();
    const text = await (await fetch(`${baseUrl}/api/runs/active-count`)).text();
    for (const leaked of ['run-', TEAM_PROJECT, UNBOUND_PROJECT, 'conv-', 'amr']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('refuses a non-loopback Host (DNS rebinding) or a foreign Origin', async () => {
    const { port } = await startServer();

    const rebound = await rawGet(port, '/api/runs/active-count', { host: `attacker.example:${port}` });
    expect(rebound.status).toBe(403);
    expect(rebound.body).not.toContain('activeRunCount');

    const crossOrigin = await rawGet(port, '/api/runs/active-count', {
      host: `127.0.0.1:${port}`,
      origin: 'https://attacker.example',
    });
    expect(crossOrigin.status).toBe(403);

    const local = await rawGet(port, '/api/runs/active-count', {
      host: `localhost:${port}`,
      origin: `http://localhost:${port}`,
    });
    expect(local.status).toBe(200);
    expect(JSON.parse(local.body)).toEqual({ activeRunCount: 2 });
  });
});
