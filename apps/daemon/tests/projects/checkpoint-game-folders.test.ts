// A Godot game made from a template is its own repository, holds gigabytes of art, and an
// export writes a 110 MB `.pck` through a temp file the engine keeps locked. Every checkpoint
// rebuilt its index from nothing, so `git add` read all of it again, ran past its timeout
// (SIGTERM), hit files other programs held open ("Permission denied"), and crashed outright
// (0xC0000005) while the agent kept writing (C23, 2026-11-21). No agent or model runs here.

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkpointStore, type CheckpointStore } from '../../src/projects/checkpoint-store.js';
import { createRunCheckpointHook } from '../../src/projects/checkpoint-run.js';
import { CHECKPOINT_MAX_UNTRACKED_FILE_BYTES, ProjectCheckpoints } from '../../src/projects/checkpoints.js';

vi.setConfig({ testTimeout: 60_000 });

let root: string;
let folder: string;
let store: CheckpointStore;
const input = { runId: 'run-1', conversationId: 'conversation-1', summary: 'Export the game' };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

async function write(relative: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(path.join(folder, relative)), { recursive: true });
  await writeFile(path.join(folder, relative), content);
}

function checkpoints(): ProjectCheckpoints {
  return new ProjectCheckpoints(folder, undefined, store);
}

