import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import type { GetProjectCheckpointResponse, ListProjectCheckpointsResponse, RestoreProjectCheckpointResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toolTokenRegistry } from '../../src/tool-tokens.js';
import { getProject } from '../../src/db.js';
import { checkpointStore } from '../../src/projects/checkpoint-store.js';
import { ProjectCheckpoints } from '../../src/projects/checkpoints.js';
import { createRunCheckpointHook } from '../../src/projects/checkpoint-run.js';
import { registerProjectCheckpointRoutes } from '../../src/routes/project-checkpoints.js';
import { createInternalRunCreationService } from '../../src/services/internal-run-service.js';

vi.mock('../../src/db.js', () => ({ getProject: vi.fn() }));

let temporaryRoot: string;
let folder: string;
let server: Server | undefined;
beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openpixo-t2-flow-'));
  folder = path.join(temporaryRoot, 'game');
  await mkdir(folder);
  const config = path.join(temporaryRoot, 'gitconfig');
  await writeFile(config, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('XDG_CONFIG_HOME', temporaryRoot);
  await writeFile(path.join(folder, 'game.txt'), 'before\n');
  vi.mocked(getProject).mockReturnValue({ id: 'project-1', metadata: { baseDir: folder } } as ReturnType<typeof getProject>);
});
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
  toolTokenRegistry.clear();
  vi.unstubAllEnvs();
  await rm(temporaryRoot, { recursive: true, force: true });
});

