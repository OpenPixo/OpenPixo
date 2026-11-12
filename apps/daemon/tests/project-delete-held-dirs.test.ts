// Deleting a project must work while OpenPixo itself is holding its folder.
//
// Windows refuses to rename a directory while a descendant is open or a process
// runs inside it. An open project holds a watcher on every subfolder, and a
// running game or terminal keeps its working directory there, so the delete
// failed with EPERM/EBUSY and the project stayed. This drives the real route
// with the real watcher and the real staging rename, so these cases are only
// meaningful where the OS enforces the lock — the platform-independent mapping
// of a held folder to its error lives in project-delete-response.test.ts.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectAssetIndexer } from '../src/assets/indexer.js';
import { closeDatabase, deleteProject as dbDeleteProject, getProject, insertProject, openDatabase } from '../src/db.js';
import { _activeWatcherCount, _resetForTests, subscribe } from '../src/project-watchers.js';
import { resolveProjectDir, stageProjectDirsForDelete } from '../src/projects.js';
import { registerProjectRoutes, type RegisterProjectRoutesDeps } from '../src/routes/project/index.js';

type Db = ReturnType<typeof openDatabase>;
const proxy = (known: Record<string, unknown> = {}) =>
  new Proxy(known, { get: (target, key) => (key in target ? target[key as string] : vi.fn()) });

function spawnInside(cwd: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'console.log("up"); setTimeout(() => {}, 60000)'], {
    cwd, stdio: ['ignore', 'pipe', 'ignore'],
  });
  return new Promise((resolve, reject) => {
    child.stdout?.once('data', () => resolve(child));
    child.once('error', reject);
  });
}
const stopped = (child: ChildProcess) => new Promise<void>((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve();
  child.once('exit', () => resolve());
  child.kill();
});

