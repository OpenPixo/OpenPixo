import type { Express, Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerProjectRoutes } from '../../src/routes/project/index.js';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function proxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, { get: (target, key) => key in target ? target[key as string] : vi.fn() });
}
function fixture(options: { deleteFails?: boolean; stageFails?: boolean | string; order?: string[] } = {}) {
  let handler!: RequestHandler;
  const app = proxy({ delete: (route: string | RegExp, callback: RequestHandler) => {
    if (route === '/api/projects/:id') handler = callback;
  } }) as unknown as Express;
  const entered = deferred();
  const finished = deferred();
  const cleanup = vi.fn(async () => { entered.resolve(); await finished.promise; });
  const rollback = vi.fn(async () => {});
  const stage = vi.fn(async () => {
    options.order?.push('stage');
    if (typeof options.stageFails === 'string') throw Object.assign(new Error('held'), { code: options.stageFails });
    if (options.stageFails) throw new Error('folder is locked');
    return { commit: cleanup, rollback };
  });
  const sendApiError = vi.fn((res: Response, status: number) => res.status(status).json({ ok: false }));
  const deleteRow = vi.fn(() => { if (options.deleteFails) throw new Error('database is unavailable'); });
  registerProjectRoutes(app, {
    db: {}, design: { runs: { list: () => [] } },
    http: { sendApiError },
    projectHolds: { release: async () => { options.order?.push('release holds'); } },
    paths: { PROJECTS_DIR: 'managed-projects', SKILLS_DIR: '' },
    projectStore: proxy({ getProject: () => ({ id: 'project-a', metadata: { baseDir: 'external-user-folder' } }),
      dbDeleteProject: deleteRow, stageProjectDirsForDelete: stage, removeProjectDir: cleanup }),
    projectFiles: proxy(), conversations: proxy(), templates: proxy(), status: proxy(), events: proxy(),
    ids: { randomId: () => 'delete-batch' }, appConfig: proxy(), agents: {}, validation: proxy(),
    authorizeProjectRequest: async () => true,
  } as unknown as Parameters<typeof registerProjectRoutes>[1]);
  const json = vi.fn(); const status = vi.fn(); const response = { json, status };
  status.mockReturnValue(response);
  const invoke = () => Promise.resolve(handler({ params: { id: 'project-a' } } as unknown as Request,
    response as unknown as Response, vi.fn()));
  return { invoke, json, status, entered, finished, cleanup, rollback, stage, deleteRow, sendApiError };
}
describe('DELETE project response', () => {
  it('answers while recursive cleanup is still pending', async () => {
    const f = fixture(); const request = f.invoke();
    try {
      await f.entered.promise;
      expect(f.json).toHaveBeenCalledWith({ ok: true });
      expect(f.deleteRow).toHaveBeenCalledOnce();
      // Imported user folders are never passed to managed-directory cleanup.
      expect(f.stage).toHaveBeenCalledWith('managed-projects', ['project-a'], 'delete-batch', expect.anything());
    } finally { f.finished.resolve(); await request; }
  });
  it('restores detached files if deleting the database row fails', async () => {
    const f = fixture({ deleteFails: true }); await f.invoke();
    expect(f.rollback).toHaveBeenCalledOnce();
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.status).toHaveBeenCalledWith(400);
  });
  it('keeps the database row if its directory cannot be detached', async () => {
    const f = fixture({ stageFails: true }); f.finished.resolve(); await f.invoke();
    expect(f.deleteRow).not.toHaveBeenCalled();
    expect(f.status).toHaveBeenCalledWith(400);
  });
  it('answers with its own error when another program holds the folder', async () => {
    const f = fixture({ stageFails: 'PROJECT_FILES_IN_USE' }); f.finished.resolve(); await f.invoke();
    expect(f.deleteRow).not.toHaveBeenCalled();
    expect(f.sendApiError).toHaveBeenCalledWith(expect.anything(), 409, 'PROJECT_FILES_IN_USE', expect.any(String));
  });
  it('stops what the project runs before detaching its folder', async () => {
    const order: string[] = [];
    const f = fixture({ order }); const request = f.invoke();
    try {
      await f.entered.promise;
      expect(order).toEqual(['release holds', 'stage']);
    } finally { f.finished.resolve(); await request; }
  });
});
