import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { insertMediaTask, migrateMediaTasks, updateMediaTask, getMediaTask } from '../../src/media/tasks.js';
import { recordAssetProvenance } from '../../src/assets/provenance-store.js';
vi.mock('../../src/assets/provenance-store.js', () => ({ recordAssetProvenance: vi.fn() }));

describe('Codex multi-image media task persistence', () => {
  it('retains all output metadata and records provenance for every image once', () => {
    const db = new Database(':memory:');
    try {
      db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('game')");
      migrateMediaTasks(db);
      insertMediaTask(db, { id: 't6-task', projectId: 'game', status: 'running' });
      const files = [1, 2].map(index => ({ name: 'sword-' + index + '.png', size: 70, mime: 'image/png',
        assetProvenance: { contentHash: 'hash-' + index, provider: 'codex-cli', model: 'codex-image', promptText: 'sword', params: {} } }));
      updateMediaTask(db, 't6-task', { status: 'done', file: { ...files[0], files } });
      expect(getMediaTask(db, 't6-task')!.file).toMatchObject({ files });
      expect(recordAssetProvenance).toHaveBeenCalledTimes(2);
      expect(recordAssetProvenance).toHaveBeenCalledWith(db, expect.objectContaining({ relPath: 'sword-2.png', mediaTaskId: 't6-task' }));
      updateMediaTask(db, 't6-task', { status: 'done' });
      expect(recordAssetProvenance).toHaveBeenCalledTimes(2);
    } finally { db.close(); }
  });
});
