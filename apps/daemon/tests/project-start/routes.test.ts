import Database from 'better-sqlite3';
import type { Express, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProject, updateProject } from '../../src/db.js';
import { registerProjectNextStepsRoutes } from '../../src/routes/project-next-steps.js';
import type { ProjectStarterFacts } from '../../src/project-start/next-steps.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

vi.mock('../../src/project-start/facts.js', () => ({ readProjectStarterFacts: vi.fn() }));
const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  toolTokenRegistry.clear();
});
function fixture() {
  const db = new Database(':memory:'); databases.push(db);
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, skill_id TEXT, design_system_id TEXT,
    pending_prompt TEXT, metadata_json TEXT, applied_plugin_snapshot_id TEXT, custom_instructions TEXT,
    created_at INTEGER, updated_at INTEGER)`);
  db.prepare('INSERT INTO projects(id, name, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 0, 0)')
    .run('game', 'Game', JSON.stringify({ kind: 'other', baseDir: 'unused-folder', imageModel: 'existing-model' }));
  const get = vi.fn(); const post = vi.fn(); const gate = vi.fn();
  const authorize = vi.fn(async (_req: Request, _res: Response, _projectId: string, _options: unknown) => true);
  const authorizeTool = vi.fn(async (_res: Response, projectId: string, _options: unknown): Promise<{ readonly projectId: string } | null> => ({ projectId }));
  const sameOrigin = vi.fn(() => true);
  const facts = vi.fn(async (): Promise<ProjectStarterFacts> => ({ profile: { engine: 'unknown', detectorVersion: 1, confidence: 'unknown',
    evidence: [], languages: [], assetRoots: [], importMetadata: 'none', commands: {}, tools: [], detectedAt: 1 },
    doctor: { checks: [] }, hasSucceededAgentRun: false, mediaAssetCount: 0, latestVerify: null }));
  registerProjectNextStepsRoutes({ get, post } as unknown as Express, {
    db, paths: { RUNTIME_DATA_DIR: 'unused-data-root', ARTIFACTS_DIR: 'unused-artifact-root', PROJECTS_DIR: 'unused-project-root', PROJECT_ROOT: 'unused-repo-root' },
    http: { requireLocalDaemonRequest: gate, isLocalSameOrigin: sameOrigin, resolvedPortRef: { current: 0 },
      sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    authorizeProjectRequest: authorize, authorizeProjectToolRequest: authorizeTool, facts,
  });
  const read = get.mock.calls[0]![2]; const dismiss = post.mock.calls[0]![2];
  const request = (overrides: { headers?: Record<string, string>; params?: Record<string, string>; body?: unknown } = {}) => {
    const headers = overrides.headers ?? {};
    return { params: { id: 'game' }, route: { path: '/api/projects/:id/next-steps' }, ...overrides,
      headers, get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
  };
  function response() {
    const res = { status: vi.fn(), setHeader: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
    return res;
  }
  return { db, get, post, gate, authorize, authorizeTool, sameOrigin, facts, read, dismiss, request, response };
}

describe('project starter next-steps routes', () => {
  it('registers both endpoints with the local daemon request gate and reads facts without caching', async () => {
    const f = fixture(); const res = f.response();
    expect(f.get.mock.calls[0]!.slice(0, 2)).toEqual(['/api/projects/:id/next-steps', f.gate]);
    expect(f.post.mock.calls[0]!.slice(0, 2)).toEqual(['/api/projects/:id/next-steps/dismiss', f.gate]);
    await f.read(f.request(), res);
    expect(f.authorize).toHaveBeenCalledWith(expect.anything(), res, 'game', { mode: 'read' });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'game', dismissed: false, steps: expect.any(Array) }));
    await f.read(f.request(), f.response()); expect(f.facts).toHaveBeenCalledTimes(2);
  });
  it('persists dismissal in existing metadata and merges preferences changed during async fact loading', async () => {
    const f = fixture(); const res = f.response();
    const initial = await f.facts();
    f.facts.mockImplementationOnce(async () => {
      updateProject(f.db, 'game', { metadata: { ...getProject(f.db, 'game')!.metadata, audioModel: 'new-audio-model' } });
      return initial;
    });
    await f.dismiss(f.request({ body: {} }), res);
    expect(f.authorize).toHaveBeenCalledWith(expect.anything(), res, 'game', { mode: 'write', capability: 'writeFiles' });
    expect(getProject(f.db, 'game')!.metadata).toMatchObject({ starterChecklistDismissed: true, imageModel: 'existing-model', audioModel: 'new-audio-model' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ dismissed: true }));
    const read = f.response(); await f.read(f.request(), read);
    expect(read.json).toHaveBeenCalledWith(expect.objectContaining({ dismissed: true }));
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([{ name: 'projects' }]);
  });
  it('rejects missing projects, denied project access and cross-origin dismissal before loading facts', async () => {
    const f = fixture(); const missing = f.response();
    await f.read(f.request({ params: { id: 'missing' } }), missing); expect(missing.status).toHaveBeenCalledWith(404);
    f.authorize.mockImplementationOnce(async (_req, res) => { res.status(403).json({ error: 'denied' }); return false; });
    const denied = f.response(); await f.read(f.request(), denied); expect(denied.status).toHaveBeenCalledWith(403);
    f.sameOrigin.mockReturnValue(false);
    const foreign = f.response(); await f.dismiss(f.request(), foreign); expect(foreign.status).toHaveBeenCalledWith(403);
    expect(f.facts).not.toHaveBeenCalled(); expect(getProject(f.db, 'game')!.metadata.starterChecklistDismissed).toBeUndefined();
  });
  it('allows the CLI to read facts with a valid token scoped to this project', async () => {
    const f = fixture(); const res = f.response();
    const grant = toolTokenRegistry.mint({ runId: 'run-1', projectId: 'game' });
    await f.read(f.request({ headers: { authorization: `Bearer ${grant.token}` } }), res);
    expect(f.authorizeTool).toHaveBeenCalledWith(res, 'game', { mode: 'read' });
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.facts).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'game', dismissed: false }));
  });
  it.each(['invalid', 'expired', 'other-project', 'endpoint-denied', 'operation-denied'] as const)('rejects %s agent grants before reading facts', async reason => {
    const f = fixture(); const res = f.response();
    const grant = toolTokenRegistry.mint({ runId: 'run-1', projectId: reason === 'other-project' ? 'other-game' : 'game',
      ...(reason === 'expired' ? { nowMs: 1, ttlMs: 1 } : {}),
      ...(reason === 'endpoint-denied' ? { allowedEndpoints: ['/api/projects/:id/assets'] } : {}),
      ...(reason === 'operation-denied' ? { allowedOperations: ['asset:read'] } : {}),
    });
    const token = reason === 'invalid' ? 'pixott_invalid' : grant.token;
    await f.read(f.request({ headers: { authorization: `Bearer ${token}` } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(f.authorizeTool).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.facts).not.toHaveBeenCalled();
  });
  it('honors project storage denial after validating an agent grant', async () => {
    const f = fixture(); const res = f.response();
    const grant = toolTokenRegistry.mint({ runId: 'run-1', projectId: 'game' });
    f.authorizeTool.mockImplementationOnce(async res => { res.status(403).json({ error: 'denied' }); return null; });
    await f.read(f.request({ headers: { authorization: `Bearer ${grant.token}` } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(f.facts).not.toHaveBeenCalled();
  });
  it('keeps scoped agents from dismissing the local user preference and rejects fabricated completion input', async () => {
    const f = fixture(); const agent = f.response();
    const grant = toolTokenRegistry.mint({ runId: 'run-1', projectId: 'game' });
    await f.dismiss(f.request({ headers: { authorization: `Bearer ${grant.token}` } }), agent); expect(agent.status).toHaveBeenCalledWith(403);
    const progress = f.response(); await f.dismiss(f.request({ body: { done: true } }), progress); expect(progress.status).toHaveBeenCalledWith(400);
    expect(f.facts).not.toHaveBeenCalled();
    expect(getProject(f.db, 'game')!.metadata.starterChecklistDismissed).toBeUndefined();
  });
});
