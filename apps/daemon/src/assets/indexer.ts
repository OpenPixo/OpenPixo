import type Database from 'better-sqlite3';
import path from 'node:path';
import { lstat, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import type { AssetGrid, AssetListQuery, AssetListResponse, AssetSemantics, EngineAssetMeta, ProjectAsset, ProjectMetadata } from '@openpixo/contracts';
import { mimeFor, resolveProjectDir } from '../projects.js';
import { makeIgnored, subscribe, type ProjectWatchEvent } from '../project-watchers.js';
import { isEngineCacheDirAt, isEngineCacheDirNameFor, isIgnoredProjectDirName } from '../project-ignored-dirs.js';
import { assetRelPath, hashAssetFile, resolveAssetFile } from './paths.js';
import { listAssetProvenance } from './provenance-store.js';
import { readAssetEvidence } from './semantics.js';
import { migrateProjectAssets } from './store.js';

const EXTENSIONS: Record<string, ProjectAsset['kind']> = Object.fromEntries([
  ['image', 'png jpg jpeg gif webp avif svg bmp tga tif tiff ico'],
  ['audio', 'wav ogg mp3 m4a flac aac opus aif aiff'],
  ['video', 'mp4 mov webm mkv avi m4v'], ['model3d', 'glb gltf fbx obj blend'],
  ['font', 'ttf otf woff woff2'], ['data', 'json atlas tres tscn tsx tmx ldtk meta import xml yaml yml csv'],
].flatMap(([kind, extensions]) => extensions!.split(' ').map(ext => [`.${ext}`, kind]))) as Record<string, ProjectAsset['kind']>;

/** Default browsing shows media and unambiguous sprite/tilemap data, excluding project source/config. */
const DEFAULT_MEDIA_FILTER = `(kind IN ('image', 'audio', 'video', 'model3d', 'font')
  OR (kind = 'data' AND (lower(rel_path) GLOB '*.atlas' OR lower(rel_path) GLOB '*.tmx' OR lower(rel_path) GLOB '*.ldtk')))`;

const UPSERT_ASSET = `INSERT INTO project_assets (project_id, rel_path, kind, mime, size, mtime, indexed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, rel_path) DO UPDATE SET
  kind=excluded.kind, mime=excluded.mime, size=excluded.size, mtime=excluded.mtime, indexed_at=excluded.indexed_at,
  content_hash=CASE WHEN project_assets.size=excluded.size AND project_assets.mtime=excluded.mtime THEN project_assets.content_hash END,
  width=CASE WHEN project_assets.size=excluded.size AND project_assets.mtime=excluded.mtime THEN project_assets.width END,
  height=CASE WHEN project_assets.size=excluded.size AND project_assets.mtime=excluded.mtime THEN project_assets.height END,
  duration_ms=CASE WHEN project_assets.size=excluded.size AND project_assets.mtime=excluded.mtime THEN project_assets.duration_ms END`;

interface AssetRow {
  project_id: string; rel_path: string; kind: ProjectAsset['kind']; mime: string | null;
  size: number; mtime: number; content_hash: string | null; width: number | null; height: number | null;
  duration_ms: number | null; semantics_json: string | null; engine_meta_json: string | null;
  tags_json: string | null; library_asset_id: string | null; indexed_at: number;
}
interface Session {
  id: string; root: string; metadata: ProjectMetadata | undefined; scan: Promise<void>; updates: Promise<void>;
  watcher: ReturnType<typeof subscribe> | undefined; ignored: (rel: string) => boolean;
}

/** One stat scan per active project; content enrichment is serialized in small idle batches. */
async function pathExists(target: string): Promise<boolean> {
  try { await lstat(target); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export class ProjectAssetIndexer {
  private readonly db: Database.Database;
  private readonly projectsRoot: string;
  private readonly upsertStatement: Database.Statement;
  private readonly sessions = new Map<string, Session>();
  private readonly queue = new Map<string, { session: Session; rel: string }>();
  private scheduled: NodeJS.Immediate | undefined;
  private background: Promise<void> | undefined;
  private closed = false;

  constructor(options: { db: Database.Database; projectsRoot: string }) {
    this.db = options.db; this.projectsRoot = options.projectsRoot;
    migrateProjectAssets(this.db);
    this.upsertStatement = this.db.prepare(UPSERT_ASSET);
  }

  private session(id: string, metadata?: ProjectMetadata): Session {
    if (this.closed) throw new Error('Asset indexer is closed');
    const root = resolveProjectDir(this.projectsRoot, id, metadata);
    const existing = this.sessions.get(id);
    if (existing) {
      if (existing.root !== root) throw new Error('Project folder changed; reopen the asset index');
      existing.metadata = metadata;
      return existing;
    }
    const engine = metadata?.engineProfile?.engine;
    const ignored = (rel: string) => {
      const segments = rel.split('/');
      return isEngineCacheDirNameFor(engine, segments[0]!)
        || segments.some((segment, index) => isIgnoredProjectDirName(segment)
          || isEngineCacheDirAt(path.join(root, ...segments.slice(0, index)), segment));
    };
    const session: Session = { id, root, metadata, scan: Promise.resolve(), updates: Promise.resolve(), watcher: undefined, ignored };
    this.sessions.set(id, session);
    session.scan = this.scan(session);
    // A failed first inventory must not answer every later read: the next one starts over.
    session.scan.catch(() => { if (this.sessions.get(id) === session) this.sessions.delete(id); });
    return session;
  }

  /**
   * A project folder that does not exist yet (a new project before its first
   * write) or right now (a moved import, an unplugged drive) reads as empty.
   * Nothing is recorded for it: its rows and tags survive, and the first read
   * after it appears scans and watches it.
   */
  private async rootMissing(id: string, metadata?: ProjectMetadata): Promise<boolean> {
    try { await lstat(resolveProjectDir(this.projectsRoot, id, metadata)); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
  }

  private async scan(session: Session): Promise<void> {
    // A new managed project has no folder until its first write. Nothing can be
    // watched yet, so drop the session and let the next read start a fresh scan.
    if (!session.watcher && !await pathExists(session.root)) {
      if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
      return;
    }
    const rows: { rel: string; size: number; mtime: number }[] = [];
    const walk = async (dir: string, prefix = ''): Promise<void> => {
      const files: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const rel = prefix + entry.name;
        if (entry.isSymbolicLink() || session.ignored(rel)) continue;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${rel}/`);
        else if (entry.isFile()) files.push(rel);
      }
      // Bound filesystem concurrency; this path reads no contents/descriptors.
      for (let offset = 0; offset < files.length; offset += 32) {
        await Promise.all(files.slice(offset, offset + 32).map(async rel => {
          try {
            const st = await lstat(path.join(session.root, rel));
            if (st.isFile()) rows.push({ rel, size: st.size, mtime: st.mtimeMs });
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }));
      }
    };
    await walk(session.root);
    const seen = new Set(rows.map(row => row.rel));
    this.db.transaction(() => {
      for (const row of rows) this.upsert(session.id, row.rel, row.size, row.mtime);
      for (const row of this.db.prepare('SELECT rel_path FROM project_assets WHERE project_id = ?').all(session.id) as { rel_path: string }[]) {
        if (!seen.has(row.rel_path)) {
          this.removeEvidence(session.id, row.rel_path);
          this.db.prepare('DELETE FROM project_assets WHERE project_id = ? AND rel_path = ?').run(session.id, row.rel_path);
        }
      }
    })();
    for (const row of rows) this.enqueue(session, row.rel);
    if (!session.watcher && !this.closed) {
      const ignored = makeIgnored(session.root);
      session.watcher = subscribe(this.projectsRoot, session.id, event => {
        void this.applyEvent(session.id, event).catch(error => console.warn('[assets] watcher update failed', error));
      }, { metadata: session.metadata, ignored: (file, stats) => ignored(file, stats)
        || session.ignored(path.relative(session.root, file).replace(/\\/g, '/')) });
      // Chokidar also stats the tree. Start it after the first inventory so its
      // bootstrap cannot hold up the list, then reconcile once at the ready
      // boundary to cover changes made while it was attaching native watches.
      void session.watcher.ready.then(() => {
        if (this.closed) return;
        const reconcile = () => this.scan(session);
        session.updates = session.updates.then(reconcile, reconcile);
        void session.updates.catch(error => console.warn('[assets] watcher reconciliation failed', error));
      });
    }
  }

  private upsert(id: string, rel: string, size: number, mtime: number): void {
    this.upsertStatement
      .run(id, rel, EXTENSIONS[path.extname(rel).toLowerCase()] ?? 'other', mimeFor(rel), size, mtime, Date.now());
  }

  /** Watcher adapter, also useful to callers that just wrote a known output. */
  async applyEvent(id: string, event: ProjectWatchEvent): Promise<void> {
    const session = this.sessions.get(id);
    if (!session || this.closed) return;
    const rel = assetRelPath(event.path);
    if (session.ignored(rel)) return;
    const update = async () => {
      await session.scan;
      if (event.kind === 'unlink') {
        this.db.prepare('DELETE FROM project_assets WHERE project_id = ? AND rel_path = ?').run(id, rel);
        this.queue.delete(`${id}:${rel}`);
        this.removeEvidence(id, rel);
      } else {
        try {
          const file = await resolveAssetFile(this.projectsRoot, id, rel, session.metadata);
          if (!(await lstat(file.filePath)).isFile()) return;
          this.upsert(id, rel, file.size, file.mtime);
          this.enqueue(session, rel);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    };
    session.updates = session.updates.then(update, update);
    await session.updates;
  }

  async watchingReady(id: string): Promise<void> {
    const session = this.sessions.get(id);
    await session?.scan; await session?.watcher?.ready; await session?.updates;
  }
  async flushUpdates(id: string): Promise<void> { await this.sessions.get(id)?.updates; }

  /** Share the active inventory and watcher with starter facts without opening the Assets panel. */
  async mediaAssetCount(id: string, metadata?: ProjectMetadata): Promise<number> {
    if (await this.rootMissing(id, metadata)) return 0;
    const session = this.session(id, metadata);
    await session.scan; await session.updates;
    const row = this.db.prepare(`SELECT count(*) AS count FROM project_assets WHERE project_id = ? AND ${DEFAULT_MEDIA_FILTER}`).get(id) as { count: number };
    return row.count;
  }

  async list(id: string, query: AssetListQuery = {}, metadata?: ProjectMetadata): Promise<AssetListResponse> {
    if (await this.rootMissing(id, metadata)) return { assets: [], nextCursor: null };
    const session = this.session(id, metadata);
    await session.scan; await session.updates;
    const clauses = ['project_id = ?'];
    const args: (string | number)[] = [id];
    if (!query.kind) clauses.push(DEFAULT_MEDIA_FILTER);
    else if (query.kind !== 'all') { clauses.push('kind = ?'); args.push(query.kind); }
    if (query.tag) { clauses.push("EXISTS (SELECT 1 FROM json_each(COALESCE(tags_json, '[]')) WHERE value = ?)"); args.push(query.tag); }
    if (query.semantic) { clauses.push("EXISTS (SELECT 1 FROM json_each(COALESCE(semantics_json, '[]')) WHERE json_extract(value, '$.type') = ?)"); args.push(query.semantic); }
    if (query.query) { clauses.push("rel_path LIKE ? ESCAPE '\\'"); args.push(`%${query.query.replace(/[\\%_]/g, '\\$&')}%`); }
    if (query.origin) {
      clauses.push(`COALESCE((SELECT origin FROM asset_provenance p WHERE p.project_id=project_assets.project_id
        AND (p.rel_path=project_assets.rel_path OR p.content_hash=project_assets.content_hash) ORDER BY created_at DESC, rowid DESC LIMIT 1), 'imported') = ?`);
      args.push(query.origin);
    }
    if (query.cursor) {
      let cursor: unknown;
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { throw new Error('Invalid asset cursor'); }
      clauses.push('rel_path > ?'); args.push(assetRelPath(cursor));
    }
    const limit = query.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Asset limit must be between 1 and 1000');
    const rows = this.db.prepare(`SELECT * FROM project_assets WHERE ${clauses.join(' AND ')} ORDER BY rel_path LIMIT ?`).all(...args, limit + 1) as AssetRow[];
    const page = rows.slice(0, limit);
    return { assets: page.map(row => this.asset(row)), nextCursor: rows.length > limit
      ? Buffer.from(JSON.stringify(page.at(-1)!.rel_path)).toString('base64url') : null };
  }

  private row(id: string, rel: string): AssetRow | undefined {
    return this.db.prepare('SELECT * FROM project_assets WHERE project_id = ? AND rel_path = ?').get(id, rel) as AssetRow | undefined;
  }

  private asset(row: AssetRow): ProjectAsset {
    const provenance = listAssetProvenance(this.db, row.project_id, { relPath: row.rel_path, ...(row.content_hash ? { contentHash: row.content_hash } : {}) });
    return { projectId: row.project_id, relPath: row.rel_path, kind: row.kind, size: row.size, mtime: row.mtime,
      semantics: JSON.parse(row.semantics_json ?? '[]'), tags: JSON.parse(row.tags_json ?? '[]'), indexedAt: row.indexed_at,
      origin: provenance[0]?.origin ?? 'imported',
      ...(row.mime ? { mime: row.mime } : {}), ...(row.content_hash ? { contentHash: row.content_hash } : {}),
      ...(row.width !== null ? { width: row.width } : {}), ...(row.height !== null ? { height: row.height } : {}),
      ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
      ...(row.engine_meta_json ? { engineMeta: JSON.parse(row.engine_meta_json) as EngineAssetMeta } : {}),
      ...(row.library_asset_id ? { libraryAssetId: row.library_asset_id } : {}),
      ...(provenance[0]?.modifiedSinceProvenance !== undefined ? { modifiedSinceProvenance: provenance[0].modifiedSinceProvenance } : {}),
    };
  }

  /** Detail/hash consumers take priority over the background queue. */
  async info(id: string, pathValue: string, metadata?: ProjectMetadata): Promise<ProjectAsset> {
    const rel = assetRelPath(pathValue);
    const session = this.session(id, metadata);
    await session.scan; await session.updates;
    const file = await resolveAssetFile(this.projectsRoot, id, rel, metadata);
    if (session.ignored(rel) || !(await lstat(file.filePath)).isFile()) throw new Error('Asset not found');
    this.upsert(id, rel, file.size, file.mtime);
    await this.enrich(session, rel);
    const row = this.row(id, rel);
    if (!row) throw new Error('Asset not found');
    return this.asset(row);
  }

  async tags(id: string, paths: string[], add: string[], remove: string[], metadata?: ProjectMetadata): Promise<ProjectAsset[]> {
    const assets = await Promise.all(paths.map(rel => this.info(id, rel, metadata)));
    this.db.transaction(() => {
      for (const asset of assets) {
        const current = JSON.parse(this.row(id, asset.relPath)?.tags_json ?? '[]') as string[];
        const tags = [...new Set([...current.filter(tag => !remove.includes(tag)), ...add])];
        this.db.prepare('UPDATE project_assets SET tags_json = ? WHERE project_id = ? AND rel_path = ?').run(JSON.stringify(tags), id, asset.relPath);
        asset.tags = tags;
      }
    })();
    return assets;
  }

  async grid(id: string, rel: string, grid: AssetGrid | null, metadata?: ProjectMetadata): Promise<ProjectAsset> {
    const asset = await this.info(id, rel, metadata);
    if (asset.kind !== 'image') throw new Error('Grid declarations require an image asset');
    asset.semantics = asset.semantics.filter(entry => entry.type !== 'grid');
    if (grid) asset.semantics.push({ type: 'grid', source: asset.relPath, grid });
    this.db.prepare('UPDATE project_assets SET semantics_json = ? WHERE project_id = ? AND rel_path = ?').run(JSON.stringify(asset.semantics), id, asset.relPath);
    return asset;
  }

  private enqueue(session: Session, rel: string): void {
    if (this.closed) return;
    this.queue.set(`${session.id}:${rel}`, { session, rel });
    if (!this.scheduled && !this.background) this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      this.background = this.batch().finally(() => {
        this.background = undefined;
        const next = this.queue.values().next().value;
        if (next) this.enqueue(next.session, next.rel);
      });
    });
  }

  private async batch(): Promise<void> {
    for (let count = 0; count < 4 && !this.closed; count++) {
      const next = this.queue.entries().next().value;
      if (!next) return;
      const [key, { session, rel }] = next;
      this.queue.delete(key);
      try { await this.enrich(session, rel); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[assets] enrichment skipped', rel, error); }
    }
  }

  async flushBackground(): Promise<void> {
    do {
      if (this.scheduled) { clearImmediate(this.scheduled); this.scheduled = undefined; }
      if (this.background) await this.background;
      else await this.batch();
    } while (!this.closed && (this.queue.size || this.background || this.scheduled));
  }

  private removeEvidence(id: string, source: string): void {
    const rows = this.db.prepare(`SELECT * FROM project_assets WHERE project_id = ? AND
      (EXISTS (SELECT 1 FROM json_each(COALESCE(semantics_json, '[]')) WHERE json_extract(value, '$.source') = ? AND json_extract(value, '$.type') != 'grid')
       OR json_extract(engine_meta_json, '$.source') = ?)`).all(id, source, source) as AssetRow[];
    for (const row of rows) {
      const semantics = (JSON.parse(row.semantics_json ?? '[]') as AssetSemantics).filter(entry => entry.source !== source || entry.type === 'grid');
      const meta = row.engine_meta_json ? JSON.parse(row.engine_meta_json) as EngineAssetMeta : undefined;
      this.db.prepare('UPDATE project_assets SET semantics_json = ?, engine_meta_json = ? WHERE project_id = ? AND rel_path = ?')
        .run(JSON.stringify(semantics), meta?.source === source ? JSON.stringify({ engine: meta.engine, source, pairMissing: true }) : row.engine_meta_json, id, row.rel_path);
    }
  }

  private async enrich(session: Session, rel: string): Promise<void> {
    const before = this.row(session.id, rel);
    if (!before) return;
    const file = await resolveAssetFile(this.projectsRoot, session.id, rel, session.metadata);
    const contentHash = before.content_hash ?? await hashAssetFile(file.filePath);
    let width: number | null = null, height: number | null = null;
    if (before.kind === 'image') {
      try { const meta = await sharp(file.filePath, { failOn: 'none' }).metadata(); width = meta.width ?? null; height = meta.height ?? null; }
      catch { /* Unsupported image formats still have useful inventory/hash facts. */ }
    }
    const after = await lstat(file.filePath);
    if (after.size !== before.size || after.mtimeMs !== before.mtime) return;
    this.db.prepare('UPDATE project_assets SET content_hash = ?, width = ?, height = ? WHERE project_id = ? AND rel_path = ? AND size = ? AND mtime = ?')
      .run(contentHash, width, height, session.id, rel, before.size, before.mtime);
    this.removeEvidence(session.id, rel);
    const evidence = await readAssetEvidence(file.filePath, rel);
    const pairing = session.metadata?.engineProfile?.importMetadata;
    const needsPair = pairing === 'unity-meta' ? !/\.(?:meta|import)$/i.test(rel)
      : pairing === 'godot-import' && ['image', 'audio', 'video', 'model3d', 'font'].includes(before.kind);
    if (needsPair) {
      const source = `${rel}${pairing === 'unity-meta' ? '.meta' : '.import'}`;
      try {
        const pair = await resolveAssetFile(this.projectsRoot, session.id, source, session.metadata);
        this.removeEvidence(session.id, source);
        evidence.push(...await readAssetEvidence(pair.filePath, source));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        this.db.prepare('UPDATE project_assets SET engine_meta_json = ? WHERE project_id = ? AND rel_path = ?')
          .run(JSON.stringify({ engine: pairing === 'unity-meta' ? 'unity' : 'godot', source, pairMissing: true }), session.id, rel);
      }
    }
    for (const item of evidence) {
      const target = this.row(session.id, item.target);
      if (!target) continue;
      const semantics = JSON.parse(target.semantics_json ?? '[]') as AssetSemantics;
      for (const entry of item.semantics) {
        const index = semantics.findIndex(old => old.source === entry.source && old.type === entry.type);
        if (index < 0) semantics.push(entry); else semantics[index] = entry;
      }
      this.db.prepare('UPDATE project_assets SET semantics_json = ?, engine_meta_json = ? WHERE project_id = ? AND rel_path = ?')
        .run(JSON.stringify(semantics), item.engineMeta ? JSON.stringify(item.engineMeta) : target.engine_meta_json, session.id, item.target);
    }
  }

  /**
   * Lets go of a project's folder: its watcher holds a handle on every
   * subfolder, which Windows counts as the folder being in use. The next read
   * for a project that still exists simply opens a new session.
   */
  async release(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    await Promise.allSettled([session.scan, session.updates]);
    await session.watcher?.unsubscribe();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.scheduled) clearImmediate(this.scheduled);
    this.queue.clear();
    await Promise.allSettled([...this.sessions.values()].map(async session => {
      try { await session.scan; await session.updates; }
      finally { await session.watcher?.unsubscribe(); }
    }));
    await this.background;
    this.sessions.clear();
  }
}
