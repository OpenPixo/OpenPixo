import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express, { type Response } from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EngineProfile, GameRunStatus } from '@openpixo/contracts';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { GAME_RUN_LOG_LIMIT, GameRunManager, gameRunUrlFromOutput, type GameRunContext } from '../../src/game/run.js';
import { gameToolResolver } from '../../src/game/verify.js';
import { requireLocalDaemonRequest } from '../../src/http/local-daemon-request.js';
import { registerGameRunRoutes, type RegisterGameRunRoutesDeps } from '../../src/routes/game-run.js';

let root: string, projectDir: string, dataDir: string, fakeTool: string;
const managers: GameRunManager[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'op-run-'));
  projectDir = path.join(root, 'project'); dataDir = path.join(root, 'data');
  const bin = path.join(root, 'bin');
  await Promise.all([mkdir(projectDir), mkdir(dataDir), mkdir(bin)]);
  const script = path.join(bin, 'fake.cts');
  await writeFile(script, `
    const fs = require('node:fs'); const cp = require('node:child_process'); const http = require('node:http'); const path = require('node:path');
    const args = process.argv.slice(2); const data = process.env.PIXO_DATA_DIR;
    if (args[0] === 'install') { fs.mkdirSync(path.join(process.cwd(), 'node_modules'), { recursive: true }); console.log('dependencies ready'); process.exit(0); }
    fs.appendFileSync(path.join(data, 'starts.log'), 'started\\n');
    fs.writeFileSync(path.join(data, 'launch-args.json'), JSON.stringify(args));
    if (process.env.PIXO_GAME_RUN_TEST_MODE === 'exit') { console.error('game ended'); process.exit(0); }
    if (process.env.PIXO_GAME_RUN_TEST_MODE === 'fail') { console.error('game crashed'); process.exit(7); }
    const descendant = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    fs.writeFileSync(path.join(data, 'process.json'), JSON.stringify({ descendantPid: descendant.pid, args, data }));
    const at = args.indexOf('--port');
    if (at >= 0) {
      const port = Number(args[at + 1]);
      const server = http.createServer((_req, res) => res.end('game'));
      server.listen(port, '127.0.0.1', () => {
        process.stdout.write('x'.repeat(${GAME_RUN_LOG_LIMIT + 128}));
        if (process.env.PIXO_GAME_RUN_TEST_MODE !== 'silent') console.log('\\nLocal: http://127.0.0.1:' + port + '/');
      });
    } else { console.log('Godot is running'); setInterval(() => {}, 1000); }
  `);
  fakeTool = path.join(bin, `npm${process.platform === 'win32' ? '.cmd' : ''}`);
  await writeFile(fakeTool, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH ?? ''}`);
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(managers.splice(0).map(manager => manager.dispose()));
  vi.unstubAllEnvs(); vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function profile(engine: EngineProfile['engine'] = 'phaser', tool = 'npm'): EngineProfile {
  return { detectorVersion: 1, engine, confidence: 'certain', evidence: [], languages: [], assetRoots: [], importMetadata: 'none', tools: [], detectedAt: 0,
    commands: engine === 'unknown' ? {} : { run: { argv: engine === 'godot' ? [tool, '--path', '.'] : [tool, 'run', 'dev'], cwd: '.', timeoutMs: 30_000 } } };
}

function manager(): GameRunManager {
  const value = new GameRunManager(dataDir); managers.push(value); return value;
}

function context(engine: EngineProfile['engine'] = 'phaser', tool = 'npm'): GameRunContext {
  return { profile: profile(engine, tool), projectDir, resolveTool: gameToolResolver({ [tool]: fakeTool }) };
}

it('accepts only complete loopback HTTP URLs at the selected port', () => {
  expect(gameRunUrlFromOutput('Local: http://localhost:51')).toBeNull();
  expect(gameRunUrlFromOutput('\x1b[32mLocal:\x1b[0m http://localhost:5199/\n', 5199)).toBe('http://localhost:5199/');
  expect(gameRunUrlFromOutput('http://[::1]:5199/\n', 5199)).toBe('http://[::1]:5199/');
  for (const url of ['https://localhost:5199/', 'http://example.com:5199/', 'http://127.0.0.1.evil:5199/', 'http://user@localhost:5199/', 'http://localhost:5200/']) {
    expect(gameRunUrlFromOutput(`${url}\n`, 5199)).toBeNull();
  }
});

it('returns explicit unsupported, dependency, and missing-tool fixes without launching commands', async () => {
  const runs = manager();
  expect(await runs.start('unknown', async () => context('unknown'))).toMatchObject({ status: 'failed', reasonCode: 'UNSUPPORTED_ENGINE' });
  await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.2' }));
  expect(await runs.start('missing-deps', async () => context('phaser', 'pnpm'))).toMatchObject({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING', installCommand: 'pnpm install' });
  expect(await runs.start('missing-node', async () => ({ ...context('phaser'), resolveTool: () => null }))).toMatchObject({ status: 'failed', reasonCode: 'NODE_MISSING' });
  expect(await runs.start('missing-tool', async () => ({ ...context('godot', 'godot'), resolveTool: () => null }))).toMatchObject({
    status: 'failed', reasonCode: 'MISSING_TOOL', missingToolGuidance: [{ tool: 'godot', name: 'Godot', installUrl: 'https://godotengine.org/download' }],
  });
  expect(await readdir(dataDir)).toEqual([]);
});

it('reserves one instance during preflight and cancels a late launch when stopped', async () => {
  const runs = manager();
  let release!: (value: GameRunContext) => void;
  const prepared = new Promise<GameRunContext>(resolve => { release = resolve; });
  const first = runs.start('game', () => prepared);
  const duplicate = vi.fn(async () => context());
  expect(await runs.start('game', duplicate)).toEqual({ status: 'starting' });
  const stopped = runs.stop('game');
  release(context());
  await Promise.all([first, stopped]);
  expect(duplicate).not.toHaveBeenCalled();
  expect(runs.status('game')).toMatchObject({ status: 'exited' });
  expect(await readdir(dataDir)).toEqual([]);
  await runs.dispose();
  expect(await runs.start('after-shutdown', duplicate)).toMatchObject({ status: 'failed', reasonCode: 'START_FAILED' });
  expect(duplicate).not.toHaveBeenCalled();
});

it.each([['exit', 'exited', 0], ['fail', 'failed', 7]] as const)('reports Godot %s without editor/headless flags or a URL', async (mode, status, exitCode) => {
  vi.stubEnv('PIXO_GAME_RUN_TEST_MODE', mode);
  const runs = manager();
  await runs.start('game', async () => context('godot', 'godot'));
  await vi.waitFor(() => expect(runs.status('game')).toMatchObject({ status, exitCode, logTail: expect.stringContaining(mode === 'exit' ? 'game ended' : 'game crashed') }), { timeout: 5000 });
  expect(runs.status('game')).not.toHaveProperty('url');
  expect(JSON.parse(await readFile(path.join(dataDir, 'launch-args.json'), 'utf8'))).toEqual(['--path', expect.any(String)]);
  if (mode === 'fail') expect(runs.status('game').reasonCode).toBe('PROCESS_EXITED');
});

it('uses the Godot 3 profile tool with fixed main-scene arguments', async () => {
  vi.stubEnv('PIXO_GAME_RUN_TEST_MODE', 'exit');
  const runs = manager();
  const prepared = context('godot', 'godot');
  prepared.profile.commands = { check: { argv: ['godot', '--no-window', '--path', '.', '--editor', '--quit'], cwd: '.', timeoutMs: 30_000 } };
  await runs.start('godot3', async () => prepared);
  await vi.waitFor(() => expect(runs.status('godot3').status).toBe('exited'), { timeout: 5000 });
  expect(JSON.parse(await readFile(path.join(dataDir, 'launch-args.json'), 'utf8'))).toEqual(['--path', expect.any(String)]);
});

it('fails a silent web startup exactly at its profile deadline', async () => {
  vi.stubEnv('PIXO_GAME_RUN_TEST_MODE', 'silent');
  await mkdir(path.join(projectDir, 'node_modules'));
  const runs = manager();
  const watcher = watch(dataDir);
  const ready = new Promise<void>(resolve => watcher.on('change', (_event, file) => { if (file === 'process.json') resolve(); }));
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await runs.start('silent', async () => context());
    // Wait for the real descendant before advancing the virtual startup deadline.
    await ready;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(runs.status('silent').status).toBe('starting');
    await vi.advanceTimersByTimeAsync(1);
    expect(runs.status('silent')).toMatchObject({ status: 'failed', reasonCode: 'START_TIMEOUT' });
    vi.useRealTimers();
    await runs.stop('silent');
  } finally { watcher.close(); vi.useRealTimers(); }
});

it('runs the HTTP lifecycle once per project, bounds logs, and stops the entire tree on stop and daemon disposal', async () => {
  // Real pipes, server readiness, and process-tree termination are the behavior under test.
  await mkdir(path.join(projectDir, 'node_modules'));
  await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ dependencies: { phaser: '3.90.0' }, devDependencies: { vite: '7' }, scripts: { dev: 'vite' } }));
  const db = openDatabase(root, { dataDir });
  insertProject(db, { id: 'game', name: 'Game', metadata: { baseDir: projectDir }, createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json());
  const authorize = vi.fn(async () => true);
  const dispose = registerGameRunRoutes(app, {
    db, paths: { PROJECTS_DIR: root, RUNTIME_DATA_DIR: dataDir },
    http: { requireLocalDaemonRequest, isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 },
      sendApiError: (res: Response, code: number, error: string, message: string) => res.status(code).json({ error, message }) },
    authorizeProjectRequest: authorize,
  } as unknown as RegisterGameRunRoutesDeps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/projects/game/game/run`;
  let descendantPid: number | undefined;
  try {
    expect(await (await fetch(base)).json()).toEqual({ status: 'idle' });
    const forbidden = await fetch(base, { method: 'POST', headers: { authorization: 'Bearer pixott_expired' } });
    expect(forbidden.status).toBe(403);
    const installBase = base.replace(/run$/, 'install-deps');
    expect((await fetch(installBase, { method: 'POST', headers: { authorization: 'Bearer pixott_expired' } })).status).toBe(403);
    expect((await fetch(installBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ argv: ['anything'] }) })).status).toBe(400);
    expect(await (await fetch(installBase, { method: 'POST' })).json()).toMatchObject({ status: 'installing' });
    await vi.waitFor(async () => expect(await (await fetch(installBase)).json()).toMatchObject({
      status: 'installed', packageManager: 'npm', logTail: expect.stringContaining('dependencies ready'),
    }), { timeout: 5000 });
    const injected = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ argv: ['dangerous-command'] }) });
    expect(injected.status).toBe(400);
    const starts = await Promise.all([fetch(base, { method: 'POST' }), fetch(base, { method: 'POST' })]);
    expect(starts.every(response => response.ok)).toBe(true);
    let running!: GameRunStatus;
    await vi.waitFor(async () => { running = await (await fetch(base)).json() as GameRunStatus; expect(running.status, running.logTail?.slice(-1200) ?? running.message).toBe('running'); }, { timeout: 5000 });
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(running).not.toHaveProperty('pid');
    expect(await (await fetch(installBase, { method: 'POST' })).json()).toMatchObject({ status: 'failed', reasonCode: 'INSTALL_BUSY' });
    expect(Buffer.byteLength(running.logTail ?? '')).toBeLessThanOrEqual(GAME_RUN_LOG_LIMIT);
    expect(await (await fetch(running.url!)).text()).toBe('game');
    expect(await readFile(path.join(dataDir, 'starts.log'), 'utf8')).toBe('started\n');
    const processInfo = JSON.parse(await readFile(path.join(dataDir, 'process.json'), 'utf8'));
    descendantPid = processInfo.descendantPid;
    expect(processInfo.args).toEqual(expect.arrayContaining(['--host', '127.0.0.1', '--strictPort']));
    expect(processInfo.data).toBe(dataDir);
    expect(await (await fetch(`${base}/logs/${running.logRef}`)).text()).toBe(running.logTail);
    expect((await fetch(`${base}/logs/not-a-ref`)).status).toBe(404);
    expect(await (await fetch(base, { method: 'DELETE' })).json()).toMatchObject({ status: 'exited' });
    expect(() => process.kill(descendantPid!, 0)).toThrow();
    descendantPid = undefined;
    expect((await readdir(path.join(dataDir, 'logs', 'game-runs'))).some(file => file === `${running.logRef}.log`)).toBe(true);
    expect((await readdir(projectDir)).sort()).toEqual(['node_modules', 'package.json']);
    await fetch(base, { method: 'POST' });
    await vi.waitFor(async () => expect(await (await fetch(base)).json()).toMatchObject({ status: 'running' }), { timeout: 5000 });
    descendantPid = JSON.parse(await readFile(path.join(dataDir, 'process.json'), 'utf8')).descendantPid;
    await dispose();
    expect(() => process.kill(descendantPid!, 0)).toThrow();
    descendantPid = undefined;
    expect(await (await fetch(base, { method: 'POST' })).json()).toMatchObject({ status: 'failed', reasonCode: 'START_FAILED' });
  } finally {
    await dispose();
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch {} }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeDatabase();
  }
});
