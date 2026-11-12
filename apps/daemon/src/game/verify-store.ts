import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GameVerifyResult, GameVerifyScreenshot } from '@openpixo/contracts';
import { VERIFY_LOG_LIMIT } from './verify.js';
import { missingGameToolGuidance } from './verify-tools.js';
import { normalizeGamePlaytestReport } from './playtest-store.js';
import { gameFrameSize, pruneGameVerifyArtifacts } from './frame-store.js';

const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller must supply the daemon's resolved artifact root, never a cwd fallback. */
export function gameVerifyArtifactDir(artifactsRoot: string, projectId: string): string {
  return path.resolve(artifactsRoot, 'game-verify', createHash('sha256').update(projectId).digest('hex'));
}

export async function gameVerifyArtifact(dir: string, ref: string, kind: 'log' | 'png' | 'jpg'): Promise<string> {
  if (!REF.test(ref)) throw new Error('Invalid verification artifact reference');
  const file = path.join(dir, `${ref}.${kind}`);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > (kind === 'log' ? VERIFY_LOG_LIMIT : 20 * 1024 * 1024)) throw new Error('Invalid verification artifact');
  return file;
}

/** A stored frame or screenshot: JPEG since frames were made small, PNG in older results. */
export async function gameVerifyImage(dir: string, ref: string): Promise<GameVerifyScreenshot> {
  let file: string;
  try { file = await gameVerifyArtifact(dir, ref, 'jpg'); } catch { file = await gameVerifyArtifact(dir, ref, 'png'); }
  const size = await gameFrameSize(await readFile(file));
  if (!size) throw new Error('Invalid screenshot image');
  return { ref, ...size, path: file };
}

/** Register locally-produced artifacts; supplied filesystem paths are never trusted. */
export async function registerGameVerifyResult(dir: string, input: unknown, runId?: string): Promise<GameVerifyResult> {
  const value = input as GameVerifyResult | undefined;
  if (!value || !['passed', 'failed', 'unavailable'].includes(value.status)
    || !Array.isArray(value.steps) || value.steps.length > 3 || !Array.isArray(value.screenshots) || value.screenshots.length > (value.playtest ? 24 : 3)
    || !Array.isArray(value.missingTools) || value.missingTools.some(id => typeof id !== 'string' || id.length > 100)) throw new Error('Invalid verification result');
  const result: GameVerifyResult = { status: value.status, steps: [], screenshots: [], missingTools: value.missingTools,
    ...(value.missingTools.length ? { missingToolGuidance: missingGameToolGuidance(value.missingTools) } : {}),
    ...(runId ? { runId } : {}) };
  for (const step of value.steps) {
    if (!['check', 'build', 'run'].includes(step.name) || !Array.isArray(step.argv) || step.argv.length > 100
      || step.argv.some(arg => typeof arg !== 'string' || arg.length > 32768)
      || (step.exitCode !== null && !Number.isInteger(step.exitCode)) || !Number.isFinite(step.durationMs) || step.durationMs < 0
      || typeof step.timedOut !== 'boolean' || (step.status && !['passed', 'failed', 'unavailable', 'skipped'].includes(step.status))) throw new Error('Invalid verification step');
    await gameVerifyArtifact(dir, step.logRef, 'log');
    result.steps.push({ name: step.name, argv: step.argv, exitCode: step.exitCode, durationMs: step.durationMs,
      logRef: step.logRef, timedOut: step.timedOut, ...(step.status ? { status: step.status } : {}),
      ...(step.status === 'unavailable' && step.reasonCode === 'SCREENSHOT_HOST_UNAVAILABLE' ? { reasonCode: step.reasonCode } : {}),
      ...(typeof step.message === 'string' ? { message: step.message.slice(0, 2000) } : {}) });
  }
  for (const shot of value.screenshots) result.screenshots.push(await gameVerifyImage(dir, shot.ref));
  if (value.playtest) {
    const overviewRef = value.playtest.overview?.ref;
    if (overviewRef !== undefined && (typeof overviewRef !== 'string' || value.screenshots.some(shot => shot.ref === overviewRef))) throw new Error('Invalid playtest overview');
    const overview = overviewRef === undefined ? undefined : await gameVerifyImage(dir, overviewRef);
    result.playtest = normalizeGamePlaytestReport(value.playtest, result.screenshots, overview);
    if (result.status === 'passed' && (!result.playtest.completed || !result.playtest.frames.length
      || result.playtest.pageErrors.length || result.playtest.console.some(message => message.level === 'error'))) throw new Error('Invalid passing playtest result');
  }
  await mkdir(dir, { recursive: true });
  // Keep every registration (including its runId) and a cheap toolbar read pointer.
  const record = randomUUID();
  await writeFile(path.join(dir, `${record}.json`), JSON.stringify(result));
  await writeFile(path.join(dir, value.playtest ? 'latest-playtest.json' : 'latest.json'), JSON.stringify(result));
  // Housekeeping must never cost the user a registered result.
  await pruneGameVerifyArtifacts(dir).catch(() => 0);
  return result;
}
