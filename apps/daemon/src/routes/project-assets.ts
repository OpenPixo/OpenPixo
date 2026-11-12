import { readFile } from 'node:fs/promises';
import type { Express, Request, Response } from 'express';
import type { AssetGrid, AssetListQuery, AssetProvenanceResponse, AssetTagsRequest, ProjectMetadata } from '@openpixo/contracts';
import { getProject } from '../db.js';
import { resolveProjectDir } from '../projects.js';
import { runImageEdit } from '../assets/image-edit.js';
import { ProjectAssetIndexer } from '../assets/indexer.js';
import { assetRelPath, resolveAssetFile } from '../assets/paths.js';
import { listAssetProvenance, recordAssetProvenance } from '../assets/provenance-store.js';
import { getAssetThumbnail, getAssetWaveform } from '../assets/thumbnails.js';
import { publicErrorMessage } from '../http/api-errors.js';
import { bearerTokenFromRequest } from '../http/tool-request-auth.js';
import type { HttpDeps, PathDeps, RouteDeps } from '../server-context.js';
import { toolTokenRegistry } from '../tool-tokens.js';

export interface RegisterProjectAssetRoutesDeps extends RouteDeps<'db' | 'authorizeProjectRequest' | 'authorizeProjectToolRequest'> {
  paths: Pick<PathDeps, 'PROJECTS_DIR' | 'RUNTIME_DATA_DIR'>;
  http: Pick<HttpDeps, 'requireLocalDaemonRequest' | 'sendApiError' | 'isLocalSameOrigin' | 'resolvedPortRef'>;
}

function parseList(req: Request): AssetListQuery {
  const query: AssetListQuery = {};
  for (const key of ['kind', 'tag', 'origin', 'semantic', 'query', 'cursor'] as const) {
    const value = req.query[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > 4096)) throw new Error(`Invalid ${key}`);
    if (typeof value === 'string') Object.assign(query, { [key]: value });
  }
  if (query.kind && !['all', 'image', 'audio', 'video', 'model3d', 'font', 'data', 'other'].includes(query.kind)) throw new Error('Invalid asset kind');
  if (query.origin && !['generated', 'processed', 'imported'].includes(query.origin)) throw new Error('Invalid asset origin');
  if (query.semantic && !['sprite-sheet', 'atlas', 'grid', 'nine-slice', 'tileset', 'loop'].includes(query.semantic)) throw new Error('Invalid asset semantic');
  if (req.query.limit !== undefined) {
    if (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)) throw new Error('Invalid limit');
    query.limit = Number(req.query.limit);
  }
  return query;
}

function parseTags(value: unknown): AssetTagsRequest {
  const body = value as AssetTagsRequest;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['paths', 'add', 'remove'].includes(key))
    || !Array.isArray(body.paths) || body.paths.length < 1 || body.paths.length > 500) throw new Error('Expected 1–500 asset paths');
  const paths = body.paths.map(assetRelPath);
  const tags = (list: unknown): string[] => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.length > 64 || list.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 100)) throw new Error('Invalid asset tags');
    return [...new Set((list as string[]).map(tag => tag.trim()))];
  };
  const add = tags(body.add), remove = tags(body.remove);
  if (!add.length && !remove.length) throw new Error('Pass tags to add or remove');
  return { paths, add, remove };
}

function parseGrid(value: unknown): AssetGrid | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid asset grid');
  const grid = value as Record<string, unknown>;
  const keys = 'rows' in grid || 'cols' in grid ? ['rows', 'cols'] : ['cellWidth', 'cellHeight'];
  if (Object.keys(grid).length !== 2 || keys.some(key => !Number.isInteger(grid[key]) || Number(grid[key]) < 1 || Number(grid[key]) > 65536)) throw new Error('Grid requires positive rows/cols or cellWidth/cellHeight');
  return grid as AssetGrid;
}

