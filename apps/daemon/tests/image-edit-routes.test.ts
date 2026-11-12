import Database from 'better-sqlite3';
import express from 'express';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import type { AssetProvenanceResponse, ProjectAsset } from '@openpixo/contracts';
import { registerProjectAssetRoutes } from '../src/routes/project-assets.js';
import { hashAssetFile } from '../src/assets/paths.js';
import { CHAT_TOOL_ENDPOINTS, CHAT_TOOL_OPERATIONS, toolTokenRegistry } from '../src/tool-tokens.js';

// The grant a chat run's agent actually gets: `pixo image edit` has to work with it.
const EDIT_ENDPOINTS = CHAT_TOOL_ENDPOINTS;
const EDIT_OPERATIONS = CHAT_TOOL_OPERATIONS;

it('edits through the shared endpoint, records lineage, refreshes the index and enforces write grants', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'image-edit-route-'));
  const projectRoot = path.join(dir, 'imported-game');
  const db = new Database(':memory:');
  const app = express(); app.use(express.json());
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, skill_id TEXT, design_system_id TEXT,
    pending_prompt TEXT, metadata_json TEXT, applied_plugin_snapshot_id TEXT, custom_instructions TEXT,
    created_at INTEGER, updated_at INTEGER)`);
  db.prepare('INSERT INTO projects(id, name, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 0, 0)')
    .run('game', 'Game', JSON.stringify({ kind: 'other', baseDir: projectRoot }));
  await mkdir(path.join(projectRoot, 'sprites'), { recursive: true });
  const original = await sharp({ create: { width: 6, height: 4, channels: 4, background: '#ff000080' } }).png().toBuffer();
  await writeFile(path.join(projectRoot, 'sprites/hero.png'), original);
  const parentHash = await hashAssetFile(path.join(projectRoot, 'sprites/hero.png'));
  let sameOrigin = true;
  const writeModes: unknown[] = [];
  const lifecycle = registerProjectAssetRoutes(app, {
    db, paths: { PROJECTS_DIR: path.join(dir, 'managed'), RUNTIME_DATA_DIR: path.join(dir, 'daemon') },
    http: {
      requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
      sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
      isLocalSameOrigin: () => sameOrigin, resolvedPortRef: { current: 0 },
    },
    authorizeProjectRequest: async (_req, _res, _projectId, mode) => { writeModes.push(mode); return true; },
    authorizeProjectToolRequest: async (_res, projectId, mode) => { writeModes.push(mode); return { projectId }; },
  });
  const server = app.listen(0, '127.0.0.1');
  const runId = `image-edit-${path.basename(dir)}`;
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture server port');
    const base = `http://127.0.0.1:${address.port}/api/projects/game/assets`;
    const grant = toolTokenRegistry.mint({ runId, projectId: 'game', allowedEndpoints: EDIT_ENDPOINTS, allowedOperations: EDIT_OPERATIONS });
    const headers = { authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' };
    const body = { source: 'sprites/hero.png', output: 'hero_crop.png', ops: [
      { op: 'crop', x: 1, y: 1, width: 3, height: 2 }, { op: 'resize', scale: 2, filter: 'nearest' },
    ] };
    const post = (value: unknown, auth = headers) => fetch(`${base}/edit`, { method: 'POST', headers: auth, body: JSON.stringify(value) });
    // Start the inventory before processing; save must refresh the active index immediately.
    expect((await fetch(base, { headers })).status).toBe(200);
    const response = await post(body);
    expect(response.status).toBe(200);
    const asset = await response.json() as ProjectAsset;
    expect(asset).toMatchObject({ projectId: 'game', relPath: 'sprites/hero_crop.png', width: 6, height: 4,
      origin: 'processed', mime: 'image/png', contentHash: expect.any(String) });
    expect(writeModes).toContainEqual({ mode: 'write', capability: 'writeFiles' });
    const provenance = await (await fetch(`${base}/provenance?path=${asset.relPath}`, { headers })).json() as AssetProvenanceResponse;
    expect(provenance.provenance[0]).toMatchObject({ origin: 'processed', contentHash: asset.contentHash,
      parentHashes: [parentHash], runId, params: { op: 'edit', source: body.source, ops: body.ops } });
    const inventory = await (await fetch(`${base}?origin=processed`, { headers })).json() as { assets: ProjectAsset[] };
    expect(inventory.assets.map(item => item.relPath)).toContain(asset.relPath);
    expect(await readFile(path.join(projectRoot, 'sprites/hero.png'))).toEqual(original);
    expect((await post(body)).status).toBe(400);
    expect((await post({ ...body, source: '../outside.png', output: 'invalid.png' })).status).toBe(400);
    expect((await post({ ...body, output: '../invalid.png' })).status).toBe(400);
    expect((await post({ ...body, output: 'invalid.png', ops: [{ op: 'trim', extra: true }] })).status).toBe(400);
    expect((await post({ ...body, source: 'missing.png', output: 'invalid.png' })).status).toBe(404);
    const readOnly = toolTokenRegistry.mint({ runId, projectId: 'game', allowedEndpoints: EDIT_ENDPOINTS, allowedOperations: ['asset:read'] });
    expect((await post({ ...body, output: 'denied.png' }, { ...headers, authorization: `Bearer ${readOnly.token}` })).status).toBe(403);
    const other = toolTokenRegistry.mint({ runId, projectId: 'other', allowedEndpoints: EDIT_ENDPOINTS, allowedOperations: EDIT_OPERATIONS });
    expect((await post({ ...body, output: 'denied.png' }, { ...headers, authorization: `Bearer ${other.token}` })).status).toBe(403);
    sameOrigin = false;
    expect((await post({ ...body, output: 'denied.png' }, { 'Content-Type': 'application/json', authorization: '' })).status).toBe(403);
  } finally {
    toolTokenRegistry.revokeRun(runId, 'manual');
    await new Promise<void>(resolve => server.close(() => resolve()));
    await lifecycle.close(); db.close();
    if (!dir.startsWith(path.join(tmpdir(), 'image-edit-route-'))) throw new Error('Unsafe cleanup target');
    await rm(dir, { recursive: true, force: true });
  }
});
