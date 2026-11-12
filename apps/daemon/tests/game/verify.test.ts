import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { watch } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express, { type Response } from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EngineProfile } from '@openpixo/contracts';
import { gameToolResolver, verifyGame, VERIFY_LOG_LIMIT } from '../../src/game/verify.js';
import { gameVerifyArtifact, registerGameVerifyResult } from '../../src/game/verify-store.js';
import { registerGameVerifyRoutes, type RegisterGameVerifyRoutesDeps } from '../../src/routes/game-verify.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';
import { runGameCli } from '../../src/game/verify-cli.js';
import { requireLocalDaemonRequest } from '../../src/http/local-daemon-request.js';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';

let root: string, projectDir: string, artifactDir: string;
// A PNG a real decoder accepts: frames are re-encoded, not stored byte for byte.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWMwTpsJAAICATMDms/iAAAAAElFTkSuQmCC';
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'op-verify-'));
  projectDir = path.join(root, 'game'); artifactDir = path.join(root, 'data', 'artifacts');
  const bin = path.join(root, 'bin');
  await Promise.all([mkdir(projectDir), mkdir(artifactDir, { recursive: true }), mkdir(bin)]);
  const script = path.join(bin, 'fake.cts');
  await writeFile(script, `
    const fs = require('node:fs'); const cp = require('node:child_process'); const path = require('node:path');
    const mode = process.argv[2];
    if (mode === 'fail') { console.error('broken'); process.exitCode = 1; }
    else if (mode === 'timeout') {
      const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      fs.writeFileSync(process.env.PIXO_VERIFY_TEST_PID, String(child.pid)); setInterval(() => {}, 1000);
    } else if (mode === 'server') { console.log('  Local: http://localhost:5199/'); setInterval(() => {}, 1000); }
    else if (mode === 'godot') {
      const movie = process.argv.indexOf('--write-movie');
      if (movie < 0) process.exit(3);
      const file = process.argv[movie + 1];
      fs.writeFileSync(file.replace('.png', '00000001.png'), Buffer.from('${png}', 'base64'));
      fs.writeFileSync(file.replace('.png', '00000030.png'), Buffer.from('${png}', 'base64'));
    } else { process.stdout.write('x'.repeat(${VERIFY_LOG_LIMIT + 1024})); }
  `);
  for (const mode of ['ok', 'fail', 'timeout', 'server', 'godot']) {
    const file = path.join(bin, `${mode}${process.platform === 'win32' ? '.cmd' : ''}`);
    await writeFile(file, process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${script}" ${mode} %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${script}" ${mode} "$@"\n`, { mode: 0o755 });
  }
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH ?? ''}`);
  vi.stubEnv('PIXO_VERIFY_TEST_PID', path.join(root, 'child.pid'));
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); toolTokenRegistry.clear(); await rm(root, { recursive: true, force: true }); });

function profile(commands: EngineProfile['commands'], engine: EngineProfile['engine'] = 'web-generic'): EngineProfile {
  return { detectorVersion: 1, engine, confidence: 'certain', evidence: [], languages: [], assetRoots: [], importMetadata: 'none', commands, tools: [], detectedAt: 0 };
}
const command = (tool: string, timeoutMs = 5000) => ({ argv: [tool], cwd: '.', timeoutMs });
const run = (p: EngineProfile, request = {}) => verifyGame({ profile: p, projectDir, artifactDir, request, resolveTool: gameToolResolver() });

it('executes check then build by default, bounds logs, and skips absent requested commands', async () => {
  const result = await run(profile({ check: command('ok'), build: command('ok') }));
  expect(result.status).toBe('passed');
  expect(result.steps.map(step => [step.name, step.exitCode])).toEqual([['check', 0], ['build', 0]]);
  expect((await readFile(path.join(artifactDir, `${result.steps[0]!.logRef}.log`))).length).toBe(VERIFY_LOG_LIMIT);
  const skipped = await run(profile({ build: command('ok') }), { steps: ['check', 'build'] });
  expect(skipped.status).toBe('passed'); expect(skipped.steps[0]?.status).toBe('skipped');
  expect((await run(profile({}), { steps: ['check'] })).status).toBe('unavailable');
  expect(await readdir(projectDir)).toEqual([]);
});

it('stops at exit 1 and preflights all missing tools without executing anything', async () => {
  const failed = await run(profile({ check: command('fail'), build: command('ok') }));
  expect(failed).toMatchObject({ status: 'failed', steps: [{ name: 'check', exitCode: 1, timedOut: false }] });
  const missing = await run(profile({ check: command('ok'), build: command('not-an-installed-game-tool') }));
  expect(missing).toMatchObject({ status: 'unavailable', steps: [], missingTools: ['not-an-installed-game-tool'] });
});

