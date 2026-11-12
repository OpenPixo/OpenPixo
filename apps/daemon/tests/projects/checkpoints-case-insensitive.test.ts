import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectCheckpoints } from '../../src/projects/checkpoints.js';

let temporaryRoot: string;
let folder: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: folder, encoding: 'utf8', windowsHide: true }).trim();
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openpixo-checkpoints-case-'));
  folder = path.join(temporaryRoot, 'game');
  await mkdir(folder);
  const config = path.join(temporaryRoot, 'gitconfig');
  await writeFile(config, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('XDG_CONFIG_HOME', temporaryRoot);
  git('init', '--quiet');
  git('config', 'core.ignorecase', 'true');
  git('config', 'core.autocrlf', 'false');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(temporaryRoot, { recursive: true, force: true });
});

async function collision(treePath = 'assets/Config.json', ignoredPath = 'assets/config.json') {
  await mkdir(path.dirname(path.join(folder, treePath)), { recursive: true });
  await writeFile(path.join(folder, treePath), 'checkpoint contents\n');
  const checkpoints = new ProjectCheckpoints(folder);
  const checkpoint = (await checkpoints.snapshot({ summary: 'Before configuration changes' }))!;
  await rm(path.join(folder, treePath.split('/')[0]!), { recursive: true, force: true });
  await writeFile(path.join(folder, '.gitignore'), `${ignoredPath}\n`);
  await mkdir(path.dirname(path.join(folder, ignoredPath)), { recursive: true });
  await writeFile(path.join(folder, ignoredPath), 'private ignored contents\n');
  return { checkpoints, checkpoint };
}

describe('checkpoint restore ignored-file case collisions', () => {
  it('guards ignored assets/config.json against checkpoint assets/Config.json when core.ignorecase is true', async () => {
    const { checkpoints, checkpoint } = await collision();

    await expect(checkpoints.restore(checkpoint.id)).rejects.toMatchObject({
      code: 'CHECKPOINT_WORKTREE_CONFLICT',
      message: 'An ignored file blocks the snapshot; the pre-restore checkpoint is retained',
    });
    expect(await readFile(path.join(folder, 'assets/config.json'), 'utf8')).toBe('private ignored contents\n');
    expect((await checkpoints.list()).checkpoints.some(item => item.kind === 'before_restore')).toBe(true);
  });

  it.each([
    ['an ignored ancestor file', 'Assets/Config.json/value.txt', 'assets/config.json'],
    ['a checkpoint ancestor file', 'Assets/Config.json', 'assets/config.json/private.txt'],
    ['NFC-equivalent paths', 'assets/Caf\u00e9.json', 'assets/cafe\u0301.json'],
  ])('guards %s using folded paths', async (_description, treePath, ignoredPath) => {
    const { checkpoints, checkpoint } = await collision(treePath, ignoredPath);
    await expect(checkpoints.restore(checkpoint.id)).rejects.toMatchObject({
      code: 'CHECKPOINT_WORKTREE_CONFLICT',
      message: 'An ignored file blocks the snapshot; the pre-restore checkpoint is retained',
    });
    expect(await readFile(path.join(folder, ignoredPath), 'utf8')).toBe('private ignored contents\n');
  });

  it('honors explicit core.ignorecase false even on a case-insensitive platform', async () => {
    const { checkpoints, checkpoint } = await collision();
    git('config', 'core.ignorecase', 'false');
    await writeFile(path.join(folder, '.gitignore'), 'assets/[cC]onfig.json\n');
    await expect(checkpoints.restore(checkpoint.id)).resolves.toMatchObject({ checkpoint: { id: checkpoint.id } });
    expect(await readFile(path.join(folder, 'assets/Config.json'), 'utf8')).toBe('checkpoint contents\n');
  });

  it('uses the platform fallback only when core.ignorecase is unset', async () => {
    const { checkpoints, checkpoint } = await collision();
    git('config', '--unset', 'core.ignorecase');
    if (['win32', 'darwin'].includes(process.platform)) {
      await expect(checkpoints.restore(checkpoint.id)).rejects.toMatchObject({ code: 'CHECKPOINT_WORKTREE_CONFLICT' });
      expect(await readFile(path.join(folder, 'assets/config.json'), 'utf8')).toBe('private ignored contents\n');
    } else {
      await expect(checkpoints.restore(checkpoint.id)).resolves.toMatchObject({ checkpoint: { id: checkpoint.id } });
      expect(await readFile(path.join(folder, 'assets/config.json'), 'utf8')).toBe('private ignored contents\n');
    }
  });
});
