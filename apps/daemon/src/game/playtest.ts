import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GAME_PLAYTEST_LIMITS, gamePlaytestPreset, parseGamePlaytestRequest, type EngineProfile, type GamePlaytestReason,
  type GamePlaytestRequest, type ParsedGamePlaytestRequest, type GamePlaytestResult, type GameVerifyStep, type GameWebCaptureResult, type GameWebPlaytestCapture } from '@openpixo/contracts';
import type { GameWebCapture } from './verify.js';
import { missingGameToolGuidance } from './verify-tools.js';
import { executeGameProcess, GameCommandTimeout, VERIFY_LOG_LIMIT } from './verify-process.js';
import { saveGameFrame, saveGamePlaytestOverview } from './frame-store.js';
import { godotMovieArgs } from './playtest-godot.js';
export { godotMovieArgs } from './playtest-godot.js';
import { createGodotErrorCollector } from './playtest-diagnostics.js';

/** A request that names a preset (and seed) must be replayable: its script has to be exactly that
 * preset's output, otherwise the report's provenance would describe a run that never happened. */
export function assertGamePlaytestProvenance(request: ParsedGamePlaytestRequest): void {
  if (!request.preset) return;
  const expected = parseGamePlaytestRequest(gamePlaytestPreset(request.preset, request.seed === undefined ? {} : { seed: request.seed }));
  if (JSON.stringify(expected.script) !== JSON.stringify(request.script)) throw new Error('Playtest script does not match the declared preset and seed');
}