export function registerProjectAssetRoutes(app: Express, ctx: RegisterProjectAssetRoutesDeps): {
  close(): Promise<void>;
  /** Closes what the asset index keeps open inside a project's folder. */
  release(projectId: string): Promise<void>;
  mediaAssetCount(projectId: string, metadata?: ProjectMetadata): Promise<number>;
} {
  const indexer = new ProjectAssetIndexer({ db: ctx.db, projectsRoot: ctx.paths.PROJECTS_DIR });
  const { requireLocalDaemonRequest, sendApiError, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const prefix = '/api/projects/:id/assets';
  async function authorize(req: Request, res: Response, operation: 'asset:read' | 'asset:tag' | 'asset:grid' | 'asset:edit') {
    const id = String(req.params.id);
    const project = getProject(ctx.db, id);
    if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return null; }
    const write = operation !== 'asset:read';
    const mode = write ? { mode: 'write' as const, capability: 'writeFiles' as const } : { mode: 'read' as const, allowNavigationQuery: true };
    const token = bearerTokenFromRequest(req);
    if (token?.startsWith('pixott_')) {
      const result = toolTokenRegistry.validate(token, { operation, endpoint: req.route.path });
      if (!result.ok || result.grant.projectId !== id) { sendApiError(res, 403, 'FORBIDDEN', 'A valid asset token for this project is required'); return null; }
      if (!await ctx.authorizeProjectToolRequest(res, id, mode)) return null;
    } else {
      if (write && !isLocalSameOrigin(req, resolvedPortRef.current)) { sendApiError(res, 403, 'FORBIDDEN', 'local origin required'); return null; }
      if (!await ctx.authorizeProjectRequest(req, res, id, mode)) return null;
    }
    return project;
  }
  const fail = (res: Response, error: unknown) => sendApiError(res, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400,
    (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'NOT_FOUND' : 'BAD_REQUEST', publicErrorMessage(error));

  app.get(prefix, requireLocalDaemonRequest, async (req, res) => {
    try {
      const project = await authorize(req, res, 'asset:read'); if (!project) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json(await indexer.list(project.id, parseList(req), project.metadata));
    } catch (error) { fail(res, error); }
  });
  app.post(`${prefix}/edit`, requireLocalDaemonRequest, async (req, res) => {
    try {
      const project = await authorize(req, res, 'asset:edit'); if (!project) return;
      const root = resolveProjectDir(ctx.paths.PROJECTS_DIR, project.id, project.metadata);
      const token = bearerTokenFromRequest(req);
      const grant = token?.startsWith('pixott_')
        ? toolTokenRegistry.validate(token, { operation: 'asset:edit', endpoint: req.route.path }) : undefined;
      const result = await runImageEdit(root, req.body);
      recordAssetProvenance(ctx.db, { projectId: project.id, relPath: result.output, contentHash: result.outputSha256,
        origin: 'processed', params: { op: 'edit', source: result.source, ops: result.ops }, parentHashes: [result.sourceSha256],
        ...(grant?.ok ? { runId: grant.grant.runId } : {}) });
      // info eagerly refreshes this exact output and returns its complete indexed record.
      res.setHeader('Cache-Control', 'no-store');
      res.json(await indexer.info(project.id, result.output, project.metadata));
    } catch (error) { fail(res, error); }
  });
  app.get(`${prefix}/info`, requireLocalDaemonRequest, async (req, res) => {
    try {
      const project = await authorize(req, res, 'asset:read'); if (!project) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json(await indexer.info(project.id, assetRelPath(req.query.path), project.metadata));
    } catch (error) { fail(res, error); }
  });
  app.post(`${prefix}/tags`, requireLocalDaemonRequest, async (req, res) => {
    try {
      const project = await authorize(req, res, 'asset:tag'); if (!project) return;
      const body = parseTags(req.body);
      res.json({ assets: await indexer.tags(project.id, body.paths, body.add ?? [], body.remove ?? [], project.metadata), nextCursor: null });
    } catch (error) { fail(res, error); }
  });
  app.put(`${prefix}/grid`, requireLocalDaemonRequest, async (req, res) => {
    try {
      const project = await authorize(req, res, 'asset:grid'); if (!project) return;
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || Object.keys(body).some(key => !['path', 'grid'].includes(key))) throw new Error('Invalid grid request');
      res.json(await indexer.grid(project.id, assetRelPath(body.path), parseGrid(body.grid), project.metadata));
    } catch (error) { fail(res, error); }
  });
  app.get(`${prefix}/provenance`, requireLocalDaemonRequest, async (req, res) => {
    try {
      const project = await authorize(req, res, 'asset:read'); if (!project) return;
      const asset = await indexer.info(project.id, assetRelPath(req.query.path), project.metadata);
      const body: AssetProvenanceResponse = { provenance: listAssetProvenance(ctx.db, project.id, {
        relPath: asset.relPath, ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
      }) };
      res.setHeader('Cache-Control', 'no-store'); res.json(body);
    } catch (error) { fail(res, error); }
  });
  app.get(`${prefix}/thumb`, requireLocalDaemonRequest, async (req, res) => {
    try {
      const project = await authorize(req, res, 'asset:read'); if (!project) return;
      const size = req.query.size ?? '256';
      if (size !== '256' && size !== '1024') throw new Error('Thumbnail size must be 256 or 1024');
      const rel = assetRelPath(req.query.path);
      const asset = await indexer.info(project.id, rel, project.metadata);
      const source = await resolveAssetFile(ctx.paths.PROJECTS_DIR, project.id, rel, project.metadata);
      if (!asset.contentHash) throw new Error('Asset changed while indexing; retry');
      const file = await getAssetThumbnail({ runtimeDataDir: ctx.paths.RUNTIME_DATA_DIR, filePath: source.filePath,
        contentHash: asset.contentHash, kind: asset.kind, size: Number(size) as 256 | 1024 });
      if (!file) { sendApiError(res, 404, 'NOT_FOUND', 'This asset has no thumbnail'); return; }
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.type('webp').send(await readFile(file));
    } catch (error) { fail(res, error); }
  });
  app.get(`${prefix}/waveform`, requireLocalDaemonRequest, async (req, res) => {
    try {
      const project = await authorize(req, res, 'asset:read'); if (!project) return;
      const rel = assetRelPath(req.query.path);
      const asset = await indexer.info(project.id, rel, project.metadata);
      if (asset.kind !== 'audio' || !asset.contentHash) throw new Error('Waveforms require an audio asset');
      const source = await resolveAssetFile(ctx.paths.PROJECTS_DIR, project.id, rel, project.metadata);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      const waveform = await getAssetWaveform({ runtimeDataDir: ctx.paths.RUNTIME_DATA_DIR, filePath: source.filePath, contentHash: asset.contentHash });
      ctx.db.prepare('UPDATE project_assets SET duration_ms = ? WHERE project_id = ? AND rel_path = ? AND content_hash = ?')
        .run(waveform.durationMs, project.id, rel, asset.contentHash);
      res.json(waveform);
    } catch (error) { fail(res, error); }
  });
  return { close: () => indexer.close(), release: (id) => indexer.release(id), mediaAssetCount: (id, metadata) => indexer.mediaAssetCount(id, metadata) };
}
