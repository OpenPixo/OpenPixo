import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import {
  CHECKPOINT_DIFF_LIMITS,
  type GetProjectCheckpointDiffResponse,
  type GetProjectCheckpointFileDiffResponse,
} from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProject } from '../../src/db.js';
import { checkpointRelativePath, parseUnifiedDiff } from '../../src/projects/checkpoint-diff.js';
import { ProjectCheckpoints } from '../../src/projects/checkpoints.js';
import { registerProjectCheckpointRoutes } from '../../src/routes/project-checkpoints.js';

vi.mock('../../src/db.js', () => ({ getProject: vi.fn() }));

interface ApiError { error: { code: string; message: string } }

const PNG_BEFORE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1, 0, 0xff, 0x10]);
const PNG_AFTER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 2, 0, 0xfe, 0x20, 0]);

let temporaryRoot: string;
let folder: string;
let server: Server | undefined;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: folder, encoding: 'utf8', windowsHide: true }).trim();
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openpixo-checkpoint-diff-'));
  folder = path.join(temporaryRoot, 'game');
  await mkdir(path.join(folder, 'art'), { recursive: true });
  const config = path.join(temporaryRoot, 'gitconfig');
  await writeFile(config, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('XDG_CONFIG_HOME', temporaryRoot);
  await writeFile(path.join(folder, 'player.gd'), 'var speed = 10\nvar jump = 4\nfunc _ready():\n\tpass\n');
  await writeFile(path.join(folder, 'old.tscn'), 'scene\n');
  await writeFile(path.join(folder, 'art', 'hero.png'), PNG_BEFORE);
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  git('add', '-A');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@local.invalid', 'commit', '--quiet', '-m', 'Initial');
  vi.mocked(getProject).mockReturnValue({ id: 'project-1', metadata: { baseDir: folder } } as ReturnType<typeof getProject>);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
  vi.unstubAllEnvs();
  await rm(temporaryRoot, { recursive: true, force: true });
});

