import type Database from 'better-sqlite3';

const migrated = new WeakSet<Database.Database>();
/** Derived project inventory and append-only lineage, in the daemon's existing DB. */
export function migrateProjectAssets(db: Database.Database): void {
  if (migrated.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_assets (
      project_id TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime TEXT,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      content_hash TEXT,
      width INTEGER, height INTEGER,
      duration_ms INTEGER,
      semantics_json TEXT,
      engine_meta_json TEXT,
      tags_json TEXT,
      indexed_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, rel_path)
    );
    CREATE INDEX IF NOT EXISTS idx_project_assets_hash ON project_assets(project_id, content_hash);
    CREATE TABLE IF NOT EXISTS asset_provenance (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      origin TEXT NOT NULL,
      run_id TEXT, media_task_id TEXT, recipe_run_id TEXT,
      provider TEXT, model TEXT,
      prompt_text TEXT,
      params_json TEXT,
      reference_hashes_json TEXT,
      parent_hashes_json TEXT,
      seed TEXT,
      cost_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_asset_provenance_hash ON asset_provenance(project_id, content_hash);
  `);
  migrated.add(db);
}
