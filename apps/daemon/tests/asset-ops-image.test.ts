import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAssetOp } from '../src/assets/ops/index.js';
import { OccupiedOutputError, publishFiles, writeNew } from '../src/assets/ops/files.js';

let workspace: string, projectRoot: string;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const png = (width: number, height: number, color = '#ff0000') => sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
const read = (relative: string) => readFile(path.join(projectRoot, relative));

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'asset-ops-image-'));
  projectRoot = path.join(workspace, 'game');
  await mkdir(path.join(projectRoot, 'sprites'), { recursive: true });
});
afterEach(async () => {
  if (!workspace.startsWith(path.join(tmpdir(), 'asset-ops-image-'))) throw new Error('Unsafe cleanup target');
  await rm(workspace, { recursive: true, force: true });
});

describe('asset image operations', () => {
  it.each([1, 2, 4])('applies a %i-color cap to actual PNG pixels while preserving alpha', async colors => {
    const rgba = Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, 255 - i * 17, i * 11, i === 14 ? 0 : 255]).flat());
    await writeFile(path.join(projectRoot, 'sprites/colors.png'), await sharp(rgba, { raw: { width: 5, height: 3, channels: 4 } }).png().toBuffer());
    const report = await runAssetOp({ projectRoot }, { op: 'palette', inputs: ['sprites/colors.png'], params: { colors, apply: true } });
    expect(report.counts.failed).toBe(0);
    const output = await sharp(await read(report.results[0]!.output!)).ensureAlpha().raw().toBuffer();
    const visible = new Set<string>();
    for (let i = 0; i < output.length; i += 4) {
      expect(output[i + 3]).toBe(rgba[i + 3]);
      if (output[i + 3]) visible.add([...output.subarray(i, i + 3)].join(','));
    }
    expect(visible.size).toBeGreaterThan(0);
    expect(visible.size).toBeLessThanOrEqual(colors);
    expect(report.results[0]!.extraOutputs).toHaveLength(2);
  });
  it('resizes with nearest pixels, preserves original hashes and skips occupied outputs', async () => {
    const source = await sharp(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    await writeFile(path.join(projectRoot, 'sprites/tiny.png'), source);
    const request = { op: 'resize' as const, inputs: ['sprites/tiny.png'], params: { scale: 2, filter: 'nearest' } };
    const report = await runAssetOp({ projectRoot }, request);
    expect(report.counts).toEqual({ succeeded: 1, skipped: 0, failed: 0 });
    const output = await read(report.results[0]!.output!);
    const decoded = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([decoded.info.width, decoded.info.height]).toEqual([4, 2]);
    expect([...decoded.data.subarray(0, 16)]).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
    expect(report.originalsPreserved).toBe(true);
    expect(report.results[0]!.sourceSha256).toBe(hash(source));
    expect(report.results[0]!.sourceSha256After).toBe(hash(source));
    expect(JSON.parse((await read(report.reportPath!)).toString())).toEqual(report);
    const again = await runAssetOp({ projectRoot }, request);
    expect(again.counts).toEqual({ succeeded: 0, skipped: 1, failed: 0 });
    expect(await read(report.results[0]!.output!)).toEqual(output);
    expect(await read('sprites/tiny.png')).toEqual(source);
    expect(again.reportPath).not.toBe(report.reportPath);
  });

  it('slices a declared grid into N frames and a manifest', async () => {
    await writeFile(path.join(projectRoot, 'sprites/walk.png'), await png(6, 4));
    const report = await runAssetOp({ projectRoot }, { op: 'slice', inputs: ['sprites/walk.png'], params: { grid: '3x2' } });
    expect(report.counts.failed).toBe(0);
    const item = report.results[0]!;
    const manifest = JSON.parse((await read(item.output!)).toString());
    expect(manifest.frames).toHaveLength(6);
    expect(item.extraOutputs).toHaveLength(6);
    for (const frame of item.extraOutputs!) {
      const meta = await sharp(await read(frame)).metadata();
      expect([meta.width, meta.height]).toEqual([2, 2]);
    }
    const dry = await runAssetOp({ projectRoot }, { op: 'slice', inputs: ['sprites/walk.png'], out: 'planned', params: { cell: '2x2' }, dryRun: true });
    expect(dry.results[0]!.extraOutputs).toHaveLength(6);
    expect(dry.reportPath).toBeUndefined();
    await expect(read(dry.results[0]!.output!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(projectRoot)).not.toContain('planned');
  });

  it('never replaces a destination created while the transform runs and cleans its temporary file', async () => {
    const destination = 'derived/raced.png';
    await expect(publishFiles(projectRoot, [destination], async ([temporary]) => {
      await writeNew(temporary!, 'new bytes');
      await writeFile(path.join(projectRoot, destination), 'other writer');
    })).rejects.toBeInstanceOf(OccupiedOutputError);
    expect((await read(destination)).toString()).toBe('other writer');
    expect(await readdir(path.join(projectRoot, 'derived'))).toEqual(['raced.png']);
  });

  it.each(['texturepacker-json', 'godot-tres'])('packs non-overlapping frames with a standard %s descriptor', async format => {
    await writeFile(path.join(projectRoot, 'sprites/a.png'), await png(3, 2));
    await writeFile(path.join(projectRoot, 'sprites/b.png'), await png(2, 3, '#00ff00'));
    const report = await runAssetOp({ projectRoot }, { op: 'pack', inputs: ['sprites/a.png', 'sprites/b.png'], params: { maxSize: 16, padding: 1, format } });
    expect(report.counts).toEqual({ succeeded: 2, skipped: 0, failed: 0 });
    const item = report.results[0]!, descriptor = (await read(item.extraOutputs![0]!)).toString();
    const atlas = await sharp(await read(item.output!)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const frames = item.detail!.frames as Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
    const a = frames['sprites/a.png']!.frame, b = frames['sprites/b.png']!.frame;
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    expect([...atlas.data.subarray((a.y * atlas.info.width + a.x) * 4, (a.y * atlas.info.width + a.x) * 4 + 4)]).toEqual([255, 0, 0, 255]);
    expect(item.parentHashes).toHaveLength(2);
    if (format === 'texturepacker-json') {
      const parsed = JSON.parse(descriptor);
      expect(parsed.meta.image).toBe(path.posix.basename(item.output!));
      expect(Object.keys(parsed.frames)).toEqual(['sprites/a.png', 'sprites/b.png']);
    } else {
      expect(descriptor).toContain('[gd_resource type="SpriteFrames" load_steps=4 format=3]');
      expect(descriptor).toContain(`[ext_resource type="Texture2D" path="${path.posix.basename(item.output!)}" id="1_atlas"]`);
      expect(descriptor.match(/\[sub_resource type="AtlasTexture"/g)).toHaveLength(2);
      expect(descriptor.match(/atlas = ExtResource\("1_atlas"\)/g)).toHaveLength(2);
      expect(descriptor.match(/"texture": SubResource\("AtlasTexture_\d"\)/g)).toHaveLength(2);
      expect(descriptor).toContain('[resource]\nanimations = [{');
    }
  });

  it('removes a chroma color to alpha and explicitly rejects deferred model mode', async () => {
    const bytes = Buffer.from([0, 255, 0, 255, 255, 0, 0, 255]);
    await writeFile(path.join(projectRoot, 'sprites/key.png'), await sharp(bytes, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer());
    const report = await runAssetOp({ projectRoot }, { op: 'remove-bg', inputs: ['sprites/key.png'], params: { mode: 'chroma', color: '#00ff00', tolerance: 0 } });
    const output = await sharp(await read(report.results[0]!.output!)).ensureAlpha().raw().toBuffer();
    expect([output[3], output[7]]).toEqual([0, 255]);
    const model = await runAssetOp({ projectRoot }, { op: 'remove-bg', inputs: ['sprites/key.png'], params: { mode: 'model' } });
    expect(model.results[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('not supported yet') });
  });

  it('rejects traversal, absolute paths and symlink escapes while continuing valid inputs', async () => {
    await writeFile(path.join(projectRoot, 'sprites/good.png'), await png(2, 2));
    await writeFile(path.join(projectRoot, 'sprites/bad.png'), 'not an image');
    const outside = path.join(workspace, 'outside');
    await mkdir(outside); await writeFile(path.join(outside, 'secret.png'), await png(1, 1));
    await symlink(outside, path.join(projectRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const report = await runAssetOp({ projectRoot }, { op: 'resize', inputs: ['../outside/secret.png', path.join(outside, 'secret.png'), 'escape/secret.png', 'sprites/bad.png', 'sprites/good.png'], params: { width: 4 } });
    expect(report.counts).toEqual({ succeeded: 1, skipped: 0, failed: 4 });
    expect(report.results.at(-1)!.output).toBe('derived/resize/sprites/good.png');
    expect(report.originalsPreserved).toBe(true);
    const escaped = await runAssetOp({ projectRoot }, { op: 'resize', inputs: ['sprites/good.png'], out: 'escape/new', params: { width: 4 } }).catch(error => error as Error);
    expect(escaped).toBeInstanceOf(Error);
    expect(await readdir(outside)).toEqual(['secret.png']);
  });

  it('trims transparency, pixelates, exports palettes and scores a seamless tile', async () => {
    const padded = await sharp(await png(2, 2)).extend({ top: 1, left: 1, right: 1, bottom: 1, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    await writeFile(path.join(projectRoot, 'sprites/padded.png'), padded);
    const trimmed = await runAssetOp({ projectRoot }, { op: 'trim', inputs: ['sprites/padded.png'], params: { padding: 0 } });
    expect((await sharp(await read(trimmed.results[0]!.output!)).metadata()).width).toBe(2);
    const palette = await runAssetOp({ projectRoot }, { op: 'palette', inputs: ['sprites/padded.png'], params: { colors: 2 } });
    expect((await read(palette.results[0]!.output!)).toString()).toMatch(/^GIMP Palette/);
    const hexFile = palette.results[0]!.extraOutputs![0]!;
    const pixelated = await runAssetOp({ projectRoot }, { op: 'pixelate', inputs: ['sprites/padded.png'], params: { size: 2, palette: hexFile, dither: 'ordered' } });
    expect(pixelated.counts.failed).toBe(0);
    await writeFile(path.join(projectRoot, 'sprites/tile.png'), await png(2, 2));
    const checked = await runAssetOp({ projectRoot }, { op: 'seamless-check', inputs: ['sprites/tile.png'] });
    expect(checked.results[0]!.detail!.score).toBe(1);
    const preview = await sharp(await read(checked.results[0]!.extraOutputs![0]!)).metadata();
    expect([preview.width, preview.height]).toEqual([4, 4]);
  });
});