/** Agent project commands execute in the CLI child; the host only operates the browser. */
export async function playtestGame(options: {
  profile: EngineProfile; projectDir: string; artifactDir: string; request?: GamePlaytestRequest;
  resolveTool: (id: string) => string | null | Promise<string | null>; captureWeb?: GameWebCapture;
}): Promise<GamePlaytestResult> {
  const request = parseGamePlaytestRequest(options.request ?? {}), { profile, artifactDir } = options;
  assertGamePlaytestProvenance(request);
  const provenance = { ...(request.preset ? { preset: request.preset } : {}), ...(request.seed !== undefined ? { seed: request.seed } : {}) };
  const web = ['phaser', 'threejs', 'web-generic'].includes(profile.engine);
  const result: GamePlaytestResult = { status: 'unavailable', steps: [], screenshots: [], missingTools: [],
    playtest: { completed: false, durationMs: 0, frames: [], console: [], pageErrors: [], fps: null, inputSupported: web, ...provenance } };
  const unavailable = (reasonCode: GamePlaytestReason) => { result.status = 'unavailable'; result.playtest.reasonCode = reasonCode; return result; };
  if (!web && profile.engine !== 'godot') return unavailable('UNSUPPORTED_ENGINE');
  const command = profile.commands.run;
  if (!command?.argv[0]) return unavailable('RUN_COMMAND_UNAVAILABLE');
  if (web && !options.captureWeb) return unavailable('SCREENSHOT_HOST_UNAVAILABLE');
  if (!web && request.script.length) return unavailable('SCRIPT_UNSUPPORTED');
  const executable = await options.resolveTool(command.argv[0]);
  if (!executable) { result.missingTools = [command.argv[0]]; result.missingToolGuidance = missingGameToolGuidance(result.missingTools); return result; }
  await mkdir(artifactDir, { recursive: true });
  const logRef = randomUUID(), started = Date.now();
  const step: GameVerifyStep = { name: 'run', argv: [...command.argv], status: 'failed', exitCode: null, durationMs: 0, logRef, timedOut: false };
  result.steps.push(step);
  let log = Buffer.alloc(0), movieDir: string | undefined;
  const godotErrors = createGodotErrorCollector();
  const append = (chunk: Buffer | string) => { godotErrors.append(chunk); if (log.length < VERIFY_LOG_LIMIT) log = Buffer.concat([log, Buffer.from(chunk).subarray(0, VERIFY_LOG_LIMIT - log.length)]); };
  const saveFrames = async (capture: GameWebPlaytestCapture) => {
    if (!capture.frames.length || capture.frames.length > GAME_PLAYTEST_LIMITS.frames || !Number.isFinite(capture.durationMs)
      || capture.durationMs < 0 || capture.durationMs > GAME_PLAYTEST_LIMITS.durationMs + 5000
      || capture.console.length > GAME_PLAYTEST_LIMITS.consoleMessages || capture.pageErrors.length > GAME_PLAYTEST_LIMITS.pageErrors) throw new Error('Invalid playtest capture');
    result.playtest = { ...capture, frames: [], inputSupported: web, ...provenance };
    for (const frame of capture.frames) {
      if (typeof frame.pngBase64 !== 'string' || frame.pngBase64.length > 28 * 1024 * 1024) throw new Error('Playtest frame exceeds capture limit');
      const shot = await saveGameFrame(artifactDir, Buffer.from(frame.pngBase64, 'base64'));
      result.screenshots.push(shot);
      result.playtest.frames.push({ ...shot, atMs: frame.atMs, ...(frame.label ? { label: frame.label } : {}) });
    }
    const overview = await saveGamePlaytestOverview(artifactDir, result.playtest.frames);
    if (overview) result.playtest.overview = overview;
  };
  try {
    let argv = [...command.argv];
    if (!web) { movieDir = path.join(artifactDir, randomUUID()); await mkdir(movieDir); argv = godotMovieArgs(argv, path.join(movieDir, 'frame.png'), request.durationMs); }
    step.argv = argv;
    const timeoutMs = Math.min(120_000, command.timeoutMs + request.durationMs + 5000);
    const outcome = await executeGameProcess<GameWebCaptureResult>({ projectDir: options.projectDir, command: { ...command, timeoutMs }, argv, executable, output: append,
      ...(web ? { action: async ({ urlReady, remainingMs }) => {
        const url = await urlReady; return options.captureWeb!({ url, timeoutMs: remainingMs(), waitMs: 0, playtest: request });
      } } : {}) });
    if (web) {
      const capture = outcome.value;
      if (!capture || capture.status !== 'passed') {
        result.status = capture?.status ?? 'failed'; step.status = result.status; step.message = capture?.message ?? 'No playtest capture returned';
        if (capture?.status === 'unavailable') result.playtest.reasonCode = capture.reasonCode ?? 'CAPTURE_UNAVAILABLE'; return result;
      }
      if (!capture.playtest) { step.status = 'unavailable'; return unavailable('CAPTURE_UNAVAILABLE'); }
      await saveFrames(capture.playtest);
      if (!capture.playtest.completed || !capture.playtest.fps?.samples) throw new Error('Playtest did not complete or no animation frame timing was measured');
      // Zero describes a completed capture operation; the dev server is deliberately stopped afterward.
      step.exitCode = 0;
    } else {
      step.exitCode = outcome.exitCode;
      const files = (await readdir(movieDir!)).filter(file => /^frame\d*\.png$/i.test(file)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const errors = godotErrors.finish();
      result.playtest.pageErrors = errors;
      if (!files.length) {
        if (errors.length || outcome.exitCode !== 0) {
          result.status = step.status = 'failed';
          result.playtest.durationMs = Math.min(request.durationMs, Date.now() - started);
          step.message = 'Godot exited with errors before producing movie frames.';
          return result;
        }
        step.status = 'unavailable'; step.message = 'Godot produced no movie frames. A graphics/display driver is required; --headless cannot capture gameplay.';
        return unavailable('GODOT_CAPTURE_UNAVAILABLE');
      }
      const sampled = files.length <= GAME_PLAYTEST_LIMITS.frames ? files : Array.from({ length: GAME_PLAYTEST_LIMITS.frames }, (_, i) => files[Math.round(i * (files.length - 1) / (GAME_PLAYTEST_LIMITS.frames - 1))]!);
      await saveFrames({ completed: outcome.exitCode === 0, durationMs: request.durationMs, console: [], pageErrors: errors, fps: null,
        frames: await Promise.all(sampled.map(async file => ({ pngBase64: (await readFile(path.join(movieDir!, file))).toString('base64'), width: 0, height: 0,
          atMs: Math.min(request.durationMs, Number(file.match(/\d+/)?.[0] ?? 0) * 1000 / 30) }))) });
    }
    const failed = !result.playtest.completed || result.playtest.pageErrors.length > 0 || result.playtest.console.some(message => message.level === 'error');
    step.status = result.status = failed ? 'failed' : 'passed';
  } catch (error) {
    result.status = step.status = 'failed'; step.timedOut = error instanceof GameCommandTimeout;
    step.message = error instanceof Error ? error.message : String(error);
  } finally {
    step.durationMs = Date.now() - started; if (step.message) append(`\n${step.message}\n`);
    await writeFile(path.join(artifactDir, `${logRef}.log`), log); if (movieDir) await rm(movieDir, { recursive: true, force: true });
  }
  return result;
}
