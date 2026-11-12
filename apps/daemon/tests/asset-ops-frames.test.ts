import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAssetOp } from '../src/assets/ops/index.js';
import { alignFrames, blankRgba, measureFrame, readRgba, sheetCells, summarizeFrames, type Rgba } from '../src/assets/ops/frames.js';

/** A transparent frame with an opaque "character": a body box standing on its feet at `bottom`. */
function figure(width: number, height: number, box: { left: number; top: number; width: number; height: number }): Rgba {
  const frame = blankRgba(width, height);
  for (let y = box.top; y < box.top + box.height; y++) for (let x = box.left; x < box.left + box.width; x++) {
    const offset = (y * width + x) * 4;
    frame.data[offset] = 200; frame.data[offset + 1] = 40; frame.data[offset + 2] = 40; frame.data[offset + 3] = 255;
  }
  return frame;
}

const png = (frame: Rgba) => sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer();

describe('frame geometry', () => {
  it('measures the drawn box, the feet line and centre, and empty frames', () => {
    const measure = measureFrame(figure(64, 64, { left: 20, top: 10, width: 10, height: 40 }));
    expect(measure).toMatchObject({ empty: false, bounds: { left: 20, top: 10, width: 10, height: 40 }, bottomGap: 14, feetX: 25, touchesEdge: false });
    expect(measureFrame(blankRgba(32, 32))).toMatchObject({ empty: true, bounds: null });
    expect(measureFrame(figure(32, 32, { left: 0, top: 4, width: 8, height: 8 })).touchesEdge).toBe(true);
  });

  it('says in numbers and sentences when the feet bob, the character slides or a frame is empty', () => {
    const steady = [0, 1, 2].map(() => measureFrame(figure(64, 64, { left: 20, top: 10, width: 12, height: 50 })));
    expect(summarizeFrames(steady)).toMatchObject({ ok: true, issues: [], baselineSpreadPx: 0, feetXSpreadPx: 0, heightDriftPercent: 0 });
    const drifting = [
      figure(64, 64, { left: 20, top: 10, width: 12, height: 50 }),
      figure(64, 64, { left: 30, top: 2, width: 12, height: 50 }),
      figure(64, 64, { left: 20, top: 20, width: 12, height: 30 }),
      blankRgba(64, 64),
    ].map(measureFrame);
    const summary = summarizeFrames(drifting);
    expect(summary.ok).toBe(false);
    expect(summary.emptyFrames).toEqual([4]);
    expect(summary.baselineSpreadPx).toBe(10);
    expect(summary.feetXSpreadPx).toBe(10);
    expect(summary.heightDriftPercent).toBe(40);
    expect(summary.issues.join('\n')).toMatch(/Frame 4 is empty/);
    expect(summary.issues.join('\n')).toMatch(/feet move up and down by 10 px \(frame 1 lowest, frame 3 highest\)/);
    expect(summary.issues.join('\n')).toMatch(/slides sideways by 10 px/);
    expect(summary.issues.join('\n')).toMatch(/height changes by 40%/);
  });

  it('puts frames on one canvas with one scale, feet on the bottom line and on the centre', async () => {
    const frames = [
      figure(100, 100, { left: 10, top: 10, width: 20, height: 60 }),
      figure(100, 100, { left: 60, top: 30, width: 20, height: 60 }),
    ];
    const aligned = await alignFrames(frames, { canvas: { width: 40, height: 64 }, padding: 2 });
    expect(aligned.canvas).toEqual({ width: 40, height: 64 });
    expect(aligned.scale).toBe(1);
    const measures = aligned.frames.map(measureFrame);
    expect(measures.map((measure) => measure.bottomGap)).toEqual([2, 2]);
    expect(measures.map((measure) => measure.feetX)).toEqual([20, 20]);
    expect(summarizeFrames(measures).ok).toBe(true);
    // One scale for every frame: a crouch stays shorter than a stand.
    const crouch = await alignFrames([
      figure(100, 100, { left: 10, top: 0, width: 20, height: 100 }),
      figure(100, 100, { left: 10, top: 50, width: 20, height: 50 }),
    ], { canvas: { width: 20, height: 50 } });
    expect(crouch.scale).toBe(0.5);
    expect(crouch.frames.map((frame) => measureFrame(frame).bounds!.height)).toEqual([50, 25]);
    // match-height evens the drift out instead.
    const matched = await alignFrames([
      figure(100, 100, { left: 10, top: 0, width: 20, height: 100 }),
      figure(100, 100, { left: 10, top: 50, width: 20, height: 50 }),
    ], { canvas: { width: 40, height: 50 }, matchHeight: true });
    expect(matched.frames.map((frame) => measureFrame(frame).bounds!.height)).toEqual([50, 50]);
  });

  it('cuts an even grid whatever the render size', () => {
    expect(sheetCells(1536, 1024, 3, 2)).toEqual([
      { left: 0, top: 0, width: 512, height: 512 }, { left: 512, top: 0, width: 512, height: 512 }, { left: 1024, top: 0, width: 512, height: 512 },
      { left: 0, top: 512, width: 512, height: 512 }, { left: 512, top: 512, width: 512, height: 512 }, { left: 1024, top: 512, width: 512, height: 512 },
    ]);
    const odd = sheetCells(1000, 1000, 3, 3);
    expect(odd.reduce((sum, cell) => sum + (cell.top === 0 ? cell.width : 0), 0)).toBe(1000);
  });
});

