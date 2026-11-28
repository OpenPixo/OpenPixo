import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { listAssetProvenance, recordAssetProvenance } from '../src/assets/provenance-store.js';

// Every listed asset looks its provenance up by path or by content hash. As
// `rel_path = ? OR content_hash = ?` SQLite walked all of the project's
// provenance rows for each asset: 1,000 assets against 2,000 rows took about
// 165 ms, about 5 ms as two index seeks (measured 2026-11-28).

let db: Database.Database | null = null;
afterEach(() => { db?.close(); db = null; });

function record(target: Database.Database, id: string, projectId: string, relPath: string, contentHash: string, createdAt: number) {
  recordAssetProvenance(target, { id, projectId, relPath, contentHash, origin: 'generated', createdAt });
}

describe('asset provenance lookup', () => {
  it('seeks the path and the hash through indexes instead of walking the project', () => {
    db = new Database(':memory:');
    const prepared: string[] = [];
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => { prepared.push(sql); return prepare(sql); }) as typeof db.prepare;
    listAssetProvenance(db, 'p1', { relPath: 'art/a.png', contentHash: 'h1' });
    const lookup = prepared.find((sql) => sql.includes('FROM asset_provenance WHERE'))!;
    const plan = (prepare(`EXPLAIN QUERY PLAN ${lookup}`).all('p1', 'art/a.png', 'p1', 'h1') as { detail: string }[])
      .map(({ detail }) => detail);
    expect(plan.some((detail) => /\(project_id=\? AND rel_path=\?\)/.test(detail))).toBe(true);
    expect(plan.some((detail) => /\(project_id=\? AND content_hash=\?\)/.test(detail))).toBe(true);
  });

  it('still finds lineage by path and by hash after a rename, newest first, within the project', () => {
    db = new Database(':memory:');
    record(db, 'by-path', 'p1', 'art/hero.png', 'old-hash', 1);
    record(db, 'by-hash', 'p1', 'art/renamed.png', 'current-hash', 2);
    record(db, 'unrelated', 'p1', 'art/other.png', 'other-hash', 3);
    record(db, 'other-project', 'p2', 'art/hero.png', 'current-hash', 4);
    const found = listAssetProvenance(db, 'p1', { relPath: 'art/hero.png', contentHash: 'current-hash' });
    expect(found.map(({ id }) => id)).toEqual(['by-hash', 'by-path']);
    expect(found.map(({ modifiedSinceProvenance }) => modifiedSinceProvenance)).toEqual([false, true]);
    expect(listAssetProvenance(db, 'p1').map(({ id }) => id)).toEqual(['unrelated', 'by-hash', 'by-path']);
  });
});
