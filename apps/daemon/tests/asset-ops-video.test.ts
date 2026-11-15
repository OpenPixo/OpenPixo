import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runAssetOp } from '../src/assets/ops/index.js';
import { runFfmpeg } from '../src/assets/ops/audio.js';
import { evenFrameIndices, splitPngStream } from '../src/assets/ops/video.js';
import { screenKey } from '../src/assets/ops/images.js';

// A clip shaped like a walk clip: a 4x2 grid of 32x32 cells on green, one coloured block per
// cell whose height follows the frame, 12 frames at 24 fps, the last a copy of the first.
const COLORS: Array<[number, number, number]> = [[255, 0, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0], [255, 128, 0], [128, 0, 255], [0, 128, 255], [255, 0, 128]];
const FRAMES = 12;

async function gridFrame(frame: number): Promise<Buffer> {
  const step = frame === FRAMES - 1 ? 0 : frame;
  const blocks = await Promise.all(COLORS.map(async ([r, g, b], cell) => ({
    input: await sharp({ create: { width: 16, height: 16, channels: 3, background: { r, g, b } } }).png().toBuffer(),
    left: (cell % 4) * 32 + 8, top: Math.floor(cell / 4) * 32 + 4 + (step % 4) * 2,
  })));
  return sharp({ create: { width: 128, height: 64, channels: 3, background: { r: 0, g: 255, b: 0 } } }).composite(blocks).png().toBuffer();
}

let projectRoot: string;
beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), 'asset-ops-video-'));
  const frames = path.join(projectRoot, 'src-frames');
  await mkdir(frames); await mkdir(path.join(projectRoot, 'clips'));
  for (let frame = 0; frame < FRAMES; frame++) await writeFile(path.join(frames, `${String(frame).padStart(2, '0')}.png`), await gridFrame(frame));
  // Lossless 4:4:4 so the test reads the colours it drew.
  await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-framerate', '24', '-i', path.join(frames, '%02d.png'),
    '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', path.join(projectRoot, 'clips/walk.mp4')]);
});
afterEach(async () => {
  if (!projectRoot.startsWith(path.join(tmpdir(), 'asset-ops-video-'))) throw new Error('Unsafe cleanup target');
  await rm(projectRoot, { recursive: true, force: true });
});

it('cuts a video into PNG frames in time order and drops a last frame that repeats the first', async () => {
  const report = await runAssetOp({ projectRoot }, { op: 'video-frames', inputs: ['clips/walk.mp4'], params: { dropRepeatedEnd: true } });
  expect(report.counts).toEqual({ succeeded: 1, failed: 0, skipped: 0 });
  expect(report.tool).toMatch(/^ffmpeg version/);
  const item = report.results[0]!;
  expect(item.output).toBe('derived/video-frames/clips/walk.json');
  expect(item.extraOutputs).toHaveLength(FRAMES - 1);
  expect(item.extraOutputs![0]).toBe('derived/video-frames/clips/walk/frame-0000.png');
  expect(item.detail).toMatchObject({ decoded: FRAMES, droppedRepeatedEnd: true, frameCount: FRAMES - 1, width: 128, height: 64 });
  const first = await sharp(path.join(projectRoot, item.extraOutputs![0]!)).metadata();
  expect([first.width, first.height]).toEqual([128, 64]);
  expect(report.originalsPreserved).toBe(true);

  const kept = await runAssetOp({ projectRoot }, { op: 'video-frames', inputs: ['clips/walk.mp4'], out: 'derived/some', params: { count: 4 } });
  expect(kept.results[0]!.detail).toMatchObject({ decoded: FRAMES, droppedRepeatedEnd: false, frameCount: 4, sourceFrames: [0, 3, 6, 9] });

  const refused = await runAssetOp({ projectRoot }, { op: 'video-frames', inputs: ['src-frames/00.png'] });
  expect(refused.results[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('video input container') });
});

