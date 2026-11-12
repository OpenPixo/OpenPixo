import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runAssetOp } from '../src/assets/ops/index.js';

let root: string;
const golden = path.join(import.meta.dirname, 'fixtures/spritesheet');
const read = (relative: string) => readFile(path.join(root, relative));
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'asset-spritesheet-'));
  await mkdir(path.join(root, 'frames'));
  for (const [name, color] of [['a', '#ff0000'], ['b', '#00ff00']]) {
    await writeFile(path.join(root, 'frames', `${name}.png`), await sharp({ create: { width: 2, height: 2, channels: 4, background: color! } }).png().toBuffer());
  }
});
afterEach(async () => {
  if (!path.resolve(root).startsWith(path.join(tmpdir(), 'asset-spritesheet-'))) throw new Error('Unsafe cleanup target');
  await rm(root, { recursive: true, force: true });
});

it.each(['godot', 'phaser', 'aseprite'] as const)('exports deterministic %s metadata with named directions, fps and unchanged frame pixels', async format => {
  const request = { op: 'export-spritesheet' as const, inputs: ['frames/a.png', 'frames/b.png'], out: 'exports',
    params: { format, columns: 1, animations: 'down,up', fps: 10, name: 'walk' } };
  const report = await runAssetOp({ projectRoot: root }, request);
  expect(report.counts).toEqual({ succeeded: 2, skipped: 0, failed: 0 });
  expect(report.originalsPreserved).toBe(true);
  const item = report.results[0]!;
  expect(item.parentHashes).toHaveLength(2);
  expect(item.detail).toMatchObject({ width: 2, height: 4, rows: 2, columns: 1, fps: 10, format, animations: ['down', 'up'], frameCount: 2 });
  const pixels = await sharp(await read(item.output!)).ensureAlpha().raw().toBuffer();
  expect([...pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  expect([...pixels.subarray(2 * 2 * 4, 2 * 2 * 4 + 4)]).toEqual([0, 255, 0, 255]);
  const descriptor = (await read(item.extraOutputs![0]!)).toString();
  await expect(descriptor).toMatchFileSnapshot(path.join(golden, `${format}.golden`));
  if (format !== 'godot') {
    const parsed = JSON.parse(descriptor);
    expect(Object.keys(parsed.frames)).toEqual(['down/0000', 'up/0000']);
    expect(parsed.frames['up/0000'].frame).toEqual({ x: 0, y: 2, w: 2, h: 2 });
    expect(parsed.meta.image).toBe('walk.png');
    if (format === 'aseprite') {
      expect(parsed.frames['up/0000'].duration).toBe(100);
      expect(parsed.meta.frameTags).toEqual([{ name: 'down', from: 0, to: 0, direction: 'forward' }, { name: 'up', from: 1, to: 1, direction: 'forward' }]);
    } else {
      const animations = (await read(item.extraOutputs![1]!)).toString();
      await expect(animations).toMatchFileSnapshot(path.join(golden, 'phaser-animations.golden'));
      expect(JSON.parse(animations).anims.map((animation: { key: string }) => animation.key)).toEqual(['walk-down', 'walk-up']);
    }
  } else expect(descriptor).toContain('path="res://exports/walk.png"');
  const copy = await runAssetOp({ projectRoot: root }, { ...request, out: 'copy' });
  expect(await read(copy.results[0]!.output!)).toEqual(await read(item.output!));
  const occupied = await runAssetOp({ projectRoot: root }, request);
  expect(occupied.counts).toEqual({ succeeded: 0, skipped: 2, failed: 0 });
});

it('detects Godot and Phaser from project files, defaults unknown engines to Aseprite, and lets explicit format win', async () => {
  const request = { op: 'export-spritesheet' as const, inputs: ['frames/a.png'], dryRun: true };
  expect((await runAssetOp({ projectRoot: root }, request)).results[0]!.detail!.format).toBe('aseprite');
  await writeFile(path.join(root, 'project.godot'), 'config_version=5\n');
  const godot = await runAssetOp({ projectRoot: root }, request);
  expect(godot.results[0]!.detail!.format).toBe('godot');
  await expect(read(godot.results[0]!.output!)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await runAssetOp({ projectRoot: root }, { ...request, params: { format: 'phaser' } })).results[0]!.detail!.format).toBe('phaser');
  await rm(path.join(root, 'project.godot'));
  await writeFile(path.join(root, 'package.json'), '{"dependencies":{"phaser":"^3.90.0"}}');
  expect((await runAssetOp({ projectRoot: root }, request)).results[0]!.detail!.format).toBe('phaser');
});

it('rejects missing, duplicate, unequal or incomplete frame rows without silently shifting animations', async () => {
  const request = { op: 'export-spritesheet' as const, inputs: ['frames/a.png', 'missing.png'], out: 'bad' };
  expect((await runAssetOp({ projectRoot: root }, request)).counts.failed).toBe(2);
  expect((await runAssetOp({ projectRoot: root }, { ...request, inputs: ['frames/a.png', 'frames/a.png'] })).counts.failed).toBeGreaterThan(0);
  expect((await runAssetOp({ projectRoot: root }, { ...request, inputs: ['frames/a.png'], params: { columns: 2 } })).counts.failed).toBe(1);
  await writeFile(path.join(root, 'frames/b.png'), await sharp({ create: { width: 3, height: 2, channels: 4, background: 'red' } }).png().toBuffer());
  expect((await runAssetOp({ projectRoot: root }, { ...request, inputs: ['frames/a.png', 'frames/b.png'] })).counts.failed).toBe(2);
  await expect(read('bad/spritesheet.png')).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([4, 6, 8])('slices only the first %i square cells in each direction without moving row boundaries', async frameColumns => {
  const colors = Buffer.from(Array.from({ length: 64 }, (_, i) => [i % 8 * 32, Math.floor(i / 8) * 32, 0, 255]).flat());
  await writeFile(path.join(root, 'grid.png'), await sharp(colors, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer());
  const sliced = await runAssetOp({ projectRoot: root }, { op: 'slice', inputs: ['grid.png'], params: { grid: '8x8', frameColumns } });
  const frames = sliced.results[0]!.extraOutputs!;
  expect(frames).toHaveLength(frameColumns * 8);
  for (const [index, frame] of frames.entries()) {
    const { data, info } = await sharp(await read(frame)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1, 1]);
    expect([...data]).toEqual([index % frameColumns * 32, Math.floor(index / frameColumns) * 32, 0, 255]);
  }
});

it('preserves one-shot playback in Aseprite frame tags', async () => {
  const report = await runAssetOp({ projectRoot: root }, { op: 'export-spritesheet', inputs: ['frames/a.png', 'frames/b.png'],
    params: { format: 'aseprite', columns: 2, animations: ['effect'], fps: 12, loop: false } });
  expect(report.counts.failed).toBe(0);
  const descriptor = JSON.parse((await read(report.results[0]!.extraOutputs![0]!)).toString());
  expect(descriptor.meta.frameTags).toEqual([{ name: 'effect', from: 0, to: 1, direction: 'forward', repeat: '1' }]);
});
