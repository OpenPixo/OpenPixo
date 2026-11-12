import { randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ASSET_OP_NAMES, type AssetOpItemResult, type AssetOpReport, type AssetOpRequest } from '@openpixo/contracts';
import { assetRelPath } from '../paths.js';
import { assetPath, choiceParam, hashFile, integerParam, OccupiedOutputError, occupied, publishFiles, writeNew } from './files.js';
import { ffmpegVersion, planAudioOp } from './audio.js';
import { image, planImageOp, type OpPlan } from './images.js';
import { planPack, type PackInput } from './pack.js';
import { planSpritesheet } from './export-spritesheet.js';
import { alignFrames, encodePng, measureFrame, readRgba, summarizeFrames, type FrameMeasure } from './frames.js';
import { outputStem } from './images.js';
import { detectEngineProfile } from '../../game/engine-detect.js';

export interface AssetOpContext {
  /** Absolute project root the inputs and outputs resolve against. */
  projectRoot: string;
}

/** Runs one bounded op over project files and returns the per-input report. Callers own provenance writes. */
export async function runAssetOp(ctx: AssetOpContext, request: AssetOpRequest): Promise<AssetOpReport> {
  if (!request || !ASSET_OP_NAMES.includes(request.op) || !Array.isArray(request.inputs) || request.inputs.length < 1 || request.inputs.length > 512
    || request.inputs.some(input => typeof input !== 'string')
    || (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)))
    || (request.dryRun !== undefined && typeof request.dryRun !== 'boolean')) throw new Error('Invalid asset operation request (1–512 inputs required)');
  const root = await realpath(ctx.projectRoot);
  const out = assetRelPath(request.out ?? `derived/${request.op}`);
  await assetPath(root, out);
  const reportPath = path.posix.join(`derived/${request.op}`, `report-${randomUUID()}.json`);
  await assetPath(root, reportPath);
  const params = request.params ?? {};
  const audio = request.op.startsWith('audio-');
  const report: AssetOpReport = { op: request.op, params, tool: audio ? 'ffmpeg (not run)' : `sharp ${sharp.versions.sharp}`, dryRun: request.dryRun === true,
    results: [], originalsPreserved: true, counts: { succeeded: 0, failed: 0, skipped: 0 } };
  const sources: { result: AssetOpItemResult; source: string; file: string }[] = [];
  // Hash every readable original before any operation, including skipped inputs.
  for (const source of request.inputs) {
    const result: AssetOpItemResult = { source, sourceSha256: null, output: null, status: 'failed' };
    report.results.push(result);
    try {
      const normalized = assetRelPath(source);
      const file = await assetPath(root, normalized);
      if (!(await stat(file)).isFile()) throw new Error('Input must be a regular file');
      result.sourceSha256 = await hashFile(file);
      sources.push({ result, source: normalized, file });
    } catch (error) { result.error = message(error); }
  }
  let toolError: unknown;
  if (audio && !report.dryRun) {
    try { report.tool = await ffmpegVersion(); }
    catch (error) { toolError = error; report.tool = 'ffmpeg (unavailable)'; }
  }
  const execute = async (plan: OpPlan, results: AssetOpItemResult[], parentHashes: string[]): Promise<void> => {
    try {
      for (const output of plan.outputs) {
        if (await occupied(await assetPath(root, output))) throw new OccupiedOutputError(output);
      }
      for (const result of results) {
        result.output = plan.outputs[0]!;
        result.extraOutputs = plan.outputs.slice(1);
        result.parentHashes = parentHashes;
        if (plan.detail) result.detail = plan.detail;
      }
      if (!report.dryRun) {
        if (toolError) throw toolError;
        const hashes = await publishFiles(root, plan.outputs, plan.produce);
        for (const result of results) {
          result.outputHashes = hashes;
          result.outputSha256 = hashes[plan.outputs[0]!]!;
          if (audio) result.exitCode = 0;
        }
      }
      for (const result of results) result.status = 'succeeded';
    } catch (error) {
      for (const result of results) {
        result.status = error instanceof OccupiedOutputError ? 'skipped' : 'failed';
        result.error = message(error);
        result.output = null;
        delete result.extraOutputs;
        const exitCode = (error as { exitCode?: number }).exitCode;
        if (typeof exitCode === 'number') result.exitCode = exitCode;
      }
    }
  };
  if (request.op === 'frames-check' || request.op === 'frames-align') {
    await runFramesOp(root, request.op, params, out, report, sources);
  } else if (request.op === 'pack' || request.op === 'export-spritesheet') {
    const inputs: PackInput[] = [];
    const results: AssetOpItemResult[] = [];
    const seen = new Set<string>();
    for (const { result, source, file } of sources) {
      try {
        if (seen.has(source)) { result.status = 'skipped'; result.error = 'Duplicate pack input'; continue; }
        seen.add(source);
        const meta = await image(file).metadata();
        if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error('Pack requires a single-frame image');
        inputs.push({ source, file, width: meta.width, height: meta.height }); results.push(result);
      } catch (error) { result.error = message(error); }
    }
    if (inputs.length) {
      try {
        if (request.op === 'export-spritesheet' && results.length !== request.inputs.length) throw new Error('Sprite export requires every requested frame exactly once');
        const plan = request.op === 'pack' ? planPack(inputs, params, out) : planSpritesheet(inputs, params, out,
          params.format === undefined || params.format === 'auto' ? detectEngineProfile(root, { resolveOnPath: () => null }).engine : undefined);
        await execute(plan, results, results.map(result => result.sourceSha256!));
      }
      catch (error) { for (const result of results) result.error = message(error); }
    }
  } else {
    for (const { result, source, file } of sources) {
      try {
        const plan = audio ? planAudioOp(source, file, request.op, params, out) : await planImageOp(root, source, file, request.op, params, out);
        await execute(plan, [result], [result.sourceSha256!]);
      } catch (error) { result.error = message(error); }
    }
  }
  for (const { result, source } of sources) {
    try {
      result.sourceSha256After = await hashFile(await assetPath(root, source));
      if (result.sourceSha256After !== result.sourceSha256) throw new Error('Original hash changed during processing');
    } catch (error) { report.originalsPreserved = false; result.status = 'failed'; result.error = `Preservation check failed: ${message(error)}`; }
  }
  for (const result of report.results) report.counts[result.status]++;
  if (!report.dryRun) {
    report.reportPath = reportPath;
    await publishFiles(root, [report.reportPath], async ([target]) => { await writeNew(target!, `${JSON.stringify(report, null, 2)}\n`); });
    // Read the committed report too: success must mean real, readable files.
    await readFile(await assetPath(root, report.reportPath));
  }
  return report;
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

