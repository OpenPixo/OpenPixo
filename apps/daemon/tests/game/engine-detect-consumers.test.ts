import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getProject } from '../../src/db.js';
import { detectEngineProfile } from '../../src/game/engine-detect.js';
import { runGameCli } from '../../src/game/install-deps-cli.js';
import { GameRunManager } from '../../src/game/run.js';
import { verifyGame } from '../../src/game/verify.js';
import { registerGameRunRoutes, type RegisterGameRunRoutesDeps } from '../../src/routes/game-run.js';

vi.mock('../../src/db.js', () => ({ getProject: vi.fn(), updateProject: vi.fn() }));

let root: string, projectDir: string, dataDir: string, fakeTool: string;
let server: Server | undefined;
let disposeRoutes: (() => Promise<void>) | undefined;
const managers: GameRunManager[] = [];
const previousExitCode = process.exitCode;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pixo-engine-consumers-'));
  projectDir = path.join(root, 'project'); dataDir = path.join(root, 'data');
  const bin = path.join(root, 'bin');
  await Promise.all([mkdir(projectDir), mkdir(dataDir), mkdir(bin)]);
  const script = path.join(bin, 'fake.cts');
  await writeFile(script, `
    const fs = require('node:fs'); const path = require('node:path');
    const args = process.argv.slice(2);
    if (args[0] === 'install') {
      if (!fs.existsSync('package.json')) { console.error('missing nested manifest'); process.exit(2); }
      fs.mkdirSync('node_modules', { recursive: true });
    } else {
      const at = args.includes('--path') ? args.indexOf('--path') : args.indexOf('-projectPath');
      const marker = args.includes('--path') ? 'project.godot' : 'ProjectSettings/ProjectVersion.txt';
      if (at < 0 || !fs.existsSync(path.resolve(args[at + 1], marker))) {
        console.error('missing nested engine marker'); process.exit(2);
      }
    }
    console.log(JSON.stringify({ cwd: process.cwd(), args }));
  `);
  for (const id of ['npm', 'pnpm']) {
    fakeTool = path.join(bin, `${id}${process.platform === 'win32' ? '.cmd' : ''}`);
    await writeFile(fakeTool, process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  }
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH ?? ''}`);
  vi.mocked(getProject).mockReturnValue({ id: 'game', metadata: { baseDir: projectDir } } as ReturnType<typeof getProject>);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
  await disposeRoutes?.(); disposeRoutes = undefined;
  await Promise.all(managers.splice(0).map(manager => manager.dispose()));
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  process.exitCode = previousExitCode;
  await rm(root, { recursive: true, force: true });
});

async function file(relative: string, content: string): Promise<void> {
  const target = path.join(projectDir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function webProject(): Promise<void> {
  await file('web/package.json', JSON.stringify({ packageManager: 'pnpm@10.33.2',
    dependencies: { phaser: '3.90.0' }, scripts: { build: 'vite build' } }));
}

it('verifies nested Unity checks and discovered builds from the engine directory', async () => {
  await file('unity/ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 2022.3.20f1\n');
  await file('unity/Assets/Editor/Build.cs', 'public static class BuildScript { public static void Build() { BuildPipeline.BuildPlayer(options); } }');
  const profile = detectEngineProfile(projectDir, { resolveOnPath: () => null });
  const artifactDir = path.join(dataDir, 'artifacts');
  const result = await verifyGame({ profile, projectDir, artifactDir, resolveTool: () => fakeTool });
  expect(result).toMatchObject({ status: 'passed', steps: [{ name: 'check', exitCode: 0 }, { name: 'build', exitCode: 0 }] });
  for (const step of result.steps) {
    const log = JSON.parse(await readFile(path.join(artifactDir, `${step.logRef}.log`), 'utf8'));
    expect(log.cwd).toBe(await realpath(path.join(projectDir, 'unity')));
  }
});

it.each([5, 4])('runs nested Godot config version %s with its resolved cwd as --path', async version => {
  await file('godot/project.godot', `config_version=${version}\n`);
  const profile = detectEngineProfile(projectDir, { resolveOnPath: () => null });
  const manager = new GameRunManager(dataDir); managers.push(manager);
  await manager.start('game', async () => ({ profile, projectDir, resolveTool: () => fakeTool }));
  await vi.waitFor(() => expect(['exited', 'failed']).toContain(manager.status('game').status), { timeout: 5000 });
  const state = manager.status('game');
  expect(state).toMatchObject({ status: 'exited', exitCode: 0 });
  const log = JSON.parse(state.logTail!);
  const cwd = await realpath(path.join(projectDir, 'godot'));
  expect(log).toEqual({ cwd, args: ['--path', cwd] });
});

it('installs nested build-only web dependencies from the agent CLI context', async () => {
  await webProject();
  const profile = detectEngineProfile(projectDir, { resolveOnPath: () => null });
  vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_nested');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ profile, projectDir, runtimeDataDir: dataDir, toolPaths: {} })));
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  process.exitCode = undefined;
  await runGameCli(['install-deps', 'game', '--json', '--daemon-url', 'http://127.0.0.1:4555']);
  const result = JSON.parse(String(output.mock.calls[0]?.[0]));
  expect(result).toMatchObject({ status: 'installed', packageManager: 'pnpm' });
  expect(JSON.parse(result.logTail).cwd).toBe(await realpath(path.join(projectDir, 'web')));
  expect((await stat(path.join(projectDir, 'web/node_modules'))).isDirectory()).toBe(true);
  await expect(stat(path.join(projectDir, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('prepares and installs nested build-only web dependencies through the HTTP surface', async () => {
  await webProject();
  const app = express(); app.use(express.json());
  disposeRoutes = registerGameRunRoutes(app, {
    db: {} as RegisterGameRunRoutesDeps['db'],
    paths: { PROJECTS_DIR: root, RUNTIME_DATA_DIR: dataDir } as RegisterGameRunRoutesDeps['paths'],
    authorizeProjectRequest: vi.fn(async () => true),
    http: {
      createSseResponse: vi.fn(), sendMulterError: vi.fn(),
      requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
      isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 },
      sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
    },
  });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/projects/game/game/install-deps`;
  expect(await (await fetch(endpoint)).json()).toMatchObject({ packageManager: 'pnpm', installCommand: 'pnpm install' });
  expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(200);
  await vi.waitFor(async () => expect(await (await fetch(endpoint)).json()).toMatchObject({ status: 'installed', packageManager: 'pnpm' }), { timeout: 5000 });
  expect((await stat(path.join(projectDir, 'web/node_modules'))).isDirectory()).toBe(true);
  await expect(stat(path.join(projectDir, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
});
