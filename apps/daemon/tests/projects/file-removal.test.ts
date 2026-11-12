import express from 'express';
import type http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { closeDatabase, getProject, insertProject, openDatabase } from '../../src/db.js';
import * as projectFiles from '../../src/projects.js';
import { ensureWorkspaceArtifactForPath, getWorkspaceArtifact } from '../../src/chat-artifacts/store.js';
import { createProjectMutations } from '../../src/projects/mutations.js';
import { registerProjectFileRoutes } from '../../src/routes/project/index.js';

let root: string;
let server: http.Server | undefined;
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  closeDatabase();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(remove: typeof projectFiles.deleteProjectFile) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'decouple-file-removal-'));
  const projects = path.join(root, 'projects');
  const db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'p', name: 'Local game', createdAt: 1, updatedAt: 1 });
  await projectFiles.ensureProject(projects, 'p');
  for (const name of ['a.html', 'b.html']) await projectFiles.writeProjectFile(projects, 'p', name, Buffer.from(name));
  const identity = ensureWorkspaceArtifactForPath(db, { projectId: 'p', path: 'a.html', kind: 'html' }).id;
  const app = express(); app.use(express.json());
  registerProjectFileRoutes(app, {
    db, paths: { PROJECTS_DIR: projects }, projectStore: { getProject },
    projectFiles: { ...projectFiles, deleteProjectFile: remove },
    publicFileMutations: createProjectMutations(),
    node: { fs }, uploads: {}, documents: {}, artifacts: {}, projectPreviewScopes: {},
    http: { sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
  } as unknown as Parameters<typeof registerProjectFileRoutes>[1]);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing listener');
  return { db, projects, identity, remove: (name: string) => fetch(`http://127.0.0.1:${address.port}/api/projects/p/files/${name}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) }) };
}

it('preserves source bytes and identity when the filesystem refuses deletion', async () => {
  const failed = vi.fn(async () => { throw Object.assign(new Error('local permission denied'), { code: 'EACCES' }); });
  const f = await fixture(failed);
  expect((await f.remove('a.html')).status).toBe(400);
  expect(fs.readFileSync(path.join(f.projects, 'p', 'a.html'), 'utf8')).toBe('a.html');
  expect(getWorkspaceArtifact(f.db, f.identity)?.deletedAt).toBeNull();
  expect(failed).toHaveBeenCalledOnce();
});

it('holds the whole HTTP deletion in its project lane and tombstones only completed removals', async () => {
  const entered = deferred(), release = deferred();
  const calls: string[] = [];
  const f = await fixture(async (...args) => {
    calls.push(args[2]);
    if (args[2] === 'a.html') { entered.resolve(); await release.promise; }
    return projectFiles.deleteProjectFile(...args);
  });
  const first = f.remove('a.html'); await entered.promise;
  const second = f.remove('b.html');
  expect(calls).toEqual(['a.html']);
  expect(getWorkspaceArtifact(f.db, f.identity)?.deletedAt).toBeNull();
  release.resolve();
  expect((await first).status).toBe(200); expect((await second).status).toBe(200);
  expect(calls).toEqual(['a.html', 'b.html']);
  expect(getWorkspaceArtifact(f.db, f.identity)?.deletedAt).not.toBeNull();
});
