import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gamePlaytestPreset, parseGamePlaytestRequest, type EngineProfile, type GameWebCaptureResult } from '@openpixo/contracts';
import { assertGamePlaytestProvenance, playtestGame, godotMovieArgs } from '../../src/game/playtest.js';
import { registerGameVerifyResult } from '../../src/game/verify-store.js';
import { normalizeGamePlaytestReport } from '../../src/game/playtest-store.js';

let root: string, projectDir: string, artifactDir: string;
// A PNG a real decoder accepts: frames are re-encoded, not stored byte for byte.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWMwTpsJAAICATMDms/iAAAAAElFTkSuQmCC';
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pixo-playtest-'));
  projectDir = path.join(root, 'game'); artifactDir = path.join(root, 'artifacts');
  await Promise.all([mkdir(projectDir), mkdir(artifactDir)]);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
function profile(argv: string[], engine: EngineProfile['engine'] = 'phaser'): EngineProfile {
  return { detectorVersion: 1, engine, confidence: 'certain', evidence: [], languages: [], assetRoots: [],
    importMetadata: 'none', commands: { run: { argv, cwd: '.', timeoutMs: 5000 } }, tools: [], detectedAt: 0 };
}
const captured = (errors: string[] = []): GameWebCaptureResult => ({ status: 'passed', pngBase64: png, width: 1, height: 1,
  playtest: { completed: true, durationMs: 100, frames: [{ pngBase64: png, width: 1, height: 1, atMs: 80, label: 'jump' }],
    console: [{ level: 'warning', text: 'fixture warning', atMs: 10 }], pageErrors: errors,
    fps: { min: 50, avg: 60, samples: 6 } } });

