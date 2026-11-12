import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkpointStore, removeCheckpointStore, type CheckpointStore } from '../../src/projects/checkpoint-store.js';
import { createRunCheckpointHook } from '../../src/projects/checkpoint-run.js';
import { ProjectCheckpoints } from '../../src/projects/checkpoints.js';

let root: string;
let folder: string;
let store: CheckpointStore;
const input = { runId: 'run-1', conversationId: 'conversation-1', summary: 'Change the game' };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8' }).trim();
}

async function exists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch { return false; }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'openpixo-store-'));
  folder = path.join(root, 'game');
  await mkdir(folder);
  await writeFile(path.join(folder, 'game.js'), 'const speed = 1;\n');
  const config = path.join(root, 'gitconfig');
  await writeFile(config, '[core]\n\tautocrlf = true\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  store = checkpointStore(path.join(root, 'data'), 'project-1');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('a project that is not its own repository', () => {
  it('records a run, shows its diff and undoes it, without writing anything into the folder', async () => {
    const before = new ProjectCheckpoints(folder, undefined, store);
    expect(await before.list()).toEqual({ status: 'available', checkpoints: [], busy: false });

    const checkpoint = (await before.snapshot(input))!;
    expect(checkpoint.runId).toBe('run-1');
    await writeFile(path.join(folder, 'game.js'), 'const speed = 2;\n');
    await writeFile(path.join(folder, 'player.js'), 'export class Player {}\n');
    const finished = await new ProjectCheckpoints(folder, undefined, store).finish(checkpoint.id);
    expect(finished.runChanges).toEqual([{ path: 'game.js', status: 'modified' }, { path: 'player.js', status: 'added' }]);

    const after = new ProjectCheckpoints(folder, undefined, store);
    const diff = await after.diff(checkpoint.id, 'game.js');
    expect(diff.target).toBe('run_end');
    expect(diff.files[0]).toMatchObject({ additions: 1, deletions: 1 });
    expect(diff.files[0]!.hunks[0]!.lines.map(line => `${line.kind}:${line.text}`)).toEqual(['del:const speed = 1;', 'add:const speed = 2;']);

    expect(await exists(path.join(folder, '.git'))).toBe(false);
    expect(await exists(path.join(store.dir, 'HEAD'))).toBe(true);

    await after.restore(checkpoint.id);
    expect(await readFile(path.join(folder, 'game.js'), 'utf8')).toBe('const speed = 1;\n');
    expect(await exists(path.join(folder, 'player.js'))).toBe(false);
  });

  it('covers a folder inside someone else\'s repository, leaving that repository alone', async () => {
    git(root, 'init', '--quiet');
    const parentHead = (() => { git(root, 'commit', '--allow-empty', '-qm', 'parent'); return git(root, 'rev-parse', 'HEAD'); })();
    const checkpoints = new ProjectCheckpoints(folder, undefined, store);
    expect((await checkpoints.list()).status).toBe('available');
    const checkpoint = (await checkpoints.snapshot(input))!;
    await writeFile(path.join(folder, 'game.js'), 'const speed = 3;\n');
    expect((await new ProjectCheckpoints(folder, undefined, store).finish(checkpoint.id)).runChanges).toEqual([{ path: 'game.js', status: 'modified' }]);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(parentHead);
    expect(git(root, 'for-each-ref', 'refs/openpixo/')).toBe('');
  });

  it('keeps a run whose work creates the repository (a scaffold) in the store it started in', async () => {
    const checkpoint = (await new ProjectCheckpoints(folder, undefined, store).snapshot(input))!;
    git(folder, 'init', '--quiet');
    await writeFile(path.join(folder, 'scaffolded.js'), 'export {};\n');
    git(folder, 'add', '-A');
    git(folder, 'commit', '-qm', 'scaffold');
    const finished = await new ProjectCheckpoints(folder, undefined, store).finish(checkpoint.id);
    expect(finished.runChanges).toEqual([{ path: 'scaffolded.js', status: 'added' }]);
    const listed = await new ProjectCheckpoints(folder, undefined, store).list();
    expect(listed.checkpoints.map(item => item.id)).toEqual([checkpoint.id]);
  });

  it('leaves dependencies and engine output out of the record', async () => {
    const checkpoint = (await new ProjectCheckpoints(folder, undefined, store).snapshot(input))!;
    for (const [dir, name] of [['node_modules/left-pad', 'index.js'], ['Library', 'cache.bin'], ['.godot', 'uid'], ['scripts/node_modules', 'x.js']] as const) {
      await mkdir(path.join(folder, dir), { recursive: true });
      await writeFile(path.join(folder, dir, name), 'x');
    }
    await mkdir(path.join(folder, 'scripts/Library'), { recursive: true });
    await writeFile(path.join(folder, 'scripts/Library/mine.js'), 'x');
    const finished = await new ProjectCheckpoints(folder, undefined, store).finish(checkpoint.id);
    expect(finished.runChanges).toEqual([{ path: 'scripts/Library/mine.js', status: 'added' }]);
  });

  it('reports a folder too large to snapshot instead of hashing it on every run', async () => {
    const small = { dir: store.dir, limits: { maxFiles: 1, maxBytes: 1024 } };
    await writeFile(path.join(folder, 'second.js'), 'x');
    const checkpoints = new ProjectCheckpoints(folder, undefined, small);
    expect(await checkpoints.list()).toEqual({ status: 'unavailable', reason: 'project_too_large', checkpoints: [] });
    await expect(checkpoints.snapshot(input)).rejects.toMatchObject({ code: 'CHECKPOINT_UNAVAILABLE', message: 'project_too_large' });
    expect(await exists(store.dir)).toBe(false);
  });

  it('answers a project with no folder yet, rather than blaming a missing Git install', async () => {
    const missing = path.join(root, 'not-created-yet');
    expect(await new ProjectCheckpoints(missing, undefined, store).list()).toEqual({ status: 'available', checkpoints: [], busy: false });
  });

  it('goes away with its project', async () => {
    const dataRoot = path.join(root, 'data');
    await new ProjectCheckpoints(folder, undefined, store).snapshot(input);
    expect(await exists(store.dir)).toBe(true);
    await removeCheckpointStore(dataRoot, 'project-1');
    expect(await exists(store.dir)).toBe(false);
  });
});