async function http() {
  const app = express();
  app.use(express.json());
  const portRef = { current: 0 };
  const authorize = vi.fn(async () => true);
  let active = false;
  registerProjectCheckpointRoutes(app, {
    db: {} as Parameters<typeof getProject>[0], paths: { PROJECTS_DIR: temporaryRoot, RUNTIME_DATA_DIR: temporaryRoot }, authorizeProjectRequest: authorize, authorizeProjectToolRequest: vi.fn(async () => ({ projectId: 'project-1' })), isProjectBusy: () => active,
    http: {
      requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
      isLocalSameOrigin: (req: express.Request) => req.get('origin') === `http://127.0.0.1:${portRef.current}`,
      resolvedPortRef: portRef,
      sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
    },
  });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  portRef.current = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${portRef.current}`;
  const url = `${origin}/api/projects/project-1/checkpoints`;
  const post = (suffix: string, confirmed = true, requestOrigin = origin) => fetch(url + suffix, {
    method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed }),
  });
  return { url, post, authorize, setActive(value: boolean) { active = value; } };
}

describe('checkpoint HTTP and physical run boundaries', () => {
  it('requires confirmation, lists/shows and restores a project with no repository through the same project HTTP API', async () => {
    const { url, post } = await http();
    const store = checkpointStore(temporaryRoot, 'project-1');
    expect(await (await fetch(url)).json()).toMatchObject({ status: 'available', checkpoints: [] });
    expect((await post('/enable', false)).status).toBe(400);
    await expect(readFile(path.join(folder, '.git', 'HEAD'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await post('/enable', true, 'https://elsewhere.invalid')).status).toBe(403);
    expect((await post('/enable')).status).toBe(200);
    await expect(readFile(path.join(folder, '.git', 'HEAD'))).rejects.toMatchObject({ code: 'ENOENT' });
    const checkpoint = (await new ProjectCheckpoints(folder, undefined, store).snapshot({ runId: 'run-1', conversationId: 'conversation-1', summary: 'Change the game' }))!;
    await writeFile(path.join(folder, 'game.txt'), 'after\n');
    await writeFile(path.join(folder, 'created.txt'), 'created\n');
    await new ProjectCheckpoints(folder, undefined, store).finish(checkpoint.id);
    const listed = await (await fetch(`${url}?runId=run-1`)).json() as ListProjectCheckpointsResponse;
    expect(listed.checkpoints).toHaveLength(1);
    expect(listed.checkpoints[0]).toMatchObject({ id: checkpoint.id, runId: 'run-1' });
    const shown = await (await fetch(`${url}/${checkpoint.id}`)).json() as GetProjectCheckpointResponse;
    expect(shown.currentChanges.map((entry: { path: string }) => entry.path)).toEqual(['created.txt', 'game.txt']);
    expect((await post(`/${checkpoint.id}/restore`, false)).status).toBe(400);
    expect(await readFile(path.join(folder, 'game.txt'), 'utf8')).toBe('after\n');
    const response = await post(`/${checkpoint.id}/restore`);
    expect(response.status).toBe(200);
    const restored = await response.json() as RestoreProjectCheckpointResponse;
    expect(await readFile(path.join(folder, 'game.txt'), 'utf8')).toBe('before\n');
    expect(restored.backupCheckpoint.kind).toBe('before_restore');
    expect(restored.restoredFiles).toEqual([{ path: 'created.txt', status: 'deleted' }, { path: 'game.txt', status: 'modified' }]);
    expect((await post(`/${restored.backupCheckpoint.id}/restore`)).status).toBe(200);
    expect(await readFile(path.join(folder, 'created.txt'), 'utf8')).toBe('created\n');
  }, 25_000);

  it('takes a snapshot through internalRunCreation.start and freezes changes at physical termination', async () => {
    await new ProjectCheckpoints(folder).enable();
    const run = { id: 'physical-run-1', projectId: 'project-1', conversationId: 'conversation-1', status: 'queued' };
    let settle!: () => void;
    let announceStarted!: () => void;
    let pending!: Promise<unknown>;
    const terminal = new Promise<void>(resolve => { settle = resolve; });
    const started = new Promise<void>(resolve => { announceStarted = resolve; });
    const registry = {
      createOrReuse: () => ({ kind: 'created' as const, run }), prepareRestart: () => run, get: () => run, drop: () => {},
      start: (_run: typeof run, starter: () => Promise<unknown>) => { pending = starter(); return run; },
      isTerminal: (status: string) => ['succeeded', 'failed', 'canceled'].includes(status), wait: () => terminal,
    };
    const service = createInternalRunCreationService({ runs: registry, claimAssistantMessage: () => ({ ok: true }),
      analyticsLifecycle: { install: () => {} }, checkpointRun: createRunCheckpointHook({ projectDirectory: () => folder, runs: registry }) });
    service.start(run, { body: { message: 'Make jumping easier' }, requestAnalyticsContext: null }, async () => {
      const listed = await new ProjectCheckpoints(folder).list();
      expect(listed.checkpoints[0]).toMatchObject({ runId: run.id, conversationId: run.conversationId, summary: 'Make jumping easier', runChanges: null });
      await writeFile(path.join(folder, 'game.txt'), 'agent change\n');
      announceStarted();
      return 'spawned';
    });
    try {
      await started;
      const listed = await new ProjectCheckpoints(folder).list();
      expect(listed).toMatchObject({ status: 'available', busy: true });
      await expect(new ProjectCheckpoints(folder).restore(listed.checkpoints[0]!.id)).rejects.toMatchObject({ code: 'CHECKPOINT_BUSY' });
    } finally { run.status = 'succeeded'; settle(); }
    expect(await pending).toBe('spawned');
    const listed = await new ProjectCheckpoints(folder).list();
    expect(listed).toMatchObject({ status: 'available', busy: false });
    expect(listed.checkpoints[0]!.runChanges).toEqual([{ path: 'game.txt', status: 'modified' }]);
    await writeFile(path.join(folder, 'later.txt'), 'later edit\n');
    expect((await new ProjectCheckpoints(folder).list()).checkpoints[0]!.runChanges).toEqual([{ path: 'game.txt', status: 'modified' }]);
  }, 15_000);

  it('rejects writes while the registry reports an active run even without a checkpoint', async () => {
    const { post, setActive } = await http();
    setActive(true);
    const response = await post('/enable');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'CHECKPOINT_BUSY' } });
    await expect(readFile(path.join(folder, '.git', 'HEAD'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('logs snapshot errors and still runs the requested agent', async () => {
    const warn = vi.fn();
    const starter = vi.fn(async () => 'agent ran');
    const hook = createRunCheckpointHook({ projectDirectory: () => { throw new Error('folder unavailable'); },
      runs: { wait: async () => {}, isTerminal: () => false }, warn });
    expect(await hook({ id: 'run-1', projectId: 'project-1', status: 'queued' }, { body: {}, requestAnalyticsContext: null }, starter)).toBe('agent ran');
    expect(warn).toHaveBeenCalled();
    expect(starter).toHaveBeenCalledOnce();
  });

  it('reports unavailable when an untracked nested Git repository would make the snapshot incomplete', async () => {
    await new ProjectCheckpoints(folder).enable();
    const nested = path.join(folder, 'nested');
    await mkdir(nested);
    execFileSync('git', ['init', '--quiet'], { cwd: nested, windowsHide: true });
    await writeFile(path.join(nested, 'inner.txt'), 'nested project');
    expect(await new ProjectCheckpoints(folder).list()).toMatchObject({ status: 'unavailable', reason: 'unsupported_repository' });
  });

  it('keeps checkpoints separate across linked Git worktrees', async () => {
    const checkpoints = new ProjectCheckpoints(folder);
    await checkpoints.enable();
    const linked = path.join(temporaryRoot, 'linked');
    execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'linked-game', linked], { cwd: folder, windowsHide: true });
    const first = (await checkpoints.snapshot({ runId: 'run-main', summary: 'Main game' }))!;
    const second = (await new ProjectCheckpoints(linked).snapshot({ runId: 'run-linked', summary: 'Linked game' }))!;
    expect((await checkpoints.list()).checkpoints.map(item => item.id)).toEqual([first.id]);
    expect((await new ProjectCheckpoints(linked).list()).checkpoints.map(item => item.id)).toEqual([second.id]);
    await expect(new ProjectCheckpoints(linked).restore(first.id)).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });
  }, 15_000);
});

it('scopes agent checkpoint reads to their project and refuses writes from read-only grants', async () => {
  const { url } = await http();
  const headers = (projectId: string, allowedOperations: string[]) => ({ authorization: `Bearer ${toolTokenRegistry.mint({ runId: 'agent-run', projectId, allowedOperations }).token}` });
  expect((await fetch(url, { headers: headers('other', ['checkpoint:read']) })).status).toBe(403);
  expect((await fetch(url, { headers: headers('project-1', ['checkpoint:read']) })).status).toBe(200);
  const readOnly = headers('project-1', ['checkpoint:read']);
  expect((await fetch(url + '/enable', { method: 'POST', headers: { ...readOnly, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) })).status).toBe(403);
  const writable = headers('project-1', ['checkpoint:write']);
  expect((await fetch(url + '/enable', { method: 'POST', headers: { ...writable, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) })).status).toBe(200);
});