/** Another program holding a file open without sharing it, as Godot does with an export it writes. */
function denyReading(relative: string): () => void {
  const target = path.join(folder, relative);
  if (process.platform === 'win32') {
    const user = process.env.USERNAME ?? '';
    execFileSync('icacls', [target, '/deny', `${user}:(RD)`], { windowsHide: true, stdio: 'ignore' });
    return () => execFileSync('icacls', [target, '/reset'], { windowsHide: true, stdio: 'ignore' });
  }
  execFileSync('chmod', ['000', target]);
  return () => execFileSync('chmod', ['644', target]);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'openpixo-game-folder-'));
  folder = path.join(root, '鸦堡');
  await mkdir(folder);
  const config = path.join(root, 'gitconfig');
  // The system Git for Windows default, which a game's own repository inherits.
  await writeFile(config, '[core]\n\tautocrlf = true\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('XDG_CONFIG_HOME', root);
  store = checkpointStore(path.join(root, 'data'), 'project-1');
  await write('project.godot', 'config_version=5\n');
  await write('scripts/main.gd', 'extends Node\n');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const layouts = [
  ['a game that is its own repository', async () => {
    git(folder, 'init', '--quiet');
    git(folder, 'add', '-A');
    git(folder, 'commit', '-qm', 'Initial project from godot4-2d');
  }],
  ['a game kept in a store', async () => {}],
] as const;

describe.each(layouts)('%s', (_name, prepare) => {
  beforeEach(async () => { await prepare(); });

  it('leaves engine caches, export temp files and large untracked binaries out of its checkpoints', async () => {
    const checkpoint = (await checkpoints().snapshot(input))!;
    await write('.godot/imported/hero.png-0f.ctex', 'cache');
    await write('export/Crowkeep.pck2774240.tmp', 'half an export');
    const export_ = Buffer.alloc(CHECKPOINT_MAX_UNTRACKED_FILE_BYTES + 1, 7);
    await write('export/Crowkeep.pck', export_);
    await write('export/README.md', '# How to run\n');
    await write('%SystemDrive%/ProgramData/Microsoft/Windows/Caches/cversions.2.db', 'icon cache');
    await write('scripts/player.gd', 'extends CharacterBody2D\n');

    const finished = await checkpoints().finish(checkpoint.id);
    expect(finished.runChanges).toEqual([
      { path: 'export/README.md', status: 'added' },
      { path: 'scripts/player.gd', status: 'added' },
    ]);
    // The export never entered the repository's objects: a game folder's .git must not grow by an export a run.
    const gitDir = checkpointsGitDir();
    const oid = execFileSync('git', ['hash-object', '--no-filters', path.join(folder, 'export/Crowkeep.pck')], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    expect(() => execFileSync('git', [`--git-dir=${gitDir}`, 'cat-file', '-e', oid], { cwd: root, windowsHide: true, stdio: 'ignore' })).toThrow();
  });

  it('does not read a recorded file again when it has not changed, so a file held open by another program does not fail the checkpoint', async () => {
    await write('art/hero.png', Buffer.from('not really a png'));
    const checkpoint = (await checkpoints().snapshot(input))!;
    const allow = denyReading('art/hero.png');
    try {
      await write('scripts/player.gd', 'extends CharacterBody2D\n');
      const finished = await checkpoints().finish(checkpoint.id);
      expect(finished.runChanges).toEqual([{ path: 'scripts/player.gd', status: 'added' }]);
      const shown = await checkpoints().show(checkpoint.id);
      expect(shown.currentChanges).toEqual([{ path: 'scripts/player.gd', status: 'added' }]);
    } finally { allow(); }
  });

  it('still sees what changed since the last checkpoint, including files that became ignored or large', async () => {
    await write('notes/todo.txt', 'one\n');
    await write('secret/key.txt', 'k\n');
    await write('derived/music.wav', 'small for now');
    const checkpoint = (await checkpoints().snapshot(input))!;
    await write('notes/todo.txt', 'two\n');
    await write('.gitignore', 'secret/\n');
    await write('derived/music.wav', Buffer.alloc(CHECKPOINT_MAX_UNTRACKED_FILE_BYTES + 1, 1));
    const finished = await checkpoints().finish(checkpoint.id);
    expect(finished.runChanges).toEqual([
      { path: '.gitignore', status: 'added' },
      { path: 'derived/music.wav', status: 'deleted' },
      { path: 'notes/todo.txt', status: 'modified' },
      { path: 'secret/key.txt', status: 'deleted' },
    ]);
  });
});

describe('a game that is its own repository', () => {
  beforeEach(async () => { await layouts[0][1](); });

  it('keeps a large file the game itself tracks', async () => {
    await write('store/trailer.mp4', Buffer.alloc(CHECKPOINT_MAX_UNTRACKED_FILE_BYTES + 1, 2));
    git(folder, 'add', 'store/trailer.mp4');
    git(folder, 'commit', '-qm', 'Add the trailer');
    const checkpoint = (await checkpoints().snapshot(input))!;
    await write('store/trailer.mp4', Buffer.alloc(CHECKPOINT_MAX_UNTRACKED_FILE_BYTES + 1, 3));
    expect((await checkpoints().finish(checkpoint.id)).runChanges).toEqual([{ path: 'store/trailer.mp4', status: 'modified' }]);
  });

  it('follows the game\'s own commits between checkpoints', async () => {
    await write('scripts/enemy.gd', 'extends Node\n');
    git(folder, 'add', 'scripts/enemy.gd');
    git(folder, 'commit', '-qm', 'Add an enemy');
    const checkpoint = (await checkpoints().snapshot(input))!;
    // The user stops tracking a file and ignores it: it leaves the record, as before.
    git(folder, 'rm', '--cached', '-q', 'scripts/enemy.gd');
    await write('.gitignore', 'scripts/enemy.gd\n');
    expect((await checkpoints().finish(checkpoint.id)).runChanges).toEqual([
      { path: '.gitignore', status: 'added' },
      { path: 'scripts/enemy.gd', status: 'deleted' },
    ]);
  });
});

describe('a checkpoint that keeps failing', () => {
  it('is logged once with its reason, not once per run', async () => {
    // A folder inside the game that is a repository of its own: checkpoints cannot cover it.
    await write('addons/plugin/plugin.cfg', '[plugin]\n');
    git(path.join(folder, 'addons/plugin'), 'init', '--quiet');
    const warn = vi.fn();
    const hook = createRunCheckpointHook({
      projectDirectory: async () => folder,
      store: () => store,
      runs: { wait: async () => {}, isTerminal: () => false },
      warn,
    });
    for (const id of ['run-1', 'run-2', 'run-3']) {
      await hook({ id, projectId: 'project-1', conversationId: 'c', status: 'running' }, { body: { message: 'Go' }, requestAnalyticsContext: null }, async () => {});
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatchObject({ runId: 'run-1', error: { code: 'CHECKPOINT_UNAVAILABLE', message: 'unsupported_repository' } });
  });
});

/** The game's own `.git`, or the store when the game has none. */
function checkpointsGitDir(): string {
  try { return path.resolve(folder, git(folder, 'rev-parse', '--git-dir')); }
  catch { return store.dir; }
}