describe('a folder that is its own repository', () => {
  it('keeps using that repository and never creates a store', async () => {
    git(folder, 'init', '--quiet');
    git(folder, 'add', '-A');
    git(folder, 'commit', '-qm', 'init');
    const checkpoints = new ProjectCheckpoints(folder, undefined, store);
    const checkpoint = (await checkpoints.snapshot(input))!;
    expect(git(folder, 'for-each-ref', '--format=%(refname)', 'refs/openpixo/checkpoints/')).toBe(`refs/openpixo/checkpoints/${checkpoint.id}`);
    expect(await exists(store.dir)).toBe(false);
  });
});

describe('the run hook', () => {
  it('gives the first run of a brand-new project a checkpoint', async () => {
    const managed = path.join(root, 'projects', 'project-1');
    let settle!: () => void;
    const terminal = new Promise<void>(resolve => { settle = resolve; });
    const warn = vi.fn();
    const run = { id: 'run-1', projectId: 'project-1', conversationId: 'c', status: 'running' };
    const hook = createRunCheckpointHook({
      projectDirectory: async () => { await mkdir(managed, { recursive: true }); return managed; },
      store: () => store,
      runs: { wait: () => terminal, isTerminal: () => false },
      warn,
    });
    const done = hook(run, { body: { message: 'Make a game' }, requestAnalyticsContext: null }, async () => {
      await writeFile(path.join(managed, 'game.js'), 'export {};\n');
      settle();
    });
    await done;
    expect(warn).not.toHaveBeenCalled();
    const listed = await new ProjectCheckpoints(managed, undefined, store).list();
    expect(listed.checkpoints[0]).toMatchObject({ runId: 'run-1', runChanges: [{ path: 'game.js', status: 'added' }] });
  });
});