it('drives a fake run command through the capture host, stores frames, and stops its process', async () => {
  // A real child process proves URL detection and cleanup; the capture host performs no browser waits.
  const pidFile = path.join(projectDir, 'pid');
  const script = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); console.log('Local: http://127.0.0.1:5199/'); setInterval(()=>{},1000);`;
  const captureWeb = vi.fn(async () => captured());
  const result = await playtestGame({ profile: profile(['node', '-e', script]), projectDir, artifactDir,
    request: { durationMs: 100, script: [{ capture: 'jump' }] }, resolveTool: () => process.execPath, captureWeb });
  expect(result).toMatchObject({ status: 'passed', playtest: { completed: true, durationMs: 100, fps: { min: 50, avg: 60 }, frames: [{ label: 'jump' }] } });
  expect(captureWeb).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:5199/', playtest: expect.objectContaining({ durationMs: 100 }) }));
  const pid = Number(await readFile(pidFile, 'utf8'));
  expect(() => process.kill(pid, 0)).toThrow();
  const registered = await registerGameVerifyResult(artifactDir, result, 'agent');
  expect(registered.playtest).toEqual(result.playtest);
  expect((await readFile(result.playtest.frames[0]!.path!)).subarray(0, 3).toString('hex')).toBe('ffd8ff');
  // One image of the whole run, so an agent opens one file instead of every frame.
  expect(result.playtest.overview).toEqual({ ref: expect.any(String), width: expect.any(Number), height: expect.any(Number),
    path: path.join(artifactDir, `${result.playtest.overview!.ref}.jpg`) });
  expect(registered.playtest?.overview).toEqual(result.playtest.overview);
});

it('refuses a registered overview that is not one of its own saved images', async () => {
  const result = await playtestGame({ profile: profile(['node', '-e', "console.log('http://localhost:5199/');setInterval(()=>{},1000)"]),
    projectDir, artifactDir, request: { durationMs: 100 }, resolveTool: () => process.execPath, captureWeb: async () => captured() });
  await expect(registerGameVerifyResult(artifactDir, { ...result, playtest: { ...result.playtest, overview: { ref: '../escape', width: 1, height: 1 } } }))
    .rejects.toThrow();
});

it('prunes old playtest files from disk each time a result is registered', async () => {
  const stale = path.join(artifactDir, '00000000-0000-4000-8000-000000000001.jpg');
  await writeFile(stale, 'x');
  await utimes(stale, new Date(Date.now() - 2 * 24 * 3600_000), new Date(Date.now() - 2 * 24 * 3600_000));
  const result = await playtestGame({ profile: profile(['node', '-e', "console.log('http://localhost:5199/');setInterval(()=>{},1000)"]),
    projectDir, artifactDir, request: { durationMs: 100 }, resolveTool: () => process.execPath, captureWeb: async () => captured() });
  await registerGameVerifyResult(artifactDir, result);
  expect(await readdir(artifactDir)).not.toContain(path.basename(stale));
});

it('fails on captured page errors even when the server was ready', async () => {
  const result = await playtestGame({ profile: profile(['node', '-e', "console.log('http://localhost:5199/');setInterval(()=>{},1000)"]),
    projectDir, artifactDir, request: { durationMs: 100 }, resolveTool: () => process.execPath, captureWeb: async () => captured(['Uncaught fixture failure']) });
  expect(result.status).toBe('failed'); expect(result.playtest.pageErrors).toEqual(['Uncaught fixture failure']);
});

it('preflights unavailable hosts, tools and unsupported engines without spawning a game', async () => {
  const resolveTool = vi.fn(() => process.execPath);
  expect(await playtestGame({ profile: profile(['node']), projectDir, artifactDir, resolveTool }))
    .toMatchObject({ status: 'unavailable', playtest: { reasonCode: 'SCREENSHOT_HOST_UNAVAILABLE', completed: false } });
  expect(resolveTool).not.toHaveBeenCalled();
  expect(await playtestGame({ profile: profile(['unity'], 'unity'), projectDir, artifactDir, resolveTool }))
    .toMatchObject({ status: 'unavailable', playtest: { reasonCode: 'UNSUPPORTED_ENGINE' } });
});

it('constructs Godot movie argv with a real renderer, bounded frames and a hidden window', () => {
  const argv = godotMovieArgs(['godot', '--path', '.'], '/artifacts/movie/frame.png', 2000);
  expect(argv).toEqual(expect.arrayContaining(['--write-movie', '/artifacts/movie/frame.png', '--fixed-fps', '30', '--quit-after', '60', '--minimized']));
  expect(argv).not.toContain('--headless');
  expect(() => godotMovieArgs(['godot', '--headless'], '/frame.png', 100)).toThrow(/headless/i);
});

it('samples Godot frames and treats SCRIPT ERROR on stdout as failure even after exit 0', async () => {
  const script = path.join(projectDir, 'fixture.cts');
  await writeFile(script, `const fs=require('node:fs'); const p=process.argv[process.argv.indexOf('--write-movie')+1]; fs.writeFileSync(p.replace('.png','00001.png'), Buffer.from('${png}','base64'));process.stdout.write('x'.repeat(1024 * 1024 + 1024) + '\\n');console.log('\\x1b[31mSCRIPT ERROR: fixture\\x1b[0m');`);
  const result = await playtestGame({ profile: profile(['node', script], 'godot'), projectDir, artifactDir,
    request: { durationMs: 100 }, resolveTool: () => process.execPath });
  expect(result).toMatchObject({ status: 'failed', playtest: { frames: [{ width: 1 }], fps: null, pageErrors: [expect.stringContaining('SCRIPT ERROR')] } });
  expect((await readdir(artifactDir)).every(file => file.includes('.'))).toBe(true);
});

it('returns Godot SCRIPT ERROR diagnostics even when it exits before producing any frames', async () => {
  const script = path.join(projectDir, 'no-frames.cts');
  await writeFile(script, "console.error('SCRIPT ERROR: no scene');");
  const result = await playtestGame({ profile: profile(['node', script], 'godot'),
    projectDir, artifactDir, request: { durationMs: 100 }, resolveTool: () => process.execPath });
  expect(await readFile(path.join(artifactDir, result.steps[0]!.logRef + '.log'), 'utf8')).toContain('SCRIPT ERROR: no scene');
  expect(result).toMatchObject({ status: 'failed', playtest: { frames: [], completed: false, pageErrors: ['SCRIPT ERROR: no scene'] } });
});

it('records seeded preset provenance in the report and keeps it through registration', async () => {
  const request = gamePlaytestPreset('monkey', { seed: 4242 });
  const captureWeb = vi.fn(async () => captured());
  const result = await playtestGame({ profile: profile(['node', '-e', "console.log('http://localhost:5199/');setInterval(()=>{},1000)"]),
    projectDir, artifactDir, request, resolveTool: () => process.execPath, captureWeb });
  expect(result).toMatchObject({ status: 'passed', playtest: { preset: 'monkey', seed: 4242 } });
  // The capture host receives the same normalized pointer steps the preset produced.
  expect(captureWeb).toHaveBeenCalledWith(expect.objectContaining({ playtest: expect.objectContaining({ preset: 'monkey', seed: 4242,
    script: expect.arrayContaining([expect.objectContaining({ drag: expect.objectContaining({ durationMs: expect.any(Number) }) })]) }) }));
  const registered = await registerGameVerifyResult(artifactDir, result, 'agent');
  expect(registered.playtest).toMatchObject({ preset: 'monkey', seed: 4242 });
  const { seed: _seed, ...unseeded } = result.playtest;
  expect(() => normalizeGamePlaytestReport(unseeded, result.screenshots)).toThrow();
  expect(() => normalizeGamePlaytestReport({ ...result.playtest, preset: 'observe' }, result.screenshots)).toThrow();
});

it('refuses a script that does not match its declared preset and seed before spawning anything', async () => {
  const resolveTool = vi.fn(() => process.execPath);
  const request = gamePlaytestPreset('random', { seed: 1 });
  await expect(playtestGame({ profile: profile(['node']), projectDir, artifactDir, resolveTool,
    request: { ...request, seed: 2 } })).rejects.toThrow(/preset and seed/);
  await expect(playtestGame({ profile: profile(['node']), projectDir, artifactDir, resolveTool,
    request: { ...gamePlaytestPreset('clickGrid'), script: [{ click: [1, 1] }] } })).rejects.toThrow(/preset and seed/);
  expect(resolveTool).not.toHaveBeenCalled();
  expect(() => assertGamePlaytestProvenance(parseGamePlaytestRequest(gamePlaytestPreset('drag')))).not.toThrow();
});

it('keeps Godot honest: pointer scripts are reported as unsupported input instead of silently ignored', async () => {
  const resolveTool = vi.fn(() => process.execPath);
  const result = await playtestGame({ profile: profile(['godot', '--path', '.'], 'godot'), projectDir, artifactDir, resolveTool,
    request: gamePlaytestPreset('clickGrid') });
  expect(result).toMatchObject({ status: 'unavailable', playtest: { inputSupported: false, reasonCode: 'SCRIPT_UNSUPPORTED', preset: 'clickGrid' } });
  expect(resolveTool).not.toHaveBeenCalled();
});
