import { execFileSync } from 'node:child_process';
import { mkdtemp, rm as realRm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A Git process the daemon just stopped, or a virus scanner, can hold `<index>.lock` on Windows.
const lockedFiles = vi.hoisted(() => ({ pattern: null as RegExp | null }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (lockedFiles.pattern?.test(String(args[0]))) {
        throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${String(args[0])}'`), { code: 'EBUSY', syscall: 'unlink' });
      }
      return actual.rm(...args);
    },
  };
});

const { ProjectCheckpoints } = await import('../../src/projects/checkpoints.js');

const folders: string[] = [];

function git(folder: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: folder, encoding: 'utf8', windowsHide: true }).trim();
}

beforeEach(async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'openpixo-index-cleanup-config-'));
  folders.push(configDir);
  await writeFile(path.join(configDir, 'gitconfig'), '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(configDir, 'gitconfig'));
  vi.stubEnv('XDG_CONFIG_HOME', configDir);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});

afterEach(async () => {
  lockedFiles.pattern = null;
  vi.unstubAllEnvs();
  await Promise.all(folders.splice(0).map(folder => realRm(folder, { recursive: true, force: true })));
});

describe('checkpoint disposable index cleanup', () => {
  it('records a finished run even when the disposable index lock cannot be removed', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'openpixo-index-cleanup-'));
    folders.push(folder);
    await writeFile(path.join(folder, 'game.txt'), 'original\n');
    git(folder, 'init', '--quiet');
    git(folder, 'add', '-A');
    git(folder, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@local.invalid', 'commit', '--quiet', '-m', 'Initial');

    const checkpoint = await new ProjectCheckpoints(folder).snapshot({ runId: 'run-1', summary: 'Jump higher' });
    await writeFile(path.join(folder, 'game.txt'), 'changed\n');

    lockedFiles.pattern = /openpixo-index-[^\\/]+\.lock$/u;
    const finished = await new ProjectCheckpoints(folder).finish(checkpoint!.id);

    expect(finished.completedAt).toEqual(expect.any(String));
    expect(finished.runChanges).toEqual([{ path: 'game.txt', status: 'modified' }]);
    lockedFiles.pattern = null;
    const listed = await new ProjectCheckpoints(folder).list();
    expect(listed.checkpoints[0]).toMatchObject({ id: checkpoint!.id, runChanges: [{ path: 'game.txt', status: 'modified' }] });
  });
});
