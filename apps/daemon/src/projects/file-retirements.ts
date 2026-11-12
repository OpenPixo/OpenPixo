import type Database from 'better-sqlite3';

interface FileLifetime {
  sourceFileId: string;
  sourceFilePath: string;
}

/** Local file-removal intents fence identities while an outcome is uncertain. */
export function initializeFileRetirements(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS file_retirements (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_file_id TEXT NOT NULL,
    source_file_path TEXT NOT NULL,
    committed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, source_file_id)
  )`);
}

export function pendingFileRetirements(db: Database.Database, projectId: string) {
  return (db.prepare(`SELECT source_file_id, source_file_path, committed
    FROM file_retirements WHERE project_id = ?`).all(projectId) as Array<{
    source_file_id: string; source_file_path: string; committed: number;
  }>).map(row => ({ fact: { sourceFileId: row.source_file_id, sourceFilePath: row.source_file_path } satisfies FileLifetime,
    committed: row.committed === 1 }))
    .sort((a, b) => a.fact.sourceFilePath.localeCompare(b.fact.sourceFilePath));
}

export function assertFileNotPending(db: Database.Database, projectId: string,
  file: { sourceFileId?: string; filePath?: string }): void {
  if (pendingFileRetirements(db, projectId).some(row => row.fact.sourceFileId === file.sourceFileId
    || row.fact.sourceFilePath === file.filePath)) throw new Error('FILE_RETIREMENT_PENDING');
}