it('times out and kills the command and its descendant process', async () => {
  // Real process tree cleanup is the boundary; drive its deadline only once the child exists.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let watcher: ReturnType<typeof watch>;
  const childReady = new Promise<void>((resolve, reject) => {
    watcher = watch(root, async (_event, name) => {
      if (String(name) !== 'child.pid') return;
      try { if (Number(await readFile(path.join(root, 'child.pid'), 'utf8')) > 0) resolve(); } catch { /* await the completed write */ }
    });
    watcher.on('error', reject);
  });
  const pending = run(profile({ check: command('timeout', 1000), build: command('ok') }));
  try {
    await childReady;
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    const result = await pending;
    expect(result).toMatchObject({ status: 'failed', steps: [{ name: 'check', timedOut: true }] });
    const pid = Number(await readFile(path.join(root, 'child.pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { watcher!.close(); vi.useRealTimers(); }
});

it.each([
  ['godot', 'Godot', 'https://godotengine.org/download', 'engine-settings'],
  ['npm', 'Node.js (npm)', 'https://nodejs.org', 'path'],
] as const)('returns actionable missing %s guidance through registration', async (tool, name, installUrl, configuration) => {
  const result = await verifyGame({ profile: profile({ check: command(tool) }), projectDir, artifactDir, resolveTool: () => null });
  expect(result).toMatchObject({ status: 'unavailable', steps: [], missingTools: [tool],
    missingToolGuidance: [{ tool, name, installUrl, configuration, hint: expect.any(String) }] });
  const registered = await registerGameVerifyResult(artifactDir, { ...result,
    missingToolGuidance: [{ tool, installUrl: 'https://untrusted.example', hint: 'untrusted' }] });
  expect(registered.missingToolGuidance).toEqual(result.missingToolGuidance);
});

it('prints missing tool installation and executable settings guidance in CLI text output', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/context')) return Response.json({ profile: profile({ check: command('godot') }, 'godot'), projectDir, artifactDir,
      toolPaths: { godot: path.join(root, 'missing-godot.exe') }, webCaptureAvailable: false });
    if (String(url).endsWith('/register')) {
      const input = JSON.parse(String(init?.body));
      return Response.json(await registerGameVerifyResult(artifactDir, input.result));
    }
    throw new Error(String(url));
  }));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runGameCli(['verify', '--project', 'game', '--daemon-url', 'http://127.0.0.1:7456']);
  const text = output.mock.calls.flat().join('\n');
  expect(text).toContain('Godot');
  expect(text).toContain('https://godotengine.org/download');
  expect(text).toContain('executable path in game engine settings');
});

it('captures a web URL then stops the server, and reports an absent desktop as unavailable', async () => {
  const p = profile({ run: command('server') }, 'phaser');
  const captureWeb = vi.fn(async () => ({ status: 'passed' as const, pngBase64: png, width: 1, height: 1 }));
  const result = await verifyGame({ profile: p, projectDir, artifactDir, request: { steps: ['check', 'run'], screenshot: true }, resolveTool: gameToolResolver(), captureWeb });
  expect(result.status).toBe('passed');
  expect(captureWeb).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://localhost:5199/' }));
  // Saved as a JPEG: an agent opens every screenshot, and each one stays in its conversation.
  expect(result.screenshots[0]?.path).toBe(path.join(artifactDir, `${result.screenshots[0]!.ref}.jpg`));
  expect((await readFile(result.screenshots[0]!.path!)).subarray(0, 3).toString('hex')).toBe('ffd8ff');
  const unavailable = await run(p, { steps: ['run'], screenshot: true });
  expect(unavailable).toMatchObject({ status: 'unavailable', steps: [{ status: 'unavailable', exitCode: null }] });
});

it('preserves a verified build and actionable screenshot host reason through CLI registration', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/context')) return Response.json({ profile: profile({ build: command('ok'), run: command('server') }, 'phaser'),
      projectDir, artifactDir, toolPaths: {}, webCaptureAvailable: false });
    if (String(url).endsWith('/register')) return Response.json(await registerGameVerifyResult(artifactDir, JSON.parse(String(init?.body)).result));
    throw new Error(String(url));
  }));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runGameCli(['verify', '--project', 'game', '--steps', 'build,run', '--screenshot']);
  const registered = JSON.parse(await readFile(path.join(artifactDir, 'latest.json'), 'utf8'));
  expect(registered).toMatchObject({ status: 'unavailable', steps: [
    { name: 'build', status: 'passed' },
    { name: 'run', status: 'unavailable', reasonCode: 'SCREENSHOT_HOST_UNAVAILABLE', message: expect.stringContaining('OpenPixo desktop app') },
  ] });
  expect(output.mock.calls.flat().join('\n')).toContain('OpenPixo desktop app');
});

