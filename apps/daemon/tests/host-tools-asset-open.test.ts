import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { registerHostToolsRoutes, type RegisterHostToolsRoutesDeps } from '../src/routes/host-tools.js';

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { unref() {} });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  }),
}));
vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(),
  access: async () => undefined,
}));

async function withProject(check: (fixture: { root: string; base: string; post: (fileName: unknown) => Promise<globalThis.Response> }) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'openpixo-asset-open-'));
  const projectRoot = path.join(root, 'game');
  await mkdir(path.join(projectRoot, 'Assets'), { recursive: true });
  await writeFile(path.join(projectRoot, 'Assets', 'player & scene.blend'), 'asset bytes');
  await writeFile(path.join(root, 'outside.blend'), 'outside');
  await writeFile(path.join(projectRoot, '.env'), 'not an asset');
  const app = express();
  app.use(express.json());
  registerHostToolsRoutes(app, {
    db: {},
    paths: { PROJECTS_DIR: path.join(root, 'managed') },
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'p1' ? { id, metadata: { baseDir: projectRoot } } : null },
    projectFiles: { resolveProjectDir: () => projectRoot },
    authorizeProjectRequest: async () => true,
  } as unknown as RegisterHostToolsRoutesDeps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await check({ root, base, post: (fileName) => fetch(`${base}/api/projects/p1/open-in`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ editorId: 'cursor', fileName }),
    }) });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!root.startsWith(path.join(tmpdir(), 'openpixo-asset-open-'))) throw new Error('unexpected fixture root');
    await rm(root, { recursive: true, force: true });
  }
}

describe('project asset external open trust boundary', () => {
  it('opens an existing imported asset as one literal argument', async () => {
    await withProject(async ({ root, post }) => {
      const response = await post('Assets/player & scene.blend');
      expect(response.status).toBe(200);
      const expected = await realpath(path.join(root, 'game', 'Assets', 'player & scene.blend'));
      expect(await response.json()).toEqual({ ok: true, editorId: 'cursor', path: expected });
      expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toContain(expected);
      expect(vi.mocked(spawn).mock.calls.at(-1)?.[2]).not.toHaveProperty('shell', true);
    });
  });

  it('rejects traversal, absolute paths, dotfiles and invalid input before launch', async () => {
    await withProject(async ({ root, post }) => {
      vi.mocked(spawn).mockClear();
      for (const fileName of ['../outside.blend', path.join(root, 'outside.blend'), '.env', '', 123, 'Assets/missing.blend']) {
        expect((await post(fileName)).status).toBe(400);
      }
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  it('rejects descendant symlink escapes', async () => {
    await withProject(async ({ root, post }) => {
      await symlink(root, path.join(root, 'game', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      vi.mocked(spawn).mockClear();
      expect((await post('escape/outside.blend')).status).toBe(400);
      expect(spawn).not.toHaveBeenCalled();
    });
  });
});
