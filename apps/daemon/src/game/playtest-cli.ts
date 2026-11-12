import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PRODUCT_CLI_NAME, GAME_PLAYTEST_LIMITS, GAME_PLAYTEST_PRESET_IDS, GAME_PLAYTEST_PRESETS, gamePlaytestPreset,
  gamePlaytestPresetInfo, isGamePlaytestPresetId, isGamePlaytestSeed, parseGamePlaytestRequest, randomGamePlaytestSeed,
  type GamePlaytestReport, type GameVerifyContext, type GamePlaytestResult, type GameWebCaptureResult } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';
import { gameToolResolver } from './verify.js';
import { playtestGame } from './playtest.js';

export const GAME_PLAYTEST_USAGE = PRODUCT_CLI_NAME + ' game playtest [--project <id>] [--script <file|-> | --preset <'
  + GAME_PLAYTEST_PRESET_IDS.join('|') + '> [--seed <0..4294967295>]] [--duration <seconds: 0.1..30>] [--json]\n'
  + PRODUCT_CLI_NAME + ' game playtest --list-presets [--json]';

/** Expand --preset/--seed through the same pure preset functions the UI uses. A seeded preset without
 * --seed draws a fresh seed; the report records it so the run can be replayed with --seed. */
export function gamePlaytestPresetRequest(preset: string, seed: string | undefined): ReturnType<typeof gamePlaytestPreset> {
  if (!isGamePlaytestPresetId(preset)) throw new Error('Unknown playtest preset "' + preset + '". Choose one of: ' + GAME_PLAYTEST_PRESET_IDS.join(', '));
  const info = gamePlaytestPresetInfo(preset);
  if (!info.seeded) {
    if (seed !== undefined) throw new Error('Preset "' + preset + '" is not random; --seed applies only to: '
      + GAME_PLAYTEST_PRESETS.filter(item => item.seeded).map(item => item.id).join(', '));
    return gamePlaytestPreset(preset);
  }
  if (seed !== undefined && (!/^\d{1,10}$/.test(seed) || !isGamePlaytestSeed(Number(seed)))) throw new Error('--seed must be a whole number from 0 to 4294967295');
  return gamePlaytestPreset(preset, { seed: seed === undefined ? randomGamePlaytestSeed() : Number(seed) });
}

function printGamePlaytestPresets(json: boolean): void {
  if (json) { process.stdout.write(JSON.stringify({ presets: GAME_PLAYTEST_PRESETS }, null, 2) + '\n'); return; }
  for (const preset of GAME_PLAYTEST_PRESETS) {
    console.log(preset.id.padEnd(10) + ' ' + (preset.input + ', ' + preset.durationMs / 1000 + ' s' + (preset.seeded ? ', seeded' : '')).padEnd(24) + ' ' + preset.summary);
  }
}

function gamePlaytestReplayHint(report: GamePlaytestReport): string | null {
  if (!report.preset) return null;
  return 'Preset: ' + report.preset + (report.seed !== undefined ? ' (seed ' + report.seed + ')\nReplay: ' + PRODUCT_CLI_NAME
    + ' game playtest --preset ' + report.preset + ' --seed ' + report.seed : '');
}
export async function readGamePlaytestScript(file: string): Promise<unknown> {
  if (file === '-') {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString('utf8');
      if (Buffer.byteLength(input) > GAME_PLAYTEST_LIMITS.scriptBytes) throw new Error('Playtest script exceeds 32 KiB');
    }
    return JSON.parse(input);
  }
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > GAME_PLAYTEST_LIMITS.scriptBytes) throw new Error('Playtest script exceeds 32 KiB');
    // Bound the read even if another writer grows the file after stat.
    const bytes = Buffer.alloc(GAME_PLAYTEST_LIMITS.scriptBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > GAME_PLAYTEST_LIMITS.scriptBytes) throw new Error('Playtest script exceeds 32 KiB');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally { await handle.close(); }
}
export async function runGamePlaytestCli(args: string[]): Promise<void> {
  const json = args.includes('--json');
  try {
    if (args.includes('--help') || args.includes('-h')) { console.log(GAME_PLAYTEST_USAGE); return; }
    const { values } = parseArgs({ args: args.slice(1), options: {
      project: { type: 'string' }, script: { type: 'string' }, duration: { type: 'string' },
      preset: { type: 'string' }, seed: { type: 'string' }, 'list-presets': { type: 'boolean' },
      json: { type: 'boolean' }, 'daemon-url': { type: 'string' },
    } });
    if (values['list-presets']) { printGamePlaytestPresets(json); return; }
    if (values.preset !== undefined && values.script !== undefined) throw new Error('Use either --script or --preset, not both');
    if (values.seed !== undefined && values.preset === undefined) throw new Error('--seed needs a seeded --preset (random or monkey)');
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error('Project id required. ' + GAME_PLAYTEST_USAGE);
    const request = parseGamePlaytestRequest({
      ...(values.preset !== undefined ? gamePlaytestPresetRequest(values.preset, values.seed) : {}),
      ...(values.script ? { script: await readGamePlaytestScript(values.script) } : {}),
      ...(values.duration !== undefined ? { durationMs: Number(values.duration) * 1000 } : {}),
    });
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const prefix = base + '/api/projects/' + encodeURIComponent(projectId) + '/game/';
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = 'Bearer ' + process.env.PIXO_TOOL_TOKEN;
    const api = async <T>(suffix: string, body?: unknown): Promise<T> => {
      const response = await fetch(prefix + suffix, { headers, method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json() as T & { error?: { message?: string } };
      if (!response.ok) throw new Error(data?.error?.message ?? 'Playtest request failed (' + response.status + ')');
      return data;
    };
    let result: GamePlaytestResult;
    if (process.env.PIXO_TOOL_TOKEN) {
      const context = await api<GameVerifyContext>('verify/context');
      const local = await playtestGame({ ...context, request, resolveTool: gameToolResolver(context.toolPaths),
        ...(context.webCaptureAvailable ? { captureWeb: input => api<GameWebCaptureResult>('verify/capture', input) } : {}) });
      result = await api<GamePlaytestResult>('verify/register', { result: local, runId: context.runId ?? process.env.PIXO_RUN_ID });
    } else result = await api<GamePlaytestResult>('playtest', request);
    if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      console.log('Playtest: ' + result.status + ' (' + result.playtest.durationMs + ' ms)');
      const replay = gamePlaytestReplayHint(result.playtest);
      if (replay) console.log(replay);
      if (result.playtest.reasonCode) console.log(result.playtest.reasonCode);
      for (const guidance of result.missingToolGuidance ?? []) console.log(guidance.hint);
      if (result.playtest.fps) console.log('FPS avg/min: ' + result.playtest.fps.avg.toFixed(1) + '/' + result.playtest.fps.min.toFixed(1));
      if (result.playtest.overview) console.log('Overview (every frame in one image): ' + result.playtest.overview.path);
      for (const frame of result.playtest.frames) console.log('Frame: ' + frame.path + ' (' + frame.atMs + ' ms)');
      for (const error of result.playtest.pageErrors) console.log(error);
      for (const message of result.playtest.console) console.log(message.level + ': ' + message.text);
      for (const step of result.steps) console.log('Log: ' + step.logRef + (step.message ? '\n' + step.message : ''));
    }
    if (result.status !== 'passed') process.exitCode = result.status === 'unavailable' ? 2 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(JSON.stringify({ error: { message } }) + '\n'); else process.stderr.write(message + '\n');
    process.exitCode = 1;
  }
}
