// OpenPixo keeps its own bookkeeping (HTML version history, reserved folders)
// inside a managed project's folder. A checkpoint describes the user's files, so
// a run must not report that bookkeeping as changed and undoing a run must not
// rewind it. The runs here are fake: no agent or model is involved.

import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { ProjectCheckpoint, RestoreProjectCheckpointResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProject } from '../../src/db.js';
import {
  listProjectFileVersions,
  markProjectFileVersionStoreDeleted,
  readProjectFileVersion,
} from '../../src/project-file-versions.js';
import { checkpointStore, type CheckpointStore } from '../../src/projects/checkpoint-store.js';
import { createRunCheckpointHook } from '../../src/projects/checkpoint-run.js';
import { ProjectCheckpoints } from '../../src/projects/checkpoints.js';
import { registerProjectCheckpointRoutes } from '../../src/routes/project-checkpoints.js';
import { snapshotAiHtmlVersionsForRun } from '../../src/run-html-version-snapshots.js';

vi.mock('../../src/db.js', () => ({ getProject: vi.fn() }));
// Every checkpoint step spawns several Git processes, and a test here takes several runs.
vi.setConfig({ testTimeout: 60_000 });

const projectId = 'project-1';
let root: string;
let projectsRoot: string;
let folder: string;
let html: string;
let dataRoot: string;
let store: CheckpointStore;
let server: Server | undefined;

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8', input, windowsHide: true }).trim();
}

async function exists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch { return false; }
}

function checkpoints(): ProjectCheckpoints {
  return new ProjectCheckpoints(folder, undefined, store);
}

async function write(relative: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(folder, relative)), { recursive: true });
  await writeFile(path.join(folder, relative), content);
}

/** A run as the daemon orders it: edits, version snapshot before success, then the checkpoint completes. */
async function run(runId: string, work: () => Promise<void>): Promise<ProjectCheckpoint> {
  let settle!: () => void;
  const terminal = new Promise<void>(resolve => { settle = resolve; });
  const warn = vi.fn();
  const hook = createRunCheckpointHook({
    projectDirectory: async () => folder,
    store: () => store,
    runs: { wait: () => terminal, isTerminal: () => false },
    warn,
  });
  await hook({ id: runId, projectId, conversationId: 'conversation-1', status: 'running' }, { body: { message: 'Make it better' }, requestAnalyticsContext: null }, async () => {
    await work();
    settle();
  });
  expect(warn).not.toHaveBeenCalled();
  return (await checkpoints().list()).checkpoints.find(checkpoint => checkpoint.runId === runId)!;
}

function runEditingHtml(runId: string, content: string): Promise<ProjectCheckpoint> {
  return run(runId, async () => {
    await writeFile(html, content);
    await snapshotAiHtmlVersionsForRun({
      projectsRoot, projectId, projectRoot: folder, diff: { touchedPaths: [html] }, prompt: 'Make it better', promptSource: 'message',
    });
  });
}

async function versions() {
  return (await listProjectFileVersions(projectsRoot, projectId, 'index.html'))
    .map(version => ({ version: version.version, source: version.source, current: version.current, label: version.label }));
}

async function versionContents(): Promise<string[]> {
  const listed = await listProjectFileVersions(projectsRoot, projectId, 'index.html');
  return Promise.all(listed.map(async version => (await readProjectFileVersion(projectsRoot, projectId, 'index.html', version.id)).content));
}