async function http() {
  const app = express();
  const portRef = { current: 0 };
  registerProjectCheckpointRoutes(app, {
    db: {} as Parameters<typeof getProject>[0], paths: { PROJECTS_DIR: temporaryRoot, RUNTIME_DATA_DIR: temporaryRoot },
    authorizeProjectRequest: vi.fn(async () => true), authorizeProjectToolRequest: vi.fn(async () => ({ projectId: 'project-1' })),
    isProjectBusy: () => false,
    http: {
      requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
      isLocalSameOrigin: () => true,
      resolvedPortRef: portRef,
      sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
    },
  });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  portRef.current = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${portRef.current}/api/projects/project-1/checkpoints`;
}

/** One finished run: edit player.gd, add a script and an image, delete a scene, change hero.png. */
async function finishedRun() {
  const checkpoints = new ProjectCheckpoints(folder);
  const checkpoint = (await checkpoints.snapshot({ runId: 'run-1', conversationId: 'conversation-1', summary: 'Jump higher' }))!;
  await writeFile(path.join(folder, 'player.gd'), 'var speed = 10\nvar jump = 9\nfunc _ready():\n\tpass\n');
  await writeFile(path.join(folder, 'enemy.gd'), 'extends Node\n');
  await rm(path.join(folder, 'old.tscn'));
  await writeFile(path.join(folder, 'art', 'hero.png'), PNG_AFTER);
  await checkpoints.finish(checkpoint.id);
  return { checkpoints, checkpoint };
}

describe('checkpoint diff', () => {
  it('compares the run start against the run end, not against later edits or the previous snapshot', async () => {
    const { checkpoints, checkpoint } = await finishedRun();
    // The user keeps editing after the run, and a later run snapshots again.
    await writeFile(path.join(folder, 'player.gd'), 'var speed = 99\nvar jump = 9\nfunc _ready():\n\tpass\n');
    await checkpoints.snapshot({ runId: 'run-2', conversationId: 'conversation-1', summary: 'Next' });

    const result = await checkpoints.diff(checkpoint.id);
    expect(result.target).toBe('run_end');
    expect(result.truncated).toBe(false);
    expect(result.files.map(file => [file.path, file.status]).sort()).toEqual([
      ['art/hero.png', 'modified'], ['enemy.gd', 'added'], ['old.tscn', 'deleted'], ['player.gd', 'modified'],
    ]);
    const player = result.files.find(file => file.path === 'player.gd')!;
    expect(player).toMatchObject({ binary: false, truncated: false, additions: 1, deletions: 1 });
    expect(player.hunks).toHaveLength(1);
    expect(player.hunks[0]!.header).toMatch(/^@@ -1,4 \+1,4 @@/u);
    expect(player.hunks[0]!.lines).toEqual([
      { kind: 'context', text: 'var speed = 10' },
      { kind: 'del', text: 'var jump = 4' },
      { kind: 'add', text: 'var jump = 9' },
      { kind: 'context', text: 'func _ready():' },
      { kind: 'context', text: '\tpass' },
    ]);
    expect(result.files.find(file => file.path === 'enemy.gd')!.hunks[0]!.lines).toEqual([{ kind: 'add', text: 'extends Node' }]);
    expect(result.files.find(file => file.path === 'old.tscn')!.hunks[0]!.lines).toEqual([{ kind: 'del', text: 'scene' }]);
  });

  it('shows a running run against the current files', async () => {
    const checkpoints = new ProjectCheckpoints(folder);
    const checkpoint = (await checkpoints.snapshot({ runId: 'run-1', summary: 'Working' }))!;
    await writeFile(path.join(folder, 'player.gd'), 'var speed = 12\nvar jump = 4\nfunc _ready():\n\tpass\n');
    const running = await checkpoints.diff(checkpoint.id, 'player.gd');
    expect(running.target).toBe('working_tree');
    expect(running.files[0]!.hunks[0]!.lines.filter(line => line.kind === 'add')).toEqual([{ kind: 'add', text: 'var speed = 12' }]);
  });

  it('flags binary files and serves both versions of an image', async () => {
    const { checkpoint } = await finishedRun();
    const url = await http();
    const image = await (await fetch(`${url}/${checkpoint.id}/diff?path=art/hero.png`)).json() as GetProjectCheckpointFileDiffResponse;
    expect(image).toMatchObject({ checkpointId: checkpoint.id, target: 'run_end', path: 'art/hero.png', status: 'modified',
      binary: true, hunks: [], additions: null, deletions: null });
    const before = await fetch(`${url}/${checkpoint.id}/file?path=art/hero.png&side=before`);
    expect(before.headers.get('content-type')).toBe('image/png');
    expect(before.headers.get('content-security-policy')).toContain('sandbox');
    expect(Buffer.from(await before.arrayBuffer())).toEqual(PNG_BEFORE);
    const after = await fetch(`${url}/${checkpoint.id}/file?path=art%5Chero.png&side=after`);
    expect(Buffer.from(await after.arrayBuffer())).toEqual(PNG_AFTER);
    const absent = await fetch(`${url}/${checkpoint.id}/file?path=enemy.gd&side=before`);
    expect(absent.status).toBe(404);
    expect((await absent.json() as ApiError).error.code).toBe('CHECKPOINT_FILE_ABSENT');
    expect((await fetch(`${url}/${checkpoint.id}/file?path=enemy.gd&side=sideways`)).status).toBe(400);
  });

  it('rejects paths that leave the project and paths the run did not change', async () => {
    const { checkpoint } = await finishedRun();
    const url = await http();
    for (const bad of ['../outside.txt', '/etc/passwd', 'C:/Windows/win.ini', 'art/../../outside', 'art//hero.png', './player.gd', '..\\outside']) {
      for (const endpoint of ['diff', 'file']) {
        const response = await fetch(`${url}/${checkpoint.id}/${endpoint}?path=${encodeURIComponent(bad)}&side=after`);
        expect(response.status, `${endpoint} ${bad}`).toBe(400);
        expect((await response.json() as ApiError).error.code).toBe('CHECKPOINT_PATH_INVALID');
      }
    }
    expect((await fetch(`${url}/${checkpoint.id}/diff?path=a&path=b`)).status).toBe(400);
    const unchanged = await fetch(`${url}/${checkpoint.id}/diff?path=README.md`);
    expect(unchanged.status).toBe(404);
    expect((await unchanged.json() as ApiError).error.code).toBe('CHECKPOINT_FILE_NOT_CHANGED');
    expect((await fetch(`${url}/missing-checkpoint-id/diff`)).status).toBe(404);
  });

  it('returns every changed file without a path and serves the same payload per file', async () => {
    const { checkpoint } = await finishedRun();
    const url = await http();
    const all = await (await fetch(`${url}/${checkpoint.id}/diff`)).json() as GetProjectCheckpointDiffResponse;
    expect(all).toMatchObject({ checkpointId: checkpoint.id, target: 'run_end', truncated: false });
    expect(all.files).toHaveLength(4);
    const single = await (await fetch(`${url}/${checkpoint.id}/diff?path=player.gd`)).json() as GetProjectCheckpointFileDiffResponse;
    const { checkpointId: _id, target: _target, ...file } = single;
    expect(file).toEqual(all.files.find(entry => entry.path === 'player.gd'));
  });

  it('cuts long diffs and skips oversized files at the size cap', async () => {
    const checkpoints = new ProjectCheckpoints(folder);
    const checkpoint = (await checkpoints.snapshot({ runId: 'run-1', summary: 'Generate' }))!;
    const lines = Array.from({ length: CHECKPOINT_DIFF_LIMITS.maxFileLines + 50 }, (_, index) => `line ${index}`).join('\n');
    await writeFile(path.join(folder, 'long.txt'), `${lines}\n`);
    await writeFile(path.join(folder, 'huge.json'), `${'x'.repeat(CHECKPOINT_DIFF_LIMITS.maxDiffBlobBytes + 10)}\n`);
    await checkpoints.finish(checkpoint.id);
    const result = await checkpoints.diff(checkpoint.id);
    const long = result.files.find(file => file.path === 'long.txt')!;
    expect(long.truncated).toBe(true);
    expect(long.additions).toBe(CHECKPOINT_DIFF_LIMITS.maxFileLines + 50);
    expect(long.hunks.reduce((total, hunk) => total + hunk.lines.length, 0)).toBe(CHECKPOINT_DIFF_LIMITS.maxFileLines);
    const huge = result.files.find(file => file.path === 'huge.json')!;
    expect(huge).toMatchObject({ truncated: true, binary: false, hunks: [], additions: 1 });
  });

  it('keeps end states only as long as their checkpoints', async () => {
    const { checkpoint } = await finishedRun();
    expect(git('for-each-ref', '--format=%(refname)', 'refs/openpixo/checkpoint-results/')).toBe(`refs/openpixo/checkpoint-results/${checkpoint.id}`);
    git('update-ref', '-d', `refs/openpixo/checkpoints/${checkpoint.id}`);
    await new ProjectCheckpoints(folder).snapshot({ summary: 'Prune' });
    expect(git('for-each-ref', '--format=%(refname)', 'refs/openpixo/checkpoint-results/')).toBe('');
  });
});

describe('checkpoint diff helpers', () => {
  it('accepts project-relative paths only', () => {
    expect(checkpointRelativePath('art\\hero.png')).toBe('art/hero.png');
    expect(checkpointRelativePath('scripts/player.gd')).toBe('scripts/player.gd');
    for (const bad of ['', '..', '../a', 'a/..', 'a/./b', '/a', 'C:a', 'c:\\a', 'a//b', 'a/', 'a\0b', 42]) {
      expect(checkpointRelativePath(bad), String(bad)).toBeNull();
    }
  });

  it('parses hunks and drops no-newline markers', () => {
    const parsed = parseUnifiedDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\r\n', 10);
    expect(parsed).toEqual({ lines: 2, truncated: false, hunks: [{ header: '@@ -1 +1 @@', lines: [{ kind: 'del', text: 'a' }, { kind: 'add', text: 'b' }] }] });
  });
});
