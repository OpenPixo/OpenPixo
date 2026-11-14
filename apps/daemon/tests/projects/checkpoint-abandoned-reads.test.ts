import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Changes view re-asks for a running checkpoint after every file event and
 * drops its previous request. On a large game one read takes seconds (`git add`
 * hashes the folder), so during a busy turn abandoned reads queued faster than
 * they ran. Each still ran Git later, for hours, until the daemon ran out of heap.
 */
const gate = vi.hoisted(() => ({ hold: null as Promise<void> | null, held: 0, adds: 0 }));
vi.mock('../../src/projects/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/projects/git.js')>();
  return {
    ...actual,
    runProjectGit: async (...args: Parameters<typeof actual.runProjectGit>) => {
      if (args[1][0] === 'add') {
        gate.adds++;
        if (gate.hold && gate.held++ === 0) await gate.hold;
      }
      return actual.runProjectGit(...args);
    },
  };
});
vi.mock('../../src/db.js', () => ({ getProject: vi.fn() }));

const { getProject } = await import('../../src/db.js');
const { ProjectCheckpoints } = await import('../../src/projects/checkpoints.js');
const { checkpointStore } = await import('../../src/projects/checkpoint-store.js');
const { registerProjectCheckpointRoutes } = await import('../../src/routes/project-checkpoints.js');

let root: string;
let folder: string;
let server: Server | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'openpixo-abandoned-reads-'));
  folder = path.join(root, 'game');
  await mkdir(folder);
  await writeFile(path.join(root, 'gitconfig'), '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(root, 'gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('XDG_CONFIG_HOME', root);
  await writeFile(path.join(folder, 'game.txt'), 'before\n');
  vi.mocked(getProject).mockReturnValue({ id: 'project-1', metadata: { baseDir: folder } } as ReturnType<typeof getProject>);
  Object.assign(gate, { hold: null, held: 0, adds: 0 });
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function listen(): Promise<{ url: string; closed: () => number }> {
  const app = express();
  let closed = 0;
  app.use((_req, res, next) => { res.on('close', () => { closed++; }); next(); });
  registerProjectCheckpointRoutes(app, {
    db: {} as Parameters<typeof getProject>[0], paths: { PROJECTS_DIR: root, RUNTIME_DATA_DIR: root },
    authorizeProjectRequest: vi.fn(async () => true), authorizeProjectToolRequest: vi.fn(async () => ({ projectId: 'project-1' })),
    isProjectBusy: () => true,
    http: {
      requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
      isLocalSameOrigin: () => true,
      resolvedPortRef: { current: 0 },
      sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
    },
  });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/projects/project-1/checkpoints`, closed: () => closed };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; !condition(); i++) {
    if (i > 500) throw new Error('condition not reached');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('abandoned checkpoint reads', () => {
  it('never runs Git for a read whose caller already left', async () => {
    const checkpoint = await new ProjectCheckpoints(folder, undefined, checkpointStore(root, 'project-1')).snapshot({ runId: 'run-1', summary: 'Build stage 1' });
    const { url, closed } = await listen();
    await writeFile(path.join(folder, 'game.txt'), 'during the run\n');
    let release!: () => void;
    gate.hold = new Promise<void>(resolve => { release = resolve; });
    gate.adds = 0;

    // One read holds the project's Git lock, as a slow `git add` on a big game does.
    const first = fetch(`${url}/${checkpoint!.id}`);
    await until(() => gate.adds === 1);

    // Meanwhile the Changes view asks again after each file event and drops the previous request.
    const abandoned = Array.from({ length: 20 }, () => {
      const controller = new AbortController();
      const request = fetch(`${url}/${checkpoint!.id}`, { signal: controller.signal }).catch(() => null);
      return { controller, request };
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const { controller } of abandoned) controller.abort();
    await Promise.all(abandoned.map(({ request }) => request));
    await until(() => closed() >= 20);

    release();
    expect((await first).status).toBe(200);
    const fresh = await fetch(`${url}/${checkpoint!.id}`);
    expect(fresh.status).toBe(200);
    expect(((await fresh.json()) as { currentChanges: unknown }).currentChanges).toEqual([{ path: 'game.txt', status: 'modified' }]);
    // The held read and the fresh one; none of the twenty that nobody waits for.
    expect(gate.adds).toBe(2);
  }, 120_000);
});