/** The undo the UI and `pixo` both call. */
async function undo(checkpointId: string): Promise<RestoreProjectCheckpointResponse> {
  if (!server) {
    const app = express();
    app.use(express.json());
    const portRef = { current: 0 };
    registerProjectCheckpointRoutes(app, {
      db: {} as Parameters<typeof getProject>[0],
      paths: { PROJECTS_DIR: projectsRoot, RUNTIME_DATA_DIR: dataRoot },
      authorizeProjectRequest: vi.fn(async () => true),
      authorizeProjectToolRequest: vi.fn(async () => ({ projectId })),
      isProjectBusy: () => false,
      http: {
        requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
        isLocalSameOrigin: () => true,
        resolvedPortRef: portRef,
        sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
      },
    });
    server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  }
  const { port } = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId}/checkpoints/${checkpointId}/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
  });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body as RestoreProjectCheckpointResponse;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'openpixo-internal-'));
  projectsRoot = path.join(root, 'projects');
  folder = path.join(projectsRoot, projectId);
  html = path.join(folder, 'index.html');
  dataRoot = path.join(root, 'data');
  store = checkpointStore(dataRoot, projectId);
  await mkdir(folder, { recursive: true });
  await writeFile(html, '<html>start</html>');
  const config = path.join(root, 'gitconfig');
  await writeFile(config, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('XDG_CONFIG_HOME', root);
  vi.mocked(getProject).mockReturnValue({ id: projectId, metadata: {} } as ReturnType<typeof getProject>);
});
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe.each([
  ['a project without its own repository', async () => {}],
  ['a folder that is its own repository', async () => {
    git(folder, ['init', '--quiet']);
    git(folder, ['add', '-A']);
    git(folder, ['commit', '-qm', 'init']);
  }],
])('%s', (_name, prepare) => {
  beforeEach(prepare);

  it('reports only the real file when a run edits HTML and creates its first version', async () => {
    const checkpoint = await runEditingHtml('run-1', '<html>first</html>');
    expect(await exists(path.join(folder, '.file-versions'))).toBe(true);
    expect(checkpoint.runChanges).toEqual([{ path: 'index.html', status: 'modified' }]);
  });

  it('reports only the real file on a later run, when the version manifest already exists', async () => {
    await runEditingHtml('run-1', '<html>first</html>');
    const checkpoint = await runEditingHtml('run-2', '<html>second</html>');
    expect(checkpoint.runChanges).toEqual([{ path: 'index.html', status: 'modified' }]);
    expect(checkpoint.changedFileCount).toBe(1);
  });

  it('keeps version files out of the diff and the live list of a running turn', async () => {
    const checkpoint = await runEditingHtml('run-1', '<html>first</html>');
    const diff = await checkpoints().diff(checkpoint.id);
    expect(diff.files.map(file => file.path)).toEqual(['index.html']);
    const shown = await checkpoints().show(checkpoint.id);
    expect(shown.currentChanges).toEqual([{ path: 'index.html', status: 'modified' }]);
  });

  it('leaves reserved folders out at any depth, and files with similar names in', async () => {
    const checkpoint = await run('run-1', async () => {
      await write('.live-artifacts/a/index.html', 'x');
      await write('src/.file-versions/a/manifest.json', 'x');
      await write('file-versions/keep.txt', 'x');
      await write('.file-versions-notes.txt', 'x');
    });
    expect(checkpoint.runChanges).toEqual([
      { path: '.file-versions-notes.txt', status: 'added' },
      { path: 'file-versions/keep.txt', status: 'added' },
    ]);
  });

  it('undoes a run: the project file goes back and every version stays readable', async () => {
    await runEditingHtml('run-1', '<html>first</html>');
    const second = await runEditingHtml('run-2', '<html>second</html>');
    await write('notes.md', 'made by the run');
    const restored = await undo(second.id);

    expect(await readFile(html, 'utf8')).toBe('<html>first</html>');
    expect(await exists(path.join(folder, 'notes.md'))).toBe(false);
    expect(restored.restoredFiles.map(file => file.path).sort()).toEqual(['index.html', 'notes.md']);
    // Append-only, like restoring from the viewer: nothing removed, and "current" is the file again.
    expect(await versions()).toEqual([
      { version: 1, source: 'ai', current: false, label: 'Version 1' },
      { version: 2, source: 'ai', current: false, label: 'Version 2' },
      { version: 3, source: 'restore', current: true, label: 'Version 3 · restored from v1' },
    ]);
    expect(await versionContents()).toEqual(['<html>first</html>', '<html>second</html>', '<html>first</html>']);
  });

  it('can redo an undo, still without losing a version', async () => {
    await runEditingHtml('run-1', '<html>first</html>');
    const second = await runEditingHtml('run-2', '<html>second</html>');
    const restored = await undo(second.id);
    await undo(restored.backupCheckpoint.id);
    expect(await readFile(html, 'utf8')).toBe('<html>second</html>');
    expect((await versions()).map(version => [version.version, version.current])).toEqual([[1, false], [2, false], [3, false], [4, true]]);
    expect((await versionContents()).at(-1)).toBe('<html>second</html>');
  });

  it('adds no version when the undo did not change what the current version holds', async () => {
    const created = await run('run-1', async () => {
      const made = path.join(folder, 'made.html');
      await writeFile(made, '<html>made</html>');
      await snapshotAiHtmlVersionsForRun({ projectsRoot, projectId, projectRoot: folder, diff: { touchedPaths: [made] }, prompt: 'x', promptSource: 'message' });
    });
    const history = () => listProjectFileVersions(projectsRoot, projectId, 'made.html');
    const restored = await undo(created.id);
    // The run made this file, so undo removes it. Its history stays; nothing is said to be current instead.
    expect(await exists(path.join(folder, 'made.html'))).toBe(false);
    expect((await history()).map(version => [version.version, version.current])).toEqual([[1, true]]);
    await undo(restored.backupCheckpoint.id);
    expect(await readFile(path.join(folder, 'made.html'), 'utf8')).toBe('<html>made</html>');
    expect((await history()).map(version => [version.version, version.current])).toEqual([[1, true]]);
  });

  it('keeps the history of a deleted page when an undo brings the page back', async () => {
    await runEditingHtml('run-1', '<html>first</html>');
    const deletion = await run('run-2', async () => {
      await rm(html);
      await markProjectFileVersionStoreDeleted(projectsRoot, projectId, 'index.html');
    });
    await undo(deletion.id);
    expect(await readFile(html, 'utf8')).toBe('<html>first</html>');
    expect((await versions()).map(version => [version.version, version.current])).toEqual([[1, true]]);
    // The deletion no longer stands, so the next write adds to the history instead of replacing it.
    await runEditingHtml('run-3', '<html>third</html>');
    expect(await versionContents()).toEqual(['<html>first</html>', '<html>third</html>']);
  });

  it('still undoes the files when the version history cannot be updated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runEditingHtml('run-1', '<html>first</html>');
    const second = await runEditingHtml('run-2', '<html>second</html>');
    const [key] = await readdir(path.join(folder, '.file-versions'));
    await writeFile(path.join(folder, '.file-versions', key!, 'manifest.json'), 'not json');
    await undo(second.id);
    expect(await readFile(html, 'utf8')).toBe('<html>first</html>');
    expect(warn).toHaveBeenCalled();
  });
});

