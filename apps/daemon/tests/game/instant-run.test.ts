import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Response } from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GameInstallDepsResult, GameRunStatus } from '@openpixo/contracts';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { requireLocalDaemonRequest } from '../../src/http/local-daemon-request.js';
import { _resetForTests as resetWatchers } from '../../src/project-watchers.js';
import { registerGameRunRoutes, type RegisterGameRunRoutesDeps } from '../../src/routes/game-run.js';

/*
 * 2026-11-24, a packaged build on a beginner's profile: the sample game a new user opens first
 * took 29 to 60 s to appear in four cold starts. Installing its packages was 17 to 48 s of that,
 * and the dev server and the game's frame took ten more. These tests play the sample through
 * the same routes while a package manager they control is still at work.
 */
const templatesRoot = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
let root: string, game: string, data: string, base: string;
let stop: () => Promise<void>;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pixo-instant-run-'));
  game = path.join(root, 'game'); data = path.join(root, 'data');
  const bin = path.join(root, 'bin');
  await Promise.all([mkdir(data), mkdir(bin), cp(path.join(templatesRoot, 'phaser3-sample-platformer', 'files'), game, { recursive: true })]);
  const script = path.join(bin, 'fake.cts');
  await writeFile(script, `
    const fs = require('node:fs'); const http = require('node:http'); const path = require('node:path');
    const args = process.argv.slice(2); const data = process.env.PIXO_DATA_DIR; const file = name => path.join(data, name);
    if (args[0] === 'install') {
      fs.appendFileSync(file('installs.log'), 'install\\n');
      // A package's folder is there long before its files are.
      for (const name of ['phaser', 'vite', 'typescript']) fs.mkdirSync(path.join('node_modules', name), { recursive: true });
      const timer = setInterval(() => {
        if (!fs.existsSync(file('install-result'))) return;
        clearInterval(timer);
        const result = fs.readFileSync(file('install-result'), 'utf8');
        if (result !== 'ok') { console.error('registry connection failed'); fs.rmSync('node_modules', { recursive: true, force: true, maxRetries: 10 }); process.exit(1); }
        process.exit(0);
      }, 20);
    } else {
      fs.appendFileSync(file('servers.log'), 'server\\n');
      if (fs.existsSync(file('server-fails'))) { console.error('no such script'); process.exit(1); }
      const port = Number(args[args.indexOf('--port') + 1]);
      fs.writeFileSync(file('server.pid'), String(process.pid));
      http.createServer((req, res) => res.end(req.url === '/src/tuning.json?raw' ? fs.readFileSync('src/tuning.json') : 'from source'))
        .listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/'));
    }
  `);
  const tool = path.join(bin, `npm${process.platform === 'win32' ? '.cmd' : ''}`);
  await writeFile(tool, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  // Only this npm and this Node: a beginner's computer has neither pnpm nor Git.
  vi.stubEnv('PATH', [bin, path.dirname(process.execPath), ...(process.platform === 'win32' ? ['C:\\Windows\\System32', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0'] : ['/usr/bin', '/bin'])].join(path.delimiter));
  vi.stubEnv('PIXO_AGENT_HOME', path.join(root, 'no-tools'));
  const manifest = path.join(game, 'package.json');
  await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('pnpm@10.33.2', 'npm@11.0.0'));

  const db = openDatabase(root, { dataDir: data });
  for (const [id, metadata] of [['game', { baseDir: game, templateId: 'phaser3-sample-platformer' }], ['other', { baseDir: game }]] as const) {
    insertProject(db, { id, name: id, metadata, createdAt: 1, updatedAt: 1 });
  }
  const app = express(); app.use(express.json());
  const dispose = registerGameRunRoutes(app, {
    db, paths: { PROJECTS_DIR: path.join(root, 'projects'), RUNTIME_DATA_DIR: data }, templatesRoot,
    http: { requireLocalDaemonRequest, isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 },
      sendApiError: (res: Response, code: number, error: string, message: string) => res.status(code).json({ error, message }) },
    authorizeProjectRequest: async () => true,
  } as unknown as RegisterGameRunRoutesDeps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/projects`;
  stop = async () => { await dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeDatabase(); };
});
afterEach(async () => {
  await stop();
  await resetWatchers();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const run = async (method = 'GET', id = 'game') => (await (await fetch(`${base}/${id}/game/run`, { method })).json()) as GameRunStatus;
const install = async (method = 'GET', id = 'game') => (await (await fetch(`${base}/${id}/game/install-deps`, { method })).json()) as GameInstallDepsResult;
/** The package manager is at work. */
const installing = () => vi.waitFor(async () => expect(await lines('installs.log'), JSON.stringify([await run(), await install()])).toBe(1), { timeout: 15_000 });
const finishInstall = (result: 'ok' | 'failed' = 'ok') => writeFile(path.join(data, 'install-result'), result);
const lines = async (name: string) => (await readFile(path.join(data, name), 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
const setJump = async (value: number) => {
  const tuning = path.join(game, 'src', 'tuning.json');
  await writeFile(tuning, (await readFile(tuning, 'utf8')).replace(/("jumpPower": \{"value": )\d+/u, `$1${value}`));
};
const onSource = (url: string) => vi.waitFor(async () => {
  const page = await fetch(url, { redirect: 'manual' });
  expect(page.status).toBe(302);
  return page.headers.get('location')!;
}, { timeout: 15_000 });

it('plays the sample before its packages are there, then from its dev server, at one address', async () => {
  const started = await run('POST');
  expect(started).toMatchObject({ status: 'running', engine: 'phaser' });
  expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
  await installing();
  expect(await install()).toMatchObject({ status: 'installing' });

  const page = await (await fetch(started.url!)).text();
  expect(page).toContain('"phaser":"/@openpixo/packages/phaser.js"');
  expect(await (await fetch(`${started.url}src/main.ts`)).text()).toContain('new Phaser.Game(');
  // Step 2 of the walkthrough: a setting the user drags reaches the game that is playing.
  const events = new AbortController();
  const stream = (await fetch(`${started.url}@openpixo/events`, { signal: events.signal })).body!.pipeThrough(new TextDecoderStream()).getReader();
  expect(await (await fetch(`${started.url}src/tuning.json?raw`)).text()).toContain('460');
  await new Promise(resolve => setTimeout(resolve, 500)); // the file watcher's first scan
  await setJump(700);
  let heard = '';
  await vi.waitFor(async () => { heard += (await stream.read()).value ?? ''; expect(heard).toContain('event: changed'); }, { timeout: 15_000 });
  events.abort();
  expect(await (await fetch(`${started.url}src/tuning.json?raw`)).text()).toContain('700');
  // Step 3: so does a change to the code.
  const main = path.join(game, 'src', 'main.ts');
  await writeFile(main, `${await readFile(main, 'utf8')}\nconst doubleJump: boolean = true;\nconsole.log(doubleJump);\n`);
  expect(await (await fetch(`${started.url}src/main.ts`)).text()).toMatch(/const doubleJump\s*= true/u);

  await finishInstall();
  const dev = await onSource(started.url!);
  expect(await (await fetch(dev)).text()).toBe('from source');
  expect(await (await fetch(`${dev}src/tuning.json?raw`)).text()).toContain('700');
  await setJump(300);
  expect(await (await fetch(`${dev}src/tuning.json?raw`)).text()).toContain('300');
  expect(await run()).toMatchObject({ status: 'running', url: started.url });
  expect([await lines('installs.log'), await lines('servers.log')]).toEqual([1, 1]);

  const pid = Number(await readFile(path.join(data, 'server.pid'), 'utf8'));
  expect(await run('DELETE')).toMatchObject({ status: 'exited' });
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(fetch(started.url!)).rejects.toThrow();
  // Everything is installed now, so the next start needs nothing to play in the meantime.
  expect((await run('POST')).status).toBe('starting');
  await vi.waitFor(async () => expect((await run()).status).toBe('running'), { timeout: 15_000 });
  expect(await (await fetch((await run()).url!)).text()).toBe('from source');
});

it('lets the user stop and start again while the packages are still coming', async () => {
  const first = await run('POST');
  await installing();
  expect(await run('DELETE')).toMatchObject({ status: 'exited' });
  await expect(fetch(first.url!)).rejects.toThrow();
  expect(await install()).toMatchObject({ status: 'installing' });

  const second = await run('POST');
  expect(second.status).toBe('running');
  expect((await fetch(second.url!)).status).toBe(200);
  await finishInstall();
  await onSource(second.url!);
  expect([await lines('installs.log'), await lines('servers.log')]).toEqual([1, 1]);
});

it('keeps playing when the packages cannot be installed, says so in the log, and tries again next time', async () => {
  const started = await run('POST');
  await finishInstall('failed');
  await vi.waitFor(async () => expect((await run()).logTail).toContain('registry connection failed'), { timeout: 15_000 });
  expect(await run()).toMatchObject({ status: 'running', url: started.url });
  expect((await run()).reasonCode).toBeUndefined();
  expect((await fetch(started.url!)).status).toBe(200);
  await run('DELETE');
  await finishInstall('ok');
  await onSource((await run('POST')).url!);
  expect(await lines('installs.log')).toBe(2);
});

it('keeps playing when the dev server does not start', async () => {
  await writeFile(path.join(data, 'server-fails'), '');
  const started = await run('POST');
  await finishInstall();
  await vi.waitFor(async () => expect((await run()).logTail).toContain('no such script'), { timeout: 15_000 });
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(await run()).toMatchObject({ status: 'running', url: started.url });
  expect((await fetch(started.url!, { redirect: 'manual' })).status).toBe(200);
});

it('ends the run when the dev server it moved to ends', async () => {
  const started = await run('POST');
  await finishInstall();
  await onSource(started.url!);
  process.kill(Number(await readFile(path.join(data, 'server.pid'), 'utf8')), 'SIGKILL');
  await vi.waitFor(async () => expect(await run()).toMatchObject({ status: 'failed', reasonCode: 'PROCESS_EXITED' }), { timeout: 15_000 });
  await expect(fetch(started.url!)).rejects.toThrow();
});

it('stops a background install, the game and its server with the daemon', async () => {
  const started = await run('POST');
  await installing();
  await stop();
  await expect(fetch(started.url!)).rejects.toThrow();
  expect(JSON.parse(await readFile(path.join(game, 'node_modules', '.openpixo-install.json'), 'utf8'))).toMatchObject({ pid: 0, fresh: true });
  expect(await lines('servers.log')).toBe(0);
  stop = async () => {};
});

it('makes every other game wait for its packages as before', async () => {
  expect(await run('POST', 'other')).toMatchObject({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING' });
  // The sample too, once it needs something that does not ship with it.
  const manifest = path.join(game, 'package.json');
  await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('"phaser": "3.90.0"', '"phaser": "3.90.0", "howler": "2.2.4"'));
  expect(await run('POST')).toMatchObject({ status: 'failed', reasonCode: 'DEPENDENCIES_MISSING' });
  expect(await install('POST', 'other')).toMatchObject({ status: 'installing' });
  expect(await run('POST', 'other')).toMatchObject({ status: 'failed', reasonCode: 'INSTALL_BUSY' });
  await finishInstall();
});
