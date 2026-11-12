import Database from 'better-sqlite3';
import express from 'express';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import type { ProjectAsset } from '@openpixo/contracts';
import { registerProjectAssetRoutes } from '../src/routes/project-assets.js';
import { runAssetCli } from '../src/assets/asset-cli.js';
import { recordAssetProvenance } from '../src/assets/provenance-store.js';
import { hashAssetFile } from '../src/assets/paths.js';
import { CHAT_TOOL_ENDPOINTS, CHAT_TOOL_OPERATIONS, toolTokenRegistry } from '../src/tool-tokens.js';

it('serves the query CLI through the project API and enforces token scope and path validation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'asset-routes-'));
  const projectRoot = path.join(dir, 'imported-game');
  const db = new Database(':memory:');
  const app = express(); app.use(express.json());
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, skill_id TEXT, design_system_id TEXT,
    pending_prompt TEXT, metadata_json TEXT, applied_plugin_snapshot_id TEXT, custom_instructions TEXT,
    created_at INTEGER, updated_at INTEGER)`);
  db.prepare('INSERT INTO projects(id, name, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 0, 0)')
    .run('game', 'Game', JSON.stringify({ kind: 'other', baseDir: projectRoot }));
  await mkdir(projectRoot);
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } }).png().toFile(path.join(projectRoot, 'hero.png'));
  const projectFiles = ['.gitignore', 'main.tscn', 'player.gd', 'project.godot'];
  await Promise.all(projectFiles.map(name => writeFile(path.join(projectRoot, name), 'project source')));
  const lifecycle = registerProjectAssetRoutes(app, {
    db, paths: { PROJECTS_DIR: path.join(dir, 'managed'), RUNTIME_DATA_DIR: path.join(dir, 'daemon') },
    http: {
      requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
      sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
      isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 },
    },
    authorizeProjectRequest: async () => true,
    authorizeProjectToolRequest: async (_res, projectId) => ({ projectId }),
  });
  const server = app.listen(0, '127.0.0.1');
  const runId = `asset-query-${path.basename(dir)}`;
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture server port');
    const base = `http://127.0.0.1:${address.port}`;
    const grant = toolTokenRegistry.mint({ runId, projectId: 'game', allowedEndpoints: CHAT_TOOL_ENDPOINTS, allowedOperations: CHAT_TOOL_OPERATIONS });
    vi.stubEnv('PIXO_PROJECT_ID', 'game'); vi.stubEnv('PIXO_TOOL_TOKEN', grant.token);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cli = async (args: string[]) => {
      stdout.mockClear(); await runAssetCli([...args, '--daemon-url', base, '--json']);
      return JSON.parse(stdout.mock.calls.map(call => String(call[0])).join(''));
    };
    const listed = await cli(['list', '--kind', 'image', '--limit', '1']);
    expect(listed.assets.map((asset: { relPath: string }) => asset.relPath)).toEqual(['hero.png']);
    expect((await cli(['list'])).assets.map((asset: { relPath: string }) => asset.relPath)).toEqual(['hero.png']);
    expect((await cli(['list', '--kind', 'all'])).assets.map((asset: { relPath: string }) => asset.relPath))
      .toEqual([...projectFiles, 'hero.png'].sort());
    expect((await cli(['info', 'hero.png'])).width).toBe(16);
    expect((await cli(['tag', 'hero.png', '--add', 'hero'])).assets[0].tags).toEqual(['hero']);
    expect((await cli(['list', '--tag', 'hero'])).assets).toHaveLength(1);
    recordAssetProvenance(db, { projectId: 'game', relPath: 'hero.png', contentHash: await hashAssetFile(path.join(projectRoot, 'hero.png')),
      origin: 'generated', promptText: 'a hero' });
    expect((await cli(['provenance', 'hero.png'])).provenance[0].promptText).toBe('a hero');
    const headers = { authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' };
    const grid = await fetch(`${base}/api/projects/game/assets/grid`, { method: 'PUT', headers, body: JSON.stringify({ path: 'hero.png', grid: { rows: 2, cols: 2 } }) });
    expect(grid.status).toBe(200);
    expect((await grid.json() as ProjectAsset).semantics).toContainEqual({ type: 'grid', source: 'hero.png', grid: { rows: 2, cols: 2 } });
    expect((await fetch(`${base}/api/projects/game/assets/info?path=..%2Fsecret`, { headers })).status).toBe(400);
    expect((await fetch(`${base}/api/projects/game/assets?limit=1001`, { headers })).status).toBe(400);
    expect((await fetch(`${base}/api/projects/game/assets/thumb?path=hero.png&size=256`, { headers })).headers.get('content-type')).toContain('image/webp');
    const other = toolTokenRegistry.mint({ runId, projectId: 'another-project', allowedEndpoints: CHAT_TOOL_ENDPOINTS, allowedOperations: CHAT_TOOL_OPERATIONS });
    expect((await fetch(`${base}/api/projects/game/assets`, { headers: { authorization: `Bearer ${other.token}` } })).status).toBe(403);
    toolTokenRegistry.revokeRun(runId, 'manual');
    expect((await fetch(`${base}/api/projects/game/assets`, { headers })).status).toBe(403);
    stdout.mockRestore();
  } finally {
    vi.restoreAllMocks(); vi.unstubAllEnvs(); toolTokenRegistry.revokeRun(runId, 'manual');
    await new Promise<void>(resolve => server.close(() => resolve()));
    await lifecycle.close(); db.close(); await rm(dir, { recursive: true, force: true });
  }
});
