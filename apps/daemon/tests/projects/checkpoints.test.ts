import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markCheckpointRunActive, ProjectCheckpoints } from '../../src/projects/checkpoints.js';

const folders: string[] = [];
const input = { runId: 'run-1', conversationId: 'conversation-1', summary: 'Make the player jump higher' };

function git(folder: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: folder, encoding: 'utf8', windowsHide: true }).trim();
}

async function fixture(initialized = true): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'openpixo-t2-checkpoints-'));
  folders.push(folder);
  await writeFile(path.join(folder, '.gitignore'), 'ignored/\nignored.txt\n');
  await writeFile(path.join(folder, 'game.txt'), 'original\n');
  await writeFile(path.join(folder, 'deleted.txt'), 'keep me\n');
  if (initialized) {
    git(folder, 'init', '--quiet');
    git(folder, 'config', 'user.name', 'Fixture');
    git(folder, 'config', 'user.email', 'fixture@local.invalid');
    git(folder, 'config', 'core.autocrlf', 'false');
    git(folder, 'add', '-A');
    git(folder, 'commit', '--quiet', '-m', 'Initial fixture');
  }
  return folder;
}

beforeEach(async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'openpixo-t2-git-config-'));
  folders.push(configDir);
  const config = path.join(configDir, 'gitconfig');
  await writeFile(config, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('XDG_CONFIG_HOME', configDir);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

describe('project checkpoints in real git repositories', () => {
  it('captures unstaged and untracked files, honors ignores, and preserves HEAD, branch, index and stash', async () => {
    const folder = await fixture();
    await writeFile(path.join(folder, 'game.txt'), 'stashed\n');
    git(folder, 'stash', 'push', '--quiet');
    await writeFile(path.join(folder, 'game.txt'), 'staged\n');
    git(folder, 'add', 'game.txt');
    await writeFile(path.join(folder, 'game.txt'), 'working tree\n');
    await writeFile(path.join(folder, 'new file.txt'), 'untracked\n');
    await writeFile(path.join(folder, 'ignored.txt'), 'private\n');
    const head = git(folder, 'rev-parse', 'HEAD');
    const branch = git(folder, 'symbolic-ref', 'HEAD');
    const stash = git(folder, 'rev-parse', 'refs/stash');
    const indexPath = path.join(folder, '.git', 'index');
    const index = await readFile(indexPath);

    const checkpoint = await new ProjectCheckpoints(folder).snapshot(input);
    expect(checkpoint).toMatchObject({ ...input, changedFileCount: 2, runChanges: null });
    const ref = `refs/openpixo/checkpoints/${checkpoint!.id}`;
    expect(git(folder, 'show', `${ref}:game.txt`)).toBe('working tree');
    expect(git(folder, 'show', `${ref}:new file.txt`)).toBe('untracked');
    expect(git(folder, 'ls-tree', '-r', '--name-only', ref)).not.toContain('ignored.txt');
    expect(git(folder, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(folder, 'symbolic-ref', 'HEAD')).toBe(branch);
    expect(git(folder, 'rev-parse', 'refs/stash')).toBe(stash);
    expect(await readFile(indexPath)).toEqual(index);
    expect((await readdir(path.join(folder, '.git'))).filter(name => name.startsWith('openpixo-index-'))).toEqual([]);
  });

  it('restores modified/deleted files, removes created files, preserves ignored files and can undo the restore', async () => {
    const folder = await fixture();
    const checkpoints = new ProjectCheckpoints(folder);
    const checkpoint = (await checkpoints.snapshot(input))!;
    await writeFile(path.join(folder, 'game.txt'), 'agent edit\n');
    await rm(path.join(folder, 'deleted.txt'));
    await writeFile(path.join(folder, 'created.txt'), 'agent addition\n');
    await writeFile(path.join(folder, 'ignored.txt'), 'keep private\n');
    const index = await readFile(path.join(folder, '.git', 'index'));
    const head = git(folder, 'rev-parse', 'HEAD');

    const finished = await checkpoints.finish(checkpoint.id);
    expect(finished.runChanges).toEqual([
      { path: 'created.txt', status: 'added' },
      { path: 'deleted.txt', status: 'deleted' },
      { path: 'game.txt', status: 'modified' },
    ]);
    const restored = await checkpoints.restore(checkpoint.id);
    expect(await readFile(path.join(folder, 'game.txt'), 'utf8')).toBe('original\n');
    expect(await readFile(path.join(folder, 'deleted.txt'), 'utf8')).toBe('keep me\n');
    await expect(readFile(path.join(folder, 'created.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(folder, 'ignored.txt'), 'utf8')).toBe('keep private\n');
    expect(await readFile(path.join(folder, '.git', 'index'))).toEqual(index);
    expect(git(folder, 'rev-parse', 'HEAD')).toBe(head);

    await checkpoints.restore(restored.backupCheckpoint.id);
    expect(await readFile(path.join(folder, 'game.txt'), 'utf8')).toBe('agent edit\n');
    await expect(readFile(path.join(folder, 'deleted.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(folder, 'created.txt'), 'utf8')).toBe('agent addition\n');
    expect((await new ProjectCheckpoints(folder).list()).status).toBe('available');
  });

  it('persists run changes at completion instead of attributing later edits to an earlier run', async () => {
    const folder = await fixture();
    const checkpoints = new ProjectCheckpoints(folder);
    const first = (await checkpoints.snapshot(input))!;
    await writeFile(path.join(folder, 'game.txt'), 'first run\n');
    await checkpoints.finish(first.id);
    const second = (await checkpoints.snapshot({ ...input, runId: 'run-2' }))!;
    expect(second.changedFileCount).toBe(1);
    expect(git(folder, 'rev-parse', `refs/openpixo/checkpoints/${second.id}^`))
      .toBe(git(folder, 'rev-parse', `refs/openpixo/checkpoints/${first.id}`));
    await writeFile(path.join(folder, 'later.txt'), 'later edit\n');
    const shown = await new ProjectCheckpoints(folder).show(first.id);
    expect(shown.checkpoint.runChanges).toEqual([{ path: 'game.txt', status: 'modified' }]);
    expect(shown.currentChanges.map(change => change.path)).toEqual(['game.txt', 'later.txt']);
  });

  it('prunes old refs and retains the most recent 50 checkpoints', async () => {
    const folder = await fixture();
    const checkpoints = new ProjectCheckpoints(folder);
    let firstId = '';
    for (let index = 0; index < 51; index += 1) {
      const checkpoint = (await checkpoints.snapshot({ ...input, runId: `run-${index}` }))!;
      firstId ||= checkpoint.id;
    }
    const listed = await checkpoints.list();
    expect(listed.status).toBe('available');
    expect(listed.checkpoints).toHaveLength(50);
    expect(listed.checkpoints.some(checkpoint => checkpoint.id === firstId)).toBe(false);
    expect(git(folder, 'for-each-ref', '--format=%(refname)', 'refs/openpixo/checkpoints/').split('\n')).toHaveLength(50);
  }, 90_000);

  it('reports unavailable for non-git folders and enables protection with a local initial commit', async () => {
    const folder = await fixture(false);
    const checkpoints = new ProjectCheckpoints(folder);
    expect(await checkpoints.list()).toEqual({ status: 'unavailable', reason: 'not_git', checkpoints: [] });
    expect(await checkpoints.snapshot(input)).toBeNull();
    await checkpoints.enable();
    expect(git(folder, 'show', '-s', '--format=%an <%ae>', 'HEAD')).toBe('OpenPixo <openpixo@local.invalid>');
    expect(git(folder, 'show', '-s', '--format=%B', 'HEAD')).not.toContain('Co-authored-by');
    expect(git(folder, 'show', 'HEAD:game.txt')).toBe('original');
    expect((await checkpoints.list()).status).toBe('available');
  });

  it('supports a git folder without HEAD and never creates HEAD during snapshot/restore', async () => {
    const folder = await fixture(false);
    git(folder, 'init', '--quiet');
    const checkpoints = new ProjectCheckpoints(folder);
    const checkpoint = (await checkpoints.snapshot(input))!;
    await writeFile(path.join(folder, 'game.txt'), 'changed\n');
    await checkpoints.restore(checkpoint.id);
    expect(await readFile(path.join(folder, 'game.txt'), 'utf8')).toBe('original\n');
    expect(() => git(folder, 'rev-parse', '--verify', 'HEAD')).toThrow();
    await expect(readFile(path.join(folder, '.git', 'index'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses arbitrary refs and nested project roots so restore cannot change files outside the project', async () => {
    const folder = await fixture();
    const checkpoints = new ProjectCheckpoints(folder);
    await expect(checkpoints.restore('HEAD')).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });
    await expect(checkpoints.restore('../../heads/main')).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });
    const { mkdir } = await import('node:fs/promises');
    const nested = path.join(folder, 'nested');
    await mkdir(nested);
    expect(await new ProjectCheckpoints(nested).list()).toMatchObject({ status: 'unavailable', reason: 'not_project_root' });
  });

  it('refuses a restore while an agent is active, then permits it once the run settles', async () => {
    const folder = await fixture();
    const checkpoints = new ProjectCheckpoints(folder);
    const checkpoint = (await checkpoints.snapshot(input))!;
    const release = await markCheckpointRunActive(folder);
    try {
      await writeFile(path.join(folder, 'game.txt'), 'running\n');
      await expect(checkpoints.restore(checkpoint.id)).rejects.toMatchObject({ code: 'CHECKPOINT_BUSY' });
      expect(await readFile(path.join(folder, 'game.txt'), 'utf8')).toBe('running\n');
    } finally { release(); }
    await checkpoints.restore(checkpoint.id);
    expect(await readFile(path.join(folder, 'game.txt'), 'utf8')).toBe('original\n');
  });

  it('keeps ignored files when a file/directory collision prevents restoration', async () => {
    const folder = await fixture();
    const checkpoints = new ProjectCheckpoints(folder);
    const checkpoint = (await checkpoints.snapshot(input))!;
    await rm(path.join(folder, 'game.txt'));
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(folder, 'game.txt'));
    await writeFile(path.join(folder, 'game.txt', 'private.txt'), 'do not remove\n');
    await writeFile(path.join(folder, '.gitignore'), 'game.txt/\n');
    await expect(checkpoints.restore(checkpoint.id)).rejects.toMatchObject({ code: 'CHECKPOINT_WORKTREE_CONFLICT' });
    expect(await readFile(path.join(folder, 'game.txt', 'private.txt'), 'utf8')).toBe('do not remove\n');
    expect((await checkpoints.list()).checkpoints.some(item => item.kind === 'before_restore')).toBe(true);
  });
});
