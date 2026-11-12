import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AssetProvenance } from '@openpixo/contracts';
import { migrateProjectAssets } from './store.js';

export type RecordAssetProvenanceInput = Omit<AssetProvenance, 'id' | 'createdAt' | 'modifiedSinceProvenance'> & {
  id?: string;
  createdAt?: number;
};

/**
 * Shared by media generation, asset ops and recipe adoption. Call with the daemon
 * DB and the SHA-256 of the bytes actually written; paths use POSIX separators.
 * Synchronous and append-only; no project-file or data-root discovery occurs here.
 */
export function recordAssetProvenance(db: Database.Database, input: RecordAssetProvenanceInput): AssetProvenance {
  migrateProjectAssets(db);
  const record: AssetProvenance = { ...input, id: input.id ?? randomUUID(), createdAt: input.createdAt ?? Date.now() };
  db.prepare(`INSERT INTO asset_provenance
    (id, project_id, rel_path, content_hash, origin, run_id, media_task_id, recipe_run_id,
     provider, model, prompt_text, params_json, reference_hashes_json, parent_hashes_json, seed, cost_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    record.id, record.projectId, record.relPath, record.contentHash, record.origin,
    record.runId ?? null, record.mediaTaskId ?? null, record.recipeRunId ?? null,
    record.provider ?? null, record.model ?? null, record.promptText ?? null,
    json(record.params), json(record.referenceHashes), json(record.parentHashes), record.seed ?? null,
    json(record.cost), record.createdAt,
  );
  return record;
}

/** Matches the original path OR the current hash, preserving lineage on rename. */
export function listAssetProvenance(
  db: Database.Database,
  projectId: string,
  filter: { relPath?: string; contentHash?: string } = {},
): AssetProvenance[] {
  migrateProjectAssets(db);
  const currentHash = filter.contentHash ?? (filter.relPath
    ? (db.prepare('SELECT content_hash FROM project_assets WHERE project_id = ? AND rel_path = ?')
      .get(projectId, filter.relPath) as { content_hash: string | null } | undefined)?.content_hash
    : undefined);
  const rows = db.prepare(`SELECT id, project_id AS projectId, rel_path AS relPath, content_hash AS contentHash,
    origin, run_id AS runId, media_task_id AS mediaTaskId, recipe_run_id AS recipeRunId, provider, model,
    prompt_text AS promptText, params_json AS params, reference_hashes_json AS referenceHashes,
    parent_hashes_json AS parentHashes, seed, cost_json AS cost, created_at AS createdAt
    FROM asset_provenance WHERE project_id = ?
    ${filter.relPath || currentHash ? 'AND (rel_path = ? OR content_hash = ?)' : ''}
    ORDER BY created_at DESC, rowid DESC`).all(projectId,
      ...(filter.relPath || currentHash ? [filter.relPath ?? null, currentHash ?? null] : [])) as Record<string, unknown>[];
  return rows.map(row => {
    const record = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as unknown as AssetProvenance;
    for (const key of ['params', 'referenceHashes', 'parentHashes', 'cost'] as const) {
      if (typeof row[key] === 'string') Object.assign(record, { [key]: JSON.parse(row[key]) });
    }
    if (currentHash) record.modifiedSinceProvenance = record.contentHash !== currentHash;
    return record;
  });
}

function json(value: unknown): string | null { return value === undefined ? null : JSON.stringify(value); }
