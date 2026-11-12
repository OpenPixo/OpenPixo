import { mkdtemp, readFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { hashAssetFile } from '../src/assets/paths.js';
import { getAssetThumbnail, getAssetWaveform } from '../src/assets/thumbnails.js';

it('caches a nearest-neighbour 256px WebP from a 16px PNG by content hash and size', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'asset-thumbnails-'));
  try {
    const source = path.join(dir, 'pixel.png');
    const pixels = Buffer.from(Array.from({ length: 16 * 16 * 3 }, (_, i) => Math.floor(i / 3) % 2 ? 255 : 0));
    await sharp(pixels, { raw: { width: 16, height: 16, channels: 3 } }).png().toFile(source);
    const input = { runtimeDataDir: dir, filePath: source, contentHash: await hashAssetFile(source), kind: 'image' as const, size: 256 as const };
    const thumbnail = await getAssetThumbnail(input);
    expect(thumbnail).toBe(path.join(dir, 'asset-thumbnails', `${input.contentHash}-256.webp`));
    const bytes = await readFile(thumbnail!);
    expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect([...new Set(await sharp(bytes).raw().toBuffer())].sort((a, b) => a - b)).toEqual([0, 255]);
    const past = new Date('2020-01-01T00:00:00Z');
    await utimes(thumbnail!, past, past);
    expect(await getAssetThumbnail(input)).toBe(thumbnail);
    expect((await stat(thumbnail!)).mtimeMs).toBe(past.getTime());
    expect(await getAssetThumbnail({ ...input, kind: 'model3d' })).toBeNull();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('decodes bundled FFmpeg waveform peaks at 50 points per second', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'asset-waveform-'));
  try {
    const wav = Buffer.alloc(44 + 8000 * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(16000, 40);
    const source = path.join(dir, 'silence.wav');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(source, wav);
    const result = await getAssetWaveform({ runtimeDataDir: dir, filePath: source, contentHash: await hashAssetFile(source) });
    expect(result).toEqual({ pointsPerSecond: 50, peaks: Array(50).fill(0), durationMs: 1000 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('thumbnails a 1px grayscale PNG (the e2e game fixture sprite)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'asset-thumbnails-'));
  try {
    const source = path.join(dir, 'sprite.png');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'));
    const thumbnail = await getAssetThumbnail({ runtimeDataDir: dir, filePath: source, contentHash: await hashAssetFile(source), kind: 'image', size: 256 });
    expect(await sharp(await readFile(thumbnail!)).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