describe.runIf(process.platform === 'win32')('DELETE project while its folder is held on Windows', () => {
  let root: string;
  let projectsDir: string;
  let db: Db;
  let server: ReturnType<express.Express['listen']> | null = null;
  let base = '';
  const children: ChildProcess[] = [];
  const releaseHolds = vi.fn(async (_projectId: string) => {});
  const streams: AbortController[] = [];

  function makeProject(id: string, metadata?: Record<string, unknown>): string {
    const now = Date.now();
    insertProject(db, { id, name: id, createdAt: now, updatedAt: now, ...(metadata ? { metadata } : {}) });
    const dir = path.join(projectsDir, id);
    mkdirSync(path.join(dir, 'assets', 'sprites'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), '<canvas></canvas>');
    writeFileSync(path.join(dir, 'assets', 'sprites', 'hero.png'), 'png');
    return dir;
  }

  async function openProjectEvents(id: string) {
    const controller = new AbortController();
    streams.push(controller);
    const res = await fetch(`${base}/api/projects/${id}/events`, { signal: controller.signal });
    const reader = res.body!.getReader();
    // `ready` means chokidar finished its initial scan: every subfolder is held.
    let seen = '';
    while (!seen.includes('ready')) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    return reader;
  }

  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'pixo-delete-held-'));
    projectsDir = path.join(root, 'projects');
    mkdirSync(projectsDir, { recursive: true });
    db = openDatabase(root, { dataDir: root });
    releaseHolds.mockReset();
    releaseHolds.mockImplementation(async () => {});
    const app = express();
    app.use(express.json());
    registerProjectRoutes(app, {
      db,
      design: { runs: { list: () => [] } },
      http: {
        sendApiError: (res: Response, status: number, code: string, message: string) =>
          res.status(status).json({ error: { code, message } }),
        createSseResponse: (res: Response) => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          return {
            send: (event: string) => res.write(`event: ${event}\ndata: {}\n\n`),
            end: () => res.end(),
            cleanup: () => {},
          };
        },
      },
      paths: { PROJECTS_DIR: projectsDir, RUNTIME_DATA_DIR: root, RUNTIME_DATA_DIR_CANONICAL: root, SKILLS_DIR: root },
      projectStore: proxy({
        insertProject, getProject, dbDeleteProject,
        stageProjectDirsForDelete: (dir: string, ids: string[], batch: string, options: { beforeRetry?: () => Promise<void> }) =>
          stageProjectDirsForDelete(dir, ids, batch, { ...options, retryDelaysMs: [10, 50, 100, 200, 400] }),
      }),
      projectFiles: proxy({ resolveProjectDir }),
      conversations: proxy(), templates: proxy(), status: proxy(), telemetry: {},
      events: { subscribeFileEvents: subscribe, activeProjectEventSinks: new Map() },
      projectHolds: { release: releaseHolds },
      ids: { randomId: () => `rid-${Math.random().toString(36).slice(2)}` },
      appConfig: proxy(), agents: {}, validation: proxy(),
      authorizeProjectRequest: async () => true,
    } as unknown as RegisterProjectRoutesDeps);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const stream of streams.splice(0)) stream.abort();
    await Promise.all(children.splice(0).map(stopped));
    await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
    server = null;
    await _resetForTests();
    closeDatabase();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('deletes a plain project', async () => {
    const dir = makeProject('plain');
    const res = await fetch(`${base}/api/projects/plain`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(existsSync(dir)).toBe(false);
    expect(getProject(db, 'plain')).toBeNull();
  });

  it('deletes the project that is open right now', async () => {
    const dir = makeProject('open');
    await openProjectEvents('open');
    expect(_activeWatcherCount()).toBe(1);

    const res = await fetch(`${base}/api/projects/open`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(existsSync(dir)).toBe(false);
    expect(getProject(db, 'open')).toBeNull();
    expect(_activeWatcherCount()).toBe(0);
  });

  it('deletes a project whose game or terminal is still running', async () => {
    const dir = makeProject('running');
    const game = await spawnInside(dir);
    const terminal = await spawnInside(path.join(dir, 'assets'));
    children.push(game, terminal);
    releaseHolds.mockImplementation(async () => {
      await Promise.all([stopped(game), stopped(terminal)]);
    });

    const res = await fetch(`${base}/api/projects/running`, { method: 'DELETE' });

    expect(releaseHolds).toHaveBeenCalledWith('running');
    expect(res.status).toBe(200);
    expect(existsSync(dir)).toBe(false);
    expect(getProject(db, 'running')).toBeNull();
  });

  it('deletes a project the asset index is watching, even with nothing open', async () => {
    const dir = makeProject('indexed');
    const indexer = new ProjectAssetIndexer({ db, projectsRoot: projectsDir });
    try {
      await indexer.mediaAssetCount('indexed');
      await indexer.watchingReady('indexed');
      expect(() => renameSync(dir, `${dir}-moved`)).toThrow(/EPERM/);
      releaseHolds.mockImplementation((id) => indexer.release(id));

      const res = await fetch(`${base}/api/projects/indexed`, { method: 'DELETE' });

      expect(res.status).toBe(200);
      expect(existsSync(dir)).toBe(false);
    } finally {
      await indexer.close();
    }
  });

  it('keeps everything and says why when another program holds the folder', async () => {
    const dir = makeProject('foreign');
    children.push(await spawnInside(dir));

    const res = await fetch(`${base}/api/projects/foreign`, { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('PROJECT_FILES_IN_USE');
    expect(getProject(db, 'foreign')).not.toBeNull();
    expect(readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('<canvas></canvas>');
  });

  it('lets the project reopen its live file events after a refused delete', async () => {
    const dir = makeProject('reopen');
    children.push(await spawnInside(dir));
    await openProjectEvents('reopen');

    const refused = await fetch(`${base}/api/projects/reopen`, { method: 'DELETE' });
    expect(refused.status).toBe(409);

    await openProjectEvents('reopen');
    expect(_activeWatcherCount()).toBe(1);
  });

  it('never touches the folder an imported project points at', async () => {
    const userFolder = path.join(root, 'my-own-game');
    mkdirSync(path.join(userFolder, 'scenes'), { recursive: true });
    writeFileSync(path.join(userFolder, 'scenes', 'main.tscn'), 'scene');
    makeProject('imported', { kind: 'prototype', baseDir: userFolder });
    await openProjectEvents('imported');
    children.push(await spawnInside(userFolder));

    const res = await fetch(`${base}/api/projects/imported`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(getProject(db, 'imported')).toBeNull();
    expect(readFileSync(path.join(userFolder, 'scenes', 'main.tscn'), 'utf8')).toBe('scene');
  });
});
