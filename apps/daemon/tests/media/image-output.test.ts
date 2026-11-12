import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  keyColorForPrompt,
  keyedBackgroundInstruction,
  planImageOutput,
  shapeImageOutput,
} from '../../src/media/image-output.js';

/** A flat backdrop with an opaque square in the middle, like a keyable provider render. */
async function subjectOn(background: [number, number, number], size = 256, subject: [number, number, number] = [30, 160, 60]) {
  const inner = Math.round(size / 2);
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: background[0], g: background[1], b: background[2] } } })
    .composite([{ input: await sharp({ create: { width: inner, height: inner, channels: 3, background: { r: subject[0], g: subject[1], b: subject[2] } } }).png().toBuffer(),
      left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2) }])
    .removeAlpha().png().toBuffer();
}

async function pixel(bytes: Buffer, x: number, y: number) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * 4;
  return { rgba: [...data.subarray(offset, offset + 4)], width: info.width, height: info.height };
}

describe('image output shaping', () => {
  it('passes bytes through untouched when nothing is requested, but reports the size', async () => {
    const bytes = await subjectOn([255, 255, 255], 96);
    const shaped = await shapeImageOutput(bytes, planImageOutput({}));
    expect(shaped.bytes).toBe(bytes);
    expect(shaped).toMatchObject({ ext: undefined, width: 96, height: 96, transparent: false, alpha: 'none' });
  });

  it('keys out a flat magenta backdrop and fits the subject into a small icon', async () => {
    const shaped = await shapeImageOutput(await subjectOn([255, 0, 255]), planImageOutput({ width: 64, height: 64, background: 'transparent' }));
    expect(shaped).toMatchObject({ ext: '.png', width: 64, height: 64, transparent: true, alpha: 'keyed', warnings: [] });
    const meta = await sharp(shaped.bytes).metadata();
    expect(meta).toMatchObject({ width: 64, height: 64, hasAlpha: true, format: 'png' });
    // The subject was trimmed and fills the icon; nothing magenta survives.
    expect((await pixel(shaped.bytes, 32, 32)).rgba).toEqual([30, 160, 60, 255]);
    const { data } = await sharp(shaped.bytes).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 0) expect(data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255).toBe(false);
    }
  });

  it('removes only the backdrop connected to the border', async () => {
    // A magenta "eye" inside the subject must not become a hole.
    const base = await subjectOn([255, 0, 255], 200);
    const withEye = await sharp(base).composite([{ input: await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 255 } } }).png().toBuffer(), left: 95, top: 95 }]).png().toBuffer();
    const shaped = await shapeImageOutput(withEye, planImageOutput({ background: 'transparent' }));
    expect(shaped).toMatchObject({ width: 200, height: 200, alpha: 'keyed' });
    expect((await pixel(shaped.bytes, 2, 2)).rgba[3]).toBe(0);
    expect((await pixel(shaped.bytes, 100, 100)).rgba).toEqual([255, 0, 255, 255]);
  });

  it('keeps native provider alpha instead of keying it again', async () => {
    const native = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer(), left: 32, top: 32 }])
      .png().toBuffer();
    const shaped = await shapeImageOutput(native, planImageOutput({ background: 'transparent' }));
    expect(shaped.alpha).toBe('native');
    expect((await pixel(shaped.bytes, 64, 64)).rgba).toEqual([200, 40, 40, 255]);
  });

  it('keys out a flat backdrop the provider chose itself and warns on a busy one', async () => {
    const white = await shapeImageOutput(await subjectOn([250, 250, 250]), planImageOutput({ background: 'transparent' }));
    expect((await pixel(white.bytes, 1, 1)).rgba[3]).toBe(0);
    const noisy = await sharp(Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 97) % 256)), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
    const shaped = await shapeImageOutput(noisy, planImageOutput({ background: 'transparent' }));
    expect(shaped.warnings[0]).toContain('not one flat color');
  });

  it('crops an opaque render to the exact requested size', async () => {
    const render = await subjectOn([20, 40, 90], 300);
    const shaped = await shapeImageOutput(render, planImageOutput({ width: 1536, height: 864 }));
    expect(shaped).toMatchObject({ width: 1536, height: 864, transparent: false });
    expect((await sharp(shaped.bytes).metadata()).hasAlpha).toBe(false);
    expect((await pixel(shaped.bytes, 0, 0)).rgba).toEqual([20, 40, 90, 255]);
  });

  it('clamps oversized requests and resamples pixel art with nearest neighbour', async () => {
    const oversized = await shapeImageOutput(await subjectOn([0, 0, 0], 64), planImageOutput({ width: 4000, height: 4000 }));
    expect(oversized).toMatchObject({ width: 1536, height: 1536 });
    expect(oversized.warnings[0]).toContain('clamped');
    const checker = await sharp(Buffer.from([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0]), { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
    const pixelArt = await shapeImageOutput(checker, planImageOutput({ width: 16, height: 16, pixelArt: true }));
    const { data } = await sharp(pixelArt.bytes).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) expect([0, 255]).toContain(data[i]);
  });

  it('asks for a keyable backdrop the subject is unlikely to contain', () => {
    expect(keyColorForPrompt('a blue slime')).toEqual([255, 0, 255]);
    expect(keyColorForPrompt('a pink bunny')).toEqual([0, 255, 0]);
    expect(keyColorForPrompt('紫色的史莱姆')).toEqual([0, 255, 0]);
    expect(keyedBackgroundInstruction([255, 0, 255])).toContain('#FF00FF');
    expect(keyedBackgroundInstruction([255, 0, 255])).toContain('No checkerboard');
  });
});