describe('a folder that is its own repository, where an agent committed the history', () => {
  it('neither reports nor rewinds it, and leaves the user\'s branch alone', async () => {
    git(folder, ['init', '--quiet']);
    await write('.file-versions/abc/manifest.json', 'committed');
    git(folder, ['add', '-A']);
    git(folder, ['commit', '-qm', 'init']);
    const head = git(folder, ['rev-parse', 'HEAD']);

    const checkpoint = await run('run-1', async () => {
      await writeFile(html, '<html>after</html>');
      await write('.file-versions/abc/manifest.json', 'written during the run');
    });
    expect(checkpoint.runChanges).toEqual([{ path: 'index.html', status: 'modified' }]);

    await undo(checkpoint.id);
    expect(await readFile(html, 'utf8')).toBe('<html>start</html>');
    expect(await readFile(path.join(folder, '.file-versions/abc/manifest.json'), 'utf8')).toBe('written during the run');
    expect(git(folder, ['rev-parse', 'HEAD'])).toBe(head);
  });
});

/**
 * Checkpoints taken before version files stayed out still hold them in their
 * trees and frozen lists, and a store made then has them missing from its
 * excludes. Those checkpoints stay on the user's machine after an update.
 */
describe.each([
  ['a checkpoint store', false],
  ['the project\'s own repository', true],
])('a checkpoint from before this was fixed, in %s', (_name, ownRepository) => {
  function historyGit(args: string[], index?: string, input?: string): string {
    const location = ownRepository ? [] : [`--git-dir=${store.dir}`, `--work-tree=${folder}`];
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...location, ...args], {
      cwd: folder, encoding: 'utf8', input, windowsHide: true, env: { ...process.env, ...(index ? { GIT_INDEX_FILE: index } : {}) },
    }).trim();
  }

  /** The whole folder as a tree, version files included, as the old snapshot took it. */
  function treeOfEverything(): string {
    const index = path.join(root, `old-index-${Math.random().toString(36).slice(2)}`);
    historyGit(['add', '-A', '--', '.'], index);
    return historyGit(['write-tree'], index);
  }

  function rewriteCheckpoint(id: string, tree: string, patch: Partial<ProjectCheckpoint>): void {
    const ref = `refs/openpixo/checkpoints/${id}`;
    const message = historyGit(['for-each-ref', '--format=%(contents:subject)', ref]);
    const prefix = 'OpenPixo checkpoint ';
    const updated = `${prefix}${JSON.stringify({ ...JSON.parse(message.slice(prefix.length)), ...patch })}\n`;
    const commit = historyGit(['commit-tree', tree], undefined, updated);
    historyGit(['update-ref', ref, commit]);
  }

  async function checkpointFromBefore(): Promise<ProjectCheckpoint> {
    if (ownRepository) {
      git(folder, ['init', '--quiet']);
      git(folder, ['add', '-A']);
      git(folder, ['commit', '-qm', 'init']);
    }
    await write('.file-versions/abc/manifest.json', 'manifest before the run');
    await write('.file-versions/abc/0001.html', 'version one');
    const checkpoint = (await checkpoints().snapshot({ runId: 'run-old', conversationId: 'conversation-1', summary: 'Old run' }))!;
    if (!ownRepository) {
      const exclude = path.join(store.dir, 'info', 'exclude');
      const lines = (await readFile(exclude, 'utf8')).split('\n');
      await writeFile(exclude, lines.filter(line => !line.includes('.file-versions') && !line.includes('.live-artifacts')).join('\n'));
    }
    const before = treeOfEverything();
    await writeFile(html, '<html>after</html>');
    await write('.file-versions/abc/manifest.json', 'manifest after the run');
    await write('.file-versions/abc/0002.html', 'version two');
    const after = treeOfEverything();
    historyGit(['update-ref', `refs/openpixo/checkpoint-results/${checkpoint.id}`, after]);
    rewriteCheckpoint(checkpoint.id, before, {
      completedAt: '2026-11-07T00:00:00.000Z',
      runChanges: [
        { path: '.file-versions/abc/0002.html', status: 'added' },
        { path: '.file-versions/abc/manifest.json', status: 'modified' },
        { path: 'index.html', status: 'modified' },
      ],
    });
    return checkpoint;
  }

  it('lists and diffs only the real file', async () => {
    const checkpoint = await checkpointFromBefore();
    const listed = (await checkpoints().list()).checkpoints.find(item => item.id === checkpoint.id)!;
    expect(listed.runChanges).toEqual([{ path: 'index.html', status: 'modified' }]);
    expect((await checkpoints().diff(checkpoint.id)).files.map(file => file.path)).toEqual(['index.html']);
    expect((await checkpoints().show(checkpoint.id)).currentChanges).toEqual([{ path: 'index.html', status: 'modified' }]);
  });

  it('can still be undone, without rewinding the history', async () => {
    const checkpoint = await checkpointFromBefore();
    const restored = await undo(checkpoint.id);
    expect(await readFile(html, 'utf8')).toBe('<html>start</html>');
    expect(restored.restoredFiles).toEqual([{ path: 'index.html', status: 'modified' }]);
    expect(await readFile(path.join(folder, '.file-versions/abc/manifest.json'), 'utf8')).toBe('manifest after the run');
    expect(await readFile(path.join(folder, '.file-versions/abc/0002.html'), 'utf8')).toBe('version two');
  });
});

describe('the project size limit', () => {
  it('does not count version history', async () => {
    for (const name of ['manifest.json', '0001.html', '0002.html', '0003.html']) await write(`.file-versions/abc/${name}`, 'x');
    const limited = new ProjectCheckpoints(folder, undefined, { dir: store.dir, limits: { maxFiles: 1, maxBytes: 1024 } });
    expect((await limited.list()).status).toBe('available');
  });
});