describe('pixo asset frames check | align', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'asset-frames-'));
    await mkdir(path.join(root, 'hero'));
    await writeFile(path.join(root, 'hero/run-1.png'), await png(figure(64, 64, { left: 20, top: 10, width: 12, height: 50 })));
    await writeFile(path.join(root, 'hero/run-2.png'), await png(figure(64, 64, { left: 34, top: 2, width: 12, height: 50 })));
  });
  afterEach(async () => {
    if (!path.resolve(root).startsWith(path.join(tmpdir(), 'asset-frames-'))) throw new Error('Unsafe cleanup target');
    await rm(root, { recursive: true, force: true });
  });

  it('checks frames without writing images and reports per-frame numbers', async () => {
    const report = await runAssetOp({ projectRoot: root }, { op: 'frames-check', inputs: ['hero/run-1.png', 'hero/run-2.png'] });
    expect(report.counts).toEqual({ succeeded: 2, failed: 0, skipped: 0 });
    expect(report.results.map((result) => result.output)).toEqual([null, null]);
    expect(report.results[1]!.detail).toMatchObject({ frame: 2, bottomGap: 12, feetX: 40, empty: false });
    expect(report.summary).toMatchObject({ frames: 2, ok: false, baselineSpreadPx: 8, feetXSpreadPx: 14 });
    expect(report.originalsPreserved).toBe(true);
    // The written report carries the summary too, for a caller that reads the file.
    expect(JSON.parse(await readFile(path.join(root, report.reportPath!), 'utf8')).summary.frames).toBe(2);
  });

  it('aligns frames into new files and leaves the originals alone', async () => {
    const before = await readFile(path.join(root, 'hero/run-1.png'));
    const report = await runAssetOp({ projectRoot: root }, { op: 'frames-align', inputs: ['hero/run-1.png', 'hero/run-2.png'], out: 'aligned', params: { canvas: '14x52', padding: 1 } });
    expect(report.counts).toEqual({ succeeded: 2, failed: 0, skipped: 0 });
    expect(report.results.map((result) => result.output)).toEqual(['aligned/hero/run-1.png', 'aligned/hero/run-2.png']);
    expect(report.summary).toMatchObject({ ok: true, sameCanvas: true, baselineSpreadPx: 0, feetXSpreadPx: 0 });
    const aligned = await readRgba(path.join(root, 'aligned/hero/run-2.png'));
    expect(measureFrame(aligned)).toMatchObject({ width: 14, height: 52, bottomGap: 1, feetX: 7 });
    expect(await readFile(path.join(root, 'hero/run-1.png'))).toEqual(before);
    const again = await runAssetOp({ projectRoot: root }, { op: 'frames-align', inputs: ['hero/run-1.png', 'hero/run-2.png'], out: 'aligned' });
    expect(again.counts.skipped).toBe(2);
    await expect(runAssetOp({ projectRoot: root }, { op: 'frames-align', inputs: ['hero/run-1.png'], params: { canvas: 'big' } }))
      .resolves.toMatchObject({ counts: { failed: 1 } });
  });
});
