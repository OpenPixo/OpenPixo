import { once } from 'node:events';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AssetOpReport } from '@openpixo/contracts';
import { closeDatabase, insertProject, openDatabase } from '../src/db.js';
import { listAssetProvenance } from '../src/assets/provenance-store.js';
import { runAssetOpCli } from '../src/assets/ops/asset-ops-cli.js';
import { registerAssetOpRoutes, type RegisterAssetOpRoutesDeps } from '../src/routes/asset-ops.js';
import { requireLocalDaemonRequest } from '../src/http/local-daemon-request.js';
import { sendApiError } from '../src/http/api-errors.js';
import { toolTokenRegistry } from '../src/tool-tokens.js';

let root: string, base: string, server: Server, db: ReturnType<typeof openDatabase>;
let toolAuthority: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'asset-ops-http-'));
  const projectRoot = path.join(root, 'imported'); await mkdir(projectRoot);
  await writeFile(path.join(projectRoot, 'sprite.png'), await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer());
  db = openDatabase(root, { dataDir: path.join(root, 'runtime-data') });
  insertProject(db, { id: 'project', name: 'game', metadata: { baseDir: projectRoot }, createdAt: 0, updatedAt: 0 });
  const app = express(); app.use(express.json());
  toolAuthority = vi.fn(async () => ({ workspace: null }));
  const deps = { db, paths: { PROJECTS_DIR: path.join(root, 'managed') },
    http: { requireLocalDaemonRequest, sendApiError, isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 } },
    authorizeProjectRequest: async () => true, authorizeProjectToolRequest: toolAuthority } as unknown as RegisterAssetOpRoutesDeps;
  registerAssetOpRoutes(app, deps);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  process.exitCode = 0; vi.restoreAllMocks(); vi.unstubAllEnvs(); toolTokenRegistry.clear();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  closeDatabase();
  if (!root.startsWith(path.join(tmpdir(), 'asset-ops-http-'))) throw new Error('Unsafe cleanup target');
  await rm(root, { recursive: true, force: true });
});

const post = (token: string, body: unknown) => fetch(`${base}/api/projects/project/asset-ops`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

it('uses the media tool grant, confines imported outputs, and records processed provenance with parents', async () => {
  const grant = toolTokenRegistry.mint({ runId: 'run', projectId: 'project' });
  const response = await post(grant.token, { op: 'resize', inputs: ['sprite.png'], params: { width: 4 } });
  expect(response.status).toBe(200);
  const report = await response.json() as AssetOpReport;
  expect(report.counts.failed).toBe(0);
  expect(toolAuthority).toHaveBeenCalled();
  await expect(readFile(path.join(root, 'imported', report.results[0]!.output!))).resolves.toBeInstanceOf(Buffer);
  const provenance = listAssetProvenance(db, 'project', { relPath: report.results[0]!.output! });
  expect(provenance).toHaveLength(1);
  expect(provenance[0]).toMatchObject({ origin: 'processed', runId: 'run', contentHash: report.results[0]!.outputSha256, parentHashes: [report.results[0]!.sourceSha256] });
  toolTokenRegistry.revokeRun('run', 'manual');
  expect((await post(grant.token, { op: 'resize', inputs: ['sprite.png'], params: { width: 4 } })).status).toBe(401);
  const other = toolTokenRegistry.mint({ runId: 'other-run', projectId: 'another-project' });
  expect((await post(other.token, { op: 'resize', inputs: ['sprite.png'], params: { width: 4 } })).status).toBe(403);
});

it('routes CLI flags to the same API, emits JSON and exits 1 for partial failure', async () => {
  const grant = toolTokenRegistry.mint({ runId: 'cli', projectId: 'project' });
  vi.stubEnv('PIXO_PROJECT_ID', 'project'); vi.stubEnv('PIXO_TOOL_TOKEN', grant.token);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runAssetOpCli(['resize', 'missing.png', 'sprite.png', '--width', '4', '--filter', 'nearest', '--json', '--daemon-url', base]);
  const report = JSON.parse(stdout.mock.calls.map(call => String(call[0])).join('')) as AssetOpReport;
  expect(report.counts).toEqual({ succeeded: 1, failed: 1, skipped: 0 });
  expect(report.params).toEqual({ width: 4, filter: 'nearest' });
  expect(process.exitCode).toBe(1);
});

it('maps audio normalize and separate negative flags, and leaves dry runs unwritten', async () => {
  const grant = toolTokenRegistry.mint({ runId: 'audio-cli', projectId: 'project' });
  vi.stubEnv('PIXO_PROJECT_ID', 'project'); vi.stubEnv('PIXO_TOOL_TOKEN', grant.token);
  // A dry run only needs a readable selected input; it does not invoke FFmpeg.
  await writeFile(path.join(root, 'imported', 'sound.wav'), 'planned audio');
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runAssetOpCli(['audio', 'normalize', 'sound.wav', '--lufs', '-16', '--out', 'planned', '--dry-run', '--json', '--daemon-url', base]);
  const report = JSON.parse(stdout.mock.calls.map(call => String(call[0])).join('')) as AssetOpReport;
  expect(report).toMatchObject({ op: 'audio-normalize', dryRun: true, params: { lufs: -16 }, counts: { succeeded: 1, failed: 0, skipped: 0 } });
  expect(report.reportPath).toBeUndefined();
  await expect(readFile(path.join(root, 'imported', report.results[0]!.output!))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(listAssetProvenance(db, 'project')).toEqual([]);
});

it('exposes engine export through the same asset-op CLI and HTTP endpoint with JSON output', async () => {
  const grant = toolTokenRegistry.mint({ runId: 'sprite-cli', projectId: 'project' });
  vi.stubEnv('PIXO_PROJECT_ID', 'project'); vi.stubEnv('PIXO_TOOL_TOKEN', grant.token);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runAssetOpCli(['export-spritesheet', 'sprite.png', '--format', 'phaser', '--columns', '1', '--animations', 'idle', '--fps', '12', '--name', 'hero', '--no-loop', '--json', '--daemon-url', base]);
  const report = JSON.parse(stdout.mock.calls.map(call => String(call[0])).join('')) as AssetOpReport;
  expect(report).toMatchObject({ op: 'export-spritesheet', params: { format: 'phaser', columns: 1, animations: 'idle', fps: 12, name: 'hero', loop: false }, counts: { succeeded: 1, failed: 0, skipped: 0 } });
  const config = report.results[0]!.extraOutputs!.find(file => file.endsWith('.animations.json'))!;
  expect(JSON.parse(await readFile(path.join(root, 'imported', config), 'utf8')).anims[0]).toMatchObject({ frameRate: 12, repeat: 0 });
});