it('turns grid frames into one animation per cell: key, slice, export by cell', async () => {
  const frames = await runAssetOp({ projectRoot }, { op: 'video-frames', inputs: ['clips/walk.mp4'], params: { dropRepeatedEnd: true } });
  const pictures = frames.results[0]!.extraOutputs!;
  const keyed = await runAssetOp({ projectRoot }, { op: 'remove-bg', inputs: pictures, params: { mode: 'chroma', color: '00ff00', tolerance: 100, softness: 80, despill: true } });
  expect(keyed.counts.failed).toBe(0);
  const keyedFiles = keyed.results.map(result => result.output!);
  const corner = await sharp(path.join(projectRoot, keyedFiles[0]!)).ensureAlpha().raw().toBuffer();
  expect(corner[3]).toBe(0);
  const sliced = await runAssetOp({ projectRoot }, { op: 'slice', inputs: keyedFiles, params: { grid: '4x2' } });
  const cells = sliced.results.flatMap(result => result.extraOutputs!);
  expect(cells).toHaveLength(8 * (FRAMES - 1));
  const names = ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left'];
  const sheet = await runAssetOp({ projectRoot }, { op: 'export-spritesheet', inputs: cells,
    params: { format: 'aseprite', name: 'walk', animations: names, order: 'by-cell', loopSeconds: (FRAMES - 1) / 24 } });
  expect(sheet.counts.failed).toBe(0);
  expect(sheet.results[0]!.detail).toMatchObject({ columns: FRAMES - 1, rows: 8, fps: 24, animations: names, frameCount: 8 * (FRAMES - 1) });
  const layoutFile = sheet.results[0]!.extraOutputs!.find(file => file.endsWith('walk.sheet.json'))!;
  expect(JSON.parse(await readFile(path.join(projectRoot, layoutFile), 'utf8'))).toEqual({
    image: 'walk.png', cell: { width: 32, height: 32 }, columns: FRAMES - 1, rows: 8, fps: 24, loop: true, animations: names });
  // Every frame of row N is cell N of the grid: the block keeps that cell's colour along the row.
  const atlas = sharp(path.join(projectRoot, sheet.results[0]!.output!));
  const { data, info } = await atlas.raw().toBuffer({ resolveWithObject: true });
  for (let row = 0; row < 8; row++) for (const column of [0, 5, FRAMES - 2]) {
    const x = column * 32 + 16, y = row * 32 + 14;
    const offset = (y * info.width + x) * info.channels;
    const [r, g, b] = COLORS[row]!;
    expect(Math.abs(data[offset]! - r) + Math.abs(data[offset + 1]! - g) + Math.abs(data[offset + 2]! - b)).toBeLessThan(30);
    expect(data[offset + 3]).toBe(255);
  }
});

it('keys a screen colour with a soft edge and takes the tint off that edge', () => {
  const key = screenKey([0, 255, 0], 100, 80, true);
  const pixels = Buffer.from([0, 250, 10, 255, /* screen */ 40, 80, 50, 255, /* dark green cloth */ 60, 200, 40, 255 /* blended edge */]);
  key(pixels);
  expect(pixels[3]).toBe(0);
  expect([...pixels.subarray(4, 8)]).toEqual([40, 80, 50, 255]);
  expect(pixels[11]).toBe(Math.round(255 * 15 / 80));
  expect(pixels[9]).toBe(60);
  expect(() => screenKey([200, 180, 160], 0, 10, false)).toThrow(/one strong channel/);
});

it('splits a PNG stream and spaces kept frames evenly', async () => {
  const one = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f00' } }).png().toBuffer();
  const two = await sharp({ create: { width: 3, height: 1, channels: 3, background: '#00f' } }).png().toBuffer();
  expect(splitPngStream(Buffer.concat([one, two])).map(frame => frame.length)).toEqual([one.length, two.length]);
  expect(() => splitPngStream(Buffer.from('not a png'))).toThrow(/PNG/);
  expect(evenFrameIndices(21, 7)).toEqual([0, 3, 6, 9, 12, 15, 18]);
  expect(evenFrameIndices(5, 8)).toEqual([0, 1, 2, 3, 4]);
});