function frameDetail(measure: FrameMeasure, frame: number): Record<string, unknown> {
  return { frame, width: measure.width, height: measure.height, empty: measure.empty, bounds: measure.bounds,
    bottomGap: measure.bottomGap, feetX: measure.feetX, touchesEdge: measure.touchesEdge };
}

function canvasParam(value: unknown): { width: number; height: number } | undefined {
  if (value === undefined) return undefined;
  const match = typeof value === 'string' ? /^(\d+)[xX](\d+)$/.exec(value) : null;
  const size = match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  if (!size || size.width < 1 || size.height < 1 || size.width > 8192 || size.height > 8192) throw new Error('canvas must have the form WxH, 1–8192 each');
  return size;
}

/**
 * Animation frames as one set, in input order. `frames-check` only measures and writes
 * nothing but the report. `frames-align` writes each frame on one shared canvas, feet
 * on one line at the bottom centre, with one scale for all (`alignFrames`).
 */
async function runFramesOp(root: string, op: 'frames-check' | 'frames-align', params: Record<string, unknown>, out: string,
  report: AssetOpReport, sources: { result: AssetOpItemResult; source: string; file: string }[]): Promise<void> {
  const loaded: { result: AssetOpItemResult; source: string; image: Awaited<ReturnType<typeof readRgba>> }[] = [];
  for (const { result, source, file } of sources) {
    try {
      const meta = await image(file).metadata();
      if ((meta.pages ?? 1) > 1) throw new Error('Animated images are not supported; pass one file per frame');
      loaded.push({ result, source, image: await readRgba(file) });
    } catch (error) { result.error = message(error); }
  }
  if (!loaded.length) return;
  if (loaded.length !== sources.length || sources.length !== report.results.length) {
    for (const { result } of loaded) result.error = 'Every frame must be readable, in order';
    return;
  }
  const measures = loaded.map(({ image: frame }) => measureFrame(frame));
  if (op === 'frames-check') {
    loaded.forEach(({ result }, index) => { result.status = 'succeeded'; result.detail = frameDetail(measures[index]!, index + 1); result.parentHashes = [result.sourceSha256!]; });
    report.summary = summarizeFrames(measures);
    return;
  }
  try {
    if (params.matchHeight !== undefined && typeof params.matchHeight !== 'boolean') throw new Error('matchHeight must be boolean');
    const filter = choiceParam(params, 'filter', ['nearest', 'lanczos'] as const, 'lanczos');
    const aligned = await alignFrames(loaded.map(({ image: frame }) => frame), {
      canvas: canvasParam(params.canvas), padding: integerParam(params, 'padding', 0, 0, 4096),
      matchHeight: params.matchHeight === true, pixelArt: filter === 'nearest',
    });
    const outputs = loaded.map(({ source }) => `${outputStem(out, source)}.png`);
    if (new Set(outputs).size !== outputs.length) throw new Error('Two frames would be written to the same file; give them different names');
    for (const output of outputs) if (await occupied(await assetPath(root, output))) throw new OccupiedOutputError(output);
    report.summary = summarizeFrames(aligned.frames.map(measureFrame));
    const encoded = await Promise.all(aligned.frames.map(encodePng));
    const hashes = report.dryRun ? {} : await publishFiles(root, outputs, async targets => {
      for (let i = 0; i < targets.length; i++) await writeNew(targets[i]!, encoded[i]!);
    });
    loaded.forEach(({ result }, index) => {
      result.output = outputs[index]!;
      if (!report.dryRun) { const hash = hashes[outputs[index]!]!; result.outputSha256 = hash; result.outputHashes = { [outputs[index]!]: hash }; }
      result.parentHashes = [result.sourceSha256!];
      result.detail = { ...frameDetail(measures[index]!, index + 1), canvas: aligned.canvas, scale: aligned.scale };
      result.status = 'succeeded';
    });
  } catch (error) {
    for (const { result } of loaded) { result.status = error instanceof OccupiedOutputError ? 'skipped' : 'failed'; result.error = message(error); result.output = null; }
  }
}
