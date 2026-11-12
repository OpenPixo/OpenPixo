import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import type { ApiErrorResponse, GameTuningListResponse, GameTuningSetResponse } from '@openpixo/contracts';
import { expect, it, vi } from 'vitest';
import { sendApiError } from '../../src/http/api-errors.js';
import { registerGameTuningRoutes, type RegisterGameTuningRoutesDeps } from '../../src/routes/game-tuning.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

const { getProject, resolveProjectDir } = vi.hoisted(() => ({ getProject: vi.fn(), resolveProjectDir: vi.fn() }));
vi.mock('../../src/db.js', () => ({ getProject }));
vi.mock('../../src/projects.js', () => ({ resolveProjectDir }));

it('serves discovery, authorizes file edits, checkpoints, and reports stale HTTP writes as conflicts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-t8-route-'));
  await writeFile(path.join(root, 'player.gd'), '@export_range(0, 600, 10) var speed: float = 220.0 # keep\n');
  getProject.mockReturnValue({ id: 'game', metadata: { baseDir: root } }); resolveProjectDir.mockReturnValue(root);
  const authorizeProjectRequest = vi.fn(async () => true);
  const authorizeProjectToolRequest = vi.fn(async () => ({ projectId: 'game' }));
  const local = vi.fn(() => true);
  const app = express(); app.use(express.json());
  registerGameTuningRoutes(app, {
    db: {}, paths: { PROJECTS_DIR: root, RUNTIME_DATA_DIR: root }, authorizeProjectRequest, authorizeProjectToolRequest,
    http: { sendApiError, requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(), isLocalSameOrigin: local, resolvedPortRef: { current: 0 } },
  } as unknown as RegisterGameTuningRoutesDeps);
  const server = app.listen(0, '127.0.0.1');
  const grants: string[] = [];
  try {
    await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
    const url = `http://127.0.0.1:${address.port}/api/projects/game/game/tuning`;
    const listResponse = await fetch(url);
    expect(listResponse.headers.get('cache-control')).toBe('no-store');
    const list = await listResponse.json() as GameTuningListResponse; const item = list.parameters[0]!;
    expect(item).toMatchObject({ value: 220, filePath: 'player.gd', line: 1 });
    const patch = (body: unknown, token?: string) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const request = { id: item.id, value: 260, fileHash: item.fileHash };
    const edited = await patch(request); expect(edited.status).toBe(200);
    expect((await edited.json() as GameTuningSetResponse).parameter.value).toBe(260);
    expect(authorizeProjectRequest).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'game', { mode: 'write', capability: 'writeFiles' });
    expect(await readFile(path.join(root, 'player.gd'), 'utf8')).toBe('@export_range(0, 600, 10) var speed: float = 260.0 # keep\n');
    const stale = await patch(request); expect(stale.status).toBe(409); expect((await stale.json() as ApiErrorResponse).error.code).toBe('TUNING_CONFLICT');
    const invalid = await patch({ ...request, value: { expression: 'quit()' } }); expect(invalid.status).toBe(400);
    local.mockReturnValue(false); expect((await patch(request)).status).toBe(403); local.mockReturnValue(true);
    for (const [projectId, expected] of [['other', 403], ['game', 200]] as const) {
      const grant = toolTokenRegistry.mint({ runId: 'tuning-test', projectId,
        allowedEndpoints: ['/api/projects/:id/game/tuning'], allowedOperations: ['game:tuning:read'] });
      grants.push(grant.token);
      expect((await fetch(url, { headers: { authorization: `Bearer ${grant.token}` } })).status).toBe(expected);
      // A read grant cannot be reused for mutation.
      expect((await patch(request, grant.token)).status).toBe(403);
    }
  } finally {
    for (const token of grants) toolTokenRegistry.revokeToken(token, 'manual');
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
