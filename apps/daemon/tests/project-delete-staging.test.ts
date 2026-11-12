import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stageProjectDirsForDelete } from '../src/projects.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('project delete staging', () => {
  it('retries only unrestored directories after a partial rollback failure', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pixo-delete-partial-restore-'));
    roots.push(root);
    for (const id of ['project-a', 'project-b']) {
      mkdirSync(path.join(root, id));
      writeFileSync(path.join(root, id, 'original.txt'), id);
    }
    const staged = await stageProjectDirsForDelete(root, ['project-a', 'project-b'], 'batch-1');
    const collision = path.join(root, 'project-a');
    mkdirSync(collision);
    writeFileSync(path.join(collision, 'new.txt'), 'new occupant');
    await expect(staged.rollback()).rejects.toThrow('restore');
    expect(readFileSync(path.join(root, 'project-b', 'original.txt'), 'utf8')).toBe('project-b');
    expect(readFileSync(path.join(root, '.delete-staging', 'batch-1', 'project-a', 'original.txt'), 'utf8')).toBe('project-a');
    rmSync(collision, { recursive: true, force: true });
    await staged.rollback();
    expect(readFileSync(path.join(root, 'project-a', 'original.txt'), 'utf8')).toBe('project-a');
    expect(readFileSync(path.join(root, 'project-b', 'original.txt'), 'utf8')).toBe('project-b');
    expect(existsSync(path.join(root, '.delete-staging', 'batch-1'))).toBe(false);
  });

  it('retains staged originals when restoring a directory fails', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pixo-delete-restore-'));
    roots.push(root);
    const source = path.join(root, 'project-a');
    mkdirSync(source);
    writeFileSync(path.join(source, 'original.txt'), 'original project');
    const staged = await stageProjectDirsForDelete(root, ['project-a'], 'batch-1');
    // Another writer recreated the original path while the DB operation failed.
    // Restoring onto a nonempty directory must fail without deleting either copy.
    mkdirSync(source);
    writeFileSync(path.join(source, 'new.txt'), 'new occupant');
    await expect(staged.rollback()).rejects.toThrow('restore');
    const retained = path.join(root, '.delete-staging', 'batch-1', 'project-a', 'original.txt');
    expect(readFileSync(retained, 'utf8')).toBe('original project');
    expect(readFileSync(path.join(source, 'new.txt'), 'utf8')).toBe('new occupant');
    // After the collision is resolved, the same rollback can be retried safely.
    rmSync(source, { recursive: true, force: true });
    await staged.rollback();
    expect(readFileSync(path.join(source, 'original.txt'), 'utf8')).toBe('original project');
    expect(existsSync(path.join(root, '.delete-staging', 'batch-1'))).toBe(false);
  });

  it('rolls back already staged directories when a later project id fails', async () => {
    const root = path.join(tmpdir(), `pixo-delete-staging-${Date.now()}-${Math.random()}`);
    roots.push(root);
    const firstProjectDir = path.join(root, 'project-a');
    mkdirSync(firstProjectDir, { recursive: true });
    writeFileSync(path.join(firstProjectDir, 'index.html'), '<p>still here</p>');

    await expect(
      stageProjectDirsForDelete(root, ['project-a', '../bad'], 'batch-1'),
    ).rejects.toThrow('invalid project id');

    expect(existsSync(firstProjectDir)).toBe(true);
    expect(existsSync(path.join(firstProjectDir, 'index.html'))).toBe(true);
    expect(existsSync(path.join(root, '.delete-staging', 'batch-1', 'project-a'))).toBe(false);
  });
});
