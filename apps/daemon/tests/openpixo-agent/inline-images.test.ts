import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  DROPPED_IMAGE_TEXT, fitInlineImages, MAX_IMAGE_BYTES, MAX_IMAGE_EDGE, MAX_KEPT_IMAGES,
} from '../../src/openpixo-agent/inline-images.js';

/** A busy picture that compresses badly: the worst case for size. */
async function noisyPng(width: number, height: number, sigma = 60): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#203040', noise: { type: 'gaussian', mean: 128, sigma } } })
    .png().toBuffer();
}

/** Flat colour blocks with hard edges, like pixel art and UI: compresses well as PNG. */
async function gameScreen(width: number, height: number): Promise<Buffer> {
  const tile = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#4a7a5a' } })
    .composite([{ input: { create: { width: 32, height: 32, channels: 3, background: '#d8c090' } }, left: 0, top: 0 }]).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#182230' } })
    .composite([{ input: tile, tile: true, left: 0, top: 0 }]).png().toBuffer();
}

const dataUrl = (buffer: Buffer, mime = 'image/png') => `data:${mime};base64,${buffer.toString('base64')}`;

/** The request the bundled OpenCode sends after the agent reads image files. */
function request(urls: string[], conversation = 'You are a game agent.') {
  return {
    model: 'openpixo-agent-flash', stream: true,
    messages: [
      { role: 'system', content: conversation },
      ...urls.map((url) => ({ role: 'user', content: [
        { type: 'text', text: 'Attached media from tool result:' },
        { type: 'image_url', image_url: { url } },
      ] })),
    ],
  };
}

const pictures = (body: Buffer) => (JSON.parse(body.toString('utf8')).messages as Array<{ content: unknown }>)
  .flatMap((message) => Array.isArray(message.content) ? message.content as Array<Record<string, any>> : [])
  .filter((part) => part.type === 'image_url' || part.text === DROPPED_IMAGE_TEXT);

async function size(url: string) {
  const meta = await sharp(Buffer.from(url.split(',')[1]!, 'base64')).metadata();
  return [meta.width, meta.height, meta.format];
}

describe('pictures sent to a hosted model', () => {
  it('leaves a request without pictures exactly as it came', async () => {
    const body = Buffer.from(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'Make the slime jump higher.' }] }));
    expect(await fitInlineImages(body)).toBe(body);
  });

  it('sends a full-HD game screen byte for byte, as Codex does with a picture that fits', async () => {
    const body = Buffer.from(JSON.stringify(request([dataUrl(await gameScreen(1920, 1080))])));
    expect(await fitInlineImages(body)).toBe(body);
  });

  it('scales an oversized screen down in its own format, so pixel edges stay sharp', async () => {
    const screen = await gameScreen(3840, 2160);
    const fitted = await fitInlineImages(Buffer.from(JSON.stringify(request([dataUrl(screen)]))));
    expect(await size(pictures(fitted)[0]!.image_url.url)).toEqual([MAX_IMAGE_EDGE, 1152, 'png']);
  });

  it('turns a picture into JPEG only when it cannot fit any other way', async () => {
    const screen = await noisyPng(2560, 1440);
    expect(dataUrl(screen).length).toBeGreaterThan(4_000_000);
    const fitted = await fitInlineImages(Buffer.from(JSON.stringify(request([dataUrl(screen)]))));
    expect(await size(pictures(fitted)[0]!.image_url.url)).toEqual([1280, 720, 'jpeg']);
    expect(fitted.length).toBeLessThan(4_000_000);
  });

  it('keeps only the newest pictures, and says where one was left out', async () => {
    const urls = await Promise.all(Array.from({ length: MAX_KEPT_IMAGES + 2 }, async (_, index) =>
      dataUrl(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: index * 30, g: 10, b: 10 } } }).png().toBuffer())));
    const parts = pictures(await fitInlineImages(Buffer.from(JSON.stringify(request(urls)))));
    expect(parts.map((part) => part.type)).toEqual(['text', 'text', 'image_url', 'image_url', 'image_url', 'image_url']);
    expect(parts[0]).toEqual({ type: 'text', text: DROPPED_IMAGE_TEXT });
    expect(parts.slice(2).map((part) => part.image_url.url)).toEqual(urls.slice(2));
  });

  it('keeps the pictures together under the byte budget, newest first', async () => {
    const urls = await Promise.all([1, 2, 3, 4].map(async (seed) => dataUrl(await noisyPng(1280, 720, 70 + seed))));
    const fitted = await fitInlineImages(Buffer.from(JSON.stringify(request(urls))));
    const kept = pictures(fitted).filter((part) => part.type === 'image_url');
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.reduce((total, part) => total + (part.image_url.url as string).length, 0)).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(pictures(fitted).at(-1)!.type).toBe('image_url');
  });

  it('leaves out pictures a long conversation has no room for, so the request still goes', async () => {
    const screen = dataUrl(await gameScreen(1920, 1080));
    const conversation = 'x'.repeat(3_950_000 - screen.length);
    const fitted = await fitInlineImages(Buffer.from(JSON.stringify(request([screen], conversation))), new Map(), 4_000_000);
    expect(pictures(fitted)).toEqual([{ type: 'text', text: DROPPED_IMAGE_TEXT }]);
    expect(fitted.length).toBeLessThan(4_000_000);
  });

  it('fits the same picture to the same bytes every time, so the prompt cache still applies', async () => {
    const body = Buffer.from(JSON.stringify(request([dataUrl(await noisyPng(2560, 1440))])));
    const first = await fitInlineImages(body, new Map());
    const second = await fitInlineImages(body, new Map());
    expect(first.equals(second)).toBe(true);
  });
});