it('captures the last Godot movie frame and registers absolute paths and run lineage', async () => {
  const result = await run(profile({ run: command('godot') }, 'godot'), { steps: ['run'], screenshot: true });
  expect(result.status).toBe('passed');
  expect(result.steps[0]?.argv).toEqual(expect.arrayContaining(['--fixed-fps', '30', '--quit-after', '30']));
  expect(result.screenshots).toEqual([{ ref: expect.any(String), width: 1, height: 1, path: expect.stringContaining(artifactDir) }]);
  const registered = await registerGameVerifyResult(artifactDir, result, 'agent-run');
  expect(registered).toMatchObject({ runId: 'agent-run', screenshots: [{ path: result.screenshots[0]!.path }] });
  expect((await readdir(artifactDir)).some(file => !file.includes('.'))).toBe(false);
  await expect(gameVerifyArtifact(artifactDir, '../outside', 'log')).rejects.toThrow();
  expect(await readdir(projectDir)).toEqual([]);
});

it('rejects agent tool tokens at the daemon execution endpoint before reading the project or running commands', async () => {
  const grant = toolTokenRegistry.mint({ projectId: 'game', runId: 'run' });
  const authorize = vi.fn();
  const app = express(); app.use(express.json());
  registerGameVerifyRoutes(app, {
    db: null, http: { requireLocalDaemonRequest, sendApiError: (res: Response, code: number, _error: string, message: string) => res.status(code).json({ error: message }) },
    authorizeProjectRequest: authorize,
  } as unknown as RegisterGameVerifyRoutesDeps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/game/game/verify`, {
      method: 'POST', headers: { authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain(`inside the ${PRODUCT_CLI_NAME} CLI`);
    expect(authorize).not.toHaveBeenCalled();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('returns the same actionable unavailable host reason from the HTTP capture endpoint', async () => {
  const db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'game', name: 'Game', metadata: { baseDir: projectDir }, createdAt: 1, updatedAt: 1 });
  const app = express(); app.use(express.json());
  registerGameVerifyRoutes(app, {
    db, paths: { PROJECTS_DIR: root, ARTIFACTS_DIR: artifactDir, RUNTIME_DATA_DIR: root },
    http: { requireLocalDaemonRequest, sendApiError: (res: Response, code: number, _error: string, message: string) => res.status(code).json({ error: message }) },
    authorizeProjectRequest: async () => true,
  } as unknown as RegisterGameVerifyRoutesDeps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/projects/game/game/verify`;
  try {
    const response = await fetch(`${base}/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:5199/', timeoutMs: 1000, waitMs: 0 }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'unavailable', reasonCode: 'SCREENSHOT_HOST_UNAVAILABLE', message: expect.stringContaining('OpenPixo desktop app') });
    expect(await (await fetch(`${base}/context`)).json()).toMatchObject({ webCaptureAvailable: false });
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeDatabase();
  }
});

it('runs CLI verification locally with PIXO_PROJECT_ID and returns registered absolute screenshot paths as JSON', async () => {
  vi.stubEnv('PIXO_PROJECT_ID', 'game');
  vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_test');
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/context')) return new Response(JSON.stringify({ profile: profile({ run: command('godot') }, 'godot'), projectDir, artifactDir,
      toolPaths: {}, webCaptureAvailable: false, runId: 'agent-run' }));
    if (String(url).endsWith('/register')) {
      const input = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(await registerGameVerifyResult(artifactDir, input.result, input.runId)));
    }
    throw new Error('The CLI must not ask the daemon to execute commands');
  });
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await runGameCli(['verify', '--daemon-url', 'http://127.0.0.1:7456', '--steps', 'check,build,run', '--screenshot', '--json']);
  const result = JSON.parse(String(output.mock.calls[0]?.[0]));
  expect(result).toMatchObject({ status: 'passed', runId: 'agent-run', screenshots: [{ path: expect.stringContaining(artifactDir) }] });
  expect(path.isAbsolute(result.screenshots[0].path)).toBe(true);
  expect(request.mock.calls.map(call => String(call[0]).split('/').at(-1))).toEqual(['context', 'register']);
});
