import { randomUUID } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GAME_SCREENSHOT_HOST_UNAVAILABLE, type EngineProfile, type GameVerifyRequest, type GameVerifyResult,
  type GameVerifyStep, type GameWebCaptureRequest, type GameWebCaptureResult } from '@openpixo/contracts';
import { resolveOnPath } from '../runtimes/executables.js';
import { missingGameToolGuidance } from './verify-tools.js';
import { executeGameProcess, GameCommandTimeout, VERIFY_LOG_LIMIT } from './verify-process.js';
import { saveGameFrame } from './frame-store.js';
import { godotMovieArgs } from './playtest-godot.js';
import { createGodotErrorCollector } from './playtest-diagnostics.js';
export { gameLocalUrl, VERIFY_LOG_LIMIT } from './verify-process.js';
export type GameWebCapture = (input: GameWebCaptureRequest) => Promise<GameWebCaptureResult>;

export function gameToolResolver(overrides: Partial<Record<string, string>> = {}): (id: string) => string | null {
  return id => {
    const configured = overrides[id]?.trim();
    if (!configured) return resolveOnPath(id === 'cocosCreator' ? 'CocosCreator' : id);
    try {
      if (!path.isAbsolute(configured) || !statSync(configured).isFile()) return null;
      if (process.platform === 'win32' && !/\.(exe|cmd|bat|com)$/i.test(configured)) return null;
      accessSync(configured, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return configured;
    } catch { return null; }
  };
}

/** argv is exclusively the detected profile; capture flags are host-owned constants. */
export async function verifyGame(options: {
  profile: EngineProfile; projectDir: string; artifactDir: string; request?: GameVerifyRequest;
  resolveTool: (id: string) => string | null | Promise<string | null>; captureWeb?: GameWebCapture;
}): Promise<GameVerifyResult> {
  const { profile, artifactDir, resolveTool } = options;
  const request = options.request ?? {};
  const requested = request.steps ?? ['check', ...(profile.commands.build ? ['build' as const] : []), ...(request.screenshot ? ['run' as const] : [])];
  const names = (['check', 'build', 'run'] as const).filter(name => requested.includes(name));
  const result: GameVerifyResult = { status: 'unavailable', steps: [], screenshots: [], missingTools: [], ...(request.runId ? { runId: request.runId } : {}) };
  const tools = new Map<string, string>();
  for (const name of names) {
    const id = profile.commands[name]?.argv[0];
    if (!id || tools.has(id)) continue;
    const executable = await resolveTool(id);
    if (!executable) result.missingTools.push(id); else tools.set(id, executable);
  }
  result.missingTools = [...new Set(result.missingTools)];
  if (result.missingTools.length) { result.missingToolGuidance = missingGameToolGuidance(result.missingTools); return result; }
  await mkdir(artifactDir, { recursive: true });
  let executed = false, unavailable = false;
  for (const name of names) {
    const command = profile.commands[name], logRef = randomUUID(), started = Date.now();
    const step: GameVerifyStep = { name, argv: [...(command?.argv ?? [])], exitCode: null, durationMs: 0, logRef, timedOut: false, status: 'skipped' };
    result.steps.push(step);
    let log = Buffer.alloc(0), movieDir: string | undefined;
    const godotErrors = createGodotErrorCollector();
    const append = (chunk: Buffer | string) => {
      godotErrors.append(chunk);
      if (log.length < VERIFY_LOG_LIMIT) log = Buffer.concat([log, Buffer.from(chunk).subarray(0, VERIFY_LOG_LIMIT - log.length)]);
    };
    try {
      if (!command) { step.message = profile.unavailableReasons?.[name] ?? 'No command in the engine profile';
        if (profile.unavailableReasons?.[name]) { step.status = 'unavailable'; unavailable = true; } continue; }
      const web = ['phaser', 'threejs', 'web-generic'].includes(profile.engine);
      if (name === 'run' && (['unity', 'bevy'].includes(profile.engine) || (request.screenshot && !web && profile.engine !== 'godot'))) {
        step.message = 'Run capture is not supported for this engine'; continue;
      }
      if (name === 'run' && request.screenshot && web && !options.captureWeb) {
        Object.assign(step, GAME_SCREENSHOT_HOST_UNAVAILABLE); unavailable = true; continue;
      }
      let argv = [...command.argv];
      if (name === 'run' && profile.engine === 'godot') {
        movieDir = path.join(artifactDir, randomUUID()); await mkdir(movieDir);
        argv = godotMovieArgs(argv, path.join(movieDir, 'frame.png'), 1000);
      }
      step.argv = argv; executed = true;
      const outcome = await executeGameProcess<GameWebCaptureResult | undefined>({ projectDir: options.projectDir, command, argv,
        executable: tools.get(argv[0]!)!, output: append,
        ...(name === 'run' && web ? { action: async ({ urlReady, remainingMs }) => {
          const url = await urlReady;
          return request.screenshot ? options.captureWeb!({ url, timeoutMs: remainingMs(), waitMs: 1000 }) : undefined;
        } } : {}),
      });
      if (outcome.value && outcome.value.status !== 'passed') {
        Object.assign(step, outcome.value); unavailable ||= outcome.value.status === 'unavailable';
      } else {
        // A web zero records a completed readiness/capture operation; cleanup intentionally stops its server.
        step.exitCode = name === 'run' && web ? 0 : outcome.exitCode;
        step.status = (command.successExitCodes ?? [0]).includes(step.exitCode!) ? 'passed' : 'failed';
        if (outcome.value?.status === 'passed') {
          result.screenshots.push(await saveGameFrame(artifactDir, Buffer.from(outcome.value.pngBase64, 'base64')));
        }
      }
      if (movieDir && request.screenshot && step.status === 'passed') {
        const last = (await readdir(movieDir)).filter(file => /^frame\d*\.png$/i.test(file)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
        if (!last) throw new Error('Godot produced no movie frames; a working graphics/display driver is required, without --headless');
        result.screenshots.push(await saveGameFrame(artifactDir, await readFile(path.join(movieDir, last))));
      }
      if (profile.engine === 'godot' && godotErrors.finish().length > 0) {
        step.status = 'failed'; step.message = 'Godot reported errors; inspect the step log';
      }
    } catch (error) {
      step.status = 'failed'; step.timedOut = error instanceof GameCommandTimeout;
      step.message = error instanceof Error ? error.message : String(error);
    } finally {
      step.durationMs = Date.now() - started; if (step.message) append('\n' + step.message + '\n');
      await writeFile(path.join(artifactDir, logRef + '.log'), log);
      if (movieDir) await rm(movieDir, { recursive: true, force: true });
    }
    if (step.status === 'failed') { result.status = 'failed'; return result; }
  }
  result.status = executed && !unavailable ? 'passed' : 'unavailable';
  return result;
}
