import type { Express, Request, Response } from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerProjectExtensionRoutes, type RegisterProjectExtensionRoutesDeps } from '../src/routes/project-extensions.js';
import { resolveProjectExtensions } from '../src/services/project-extensions.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

async function harness() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'pixo-extension-route-'));
  folders.push(dataDir);
  const handlers = new Map<string, Handler>();
  const app = Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (url: string, ...route: unknown[]) => handlers.set(`${method} ${url}`, route.at(-1) as Handler)]));
  let local = true;
  let allowed = true;
  const sendApiError = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
  const authorize = vi.fn(async (_req: Request, res: Response) => { if (!allowed) sendApiError(res, 403, 'DENIED', 'project denied'); return allowed; });
  registerProjectExtensionRoutes(app as unknown as Express, {
    db: { prepare: () => ({ get: () => null }) },
    http: { requireLocalDaemonRequest: () => undefined, isLocalSameOrigin: () => local, resolvedPortRef: { current: 7456 }, sendApiError },
    paths: { RUNTIME_DATA_DIR: dataDir, USER_SKILLS_DIR: path.join(dataDir, 'user-skills'), SKILLS_DIR: path.join(dataDir, 'skills') },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'game-a' ? { id, metadata: {} } : null },
    resources: { listAllSkills: async () => [] },
    authorizeProjectRequest: authorize,
  } as unknown as RegisterProjectExtensionRoutesDeps);
  async function invoke(method: string, suffix = '', body: unknown = {}, projectId = 'game-a') {
    let status = 200;
    let output: unknown;
    const res = { status: (value: number) => { status = value; return res; }, json: (value: unknown) => { output = value; return res; } };
    const req = { params: { id: projectId, kind: 'mcp', extensionId: 'assets' }, body };
    await handlers.get(`${method} /api/projects/:id/extensions${suffix}`)!(req as unknown as Request, res as unknown as Response);
    return { status, output };
  }
  return { invoke, authorize, dataDir, setLocal: (value: boolean) => { local = value; }, setAllowed: (value: boolean) => { allowed = value; } };
}

describe('project extension route authorization', () => {
  it('rejects unknown projects and cross-origin mutations before changing extension state', async () => {
    const h = await harness();
    expect((await h.invoke('get', '', {}, 'unknown')).status).toBe(404);
    h.setLocal(false);
    expect((await h.invoke('post', '', { kind: 'mcp', server: { id: 'assets', transport: 'stdio', command: process.execPath, enabled: true } })).status).toBe(403);
    expect(h.authorize).not.toHaveBeenCalled();
    expect((await resolveProjectExtensions({ dataDir: h.dataDir, projectId: 'game-a', skillsRoots: [] })).mcpServers).toEqual([]);
  });

  it('honors denied project authority on reads and writes', async () => {
    const h = await harness();
    h.setAllowed(false);
    expect((await h.invoke('get')).status).toBe(403);
    expect((await h.invoke('post', '', { kind: 'mcp', server: { id: 'assets', transport: 'stdio', command: process.execPath, enabled: true } })).status).toBe(403);
    expect(h.authorize).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'game-a', { mode: 'write', capability: 'writeFiles' });
  });

  it('returns persisted metadata and never exposes MCP secrets in the listing', async () => {
    const h = await harness();
    const added = await h.invoke('post', '', { kind: 'mcp', server: { id: 'assets', transport: 'stdio', command: process.execPath, enabled: true, env: { TOKEN: 'private-fixture-value' } } });
    expect(added.status).toBe(201);
    expect(added.output).toMatchObject({ mcpServers: [{ id: 'assets', enabled: true }] });
    expect(JSON.stringify(added.output)).not.toContain('private-fixture-value');
    expect((await h.invoke('post', '/:kind/:extensionId', { action: 'disable' })).status).toBe(200);
    expect((await resolveProjectExtensions({ dataDir: h.dataDir, projectId: 'game-a', skillsRoots: [] })).mcpServers).toEqual([]);
    expect((await h.invoke('delete', '/:kind/:extensionId')).output).toMatchObject({ mcpServers: [] });
  });
});
