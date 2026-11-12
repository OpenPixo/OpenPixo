import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { codexImageInstruction } from '../../src/media/codex-image.js';
import { generateMedia } from '../../src/media/index.js';

// Every image provider renders at its own size; the daemon delivers the size and
// alpha the caller asked for. A mocked OpenAI-compatible endpoint stands in for
// any BYOK provider: no network, no spend.

async function magentaRender(): Promise<string> {
  const subject = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 240, g: 200, b: 20 } } }).png().toBuffer();
  const render = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 0, b: 255 } } })
    .composite([{ input: subject, left: 256, top: 256 }]).png().toBuffer();
  return render.toString('base64');
}

describe('image size and transparency through generateMedia', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const saved = { config: process.env.PIXO_MEDIA_CONFIG_DIR, data: process.env.PIXO_DATA_DIR, key: process.env.PIXO_CUSTOM_IMAGE_API_KEY };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pixo-image-size-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.pixo', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    delete process.env.PIXO_MEDIA_CONFIG_DIR;
    delete process.env.PIXO_DATA_DIR;
    delete process.env.PIXO_CUSTOM_IMAGE_API_KEY;
    const config = path.join(projectRoot, '.pixo', 'media-config.json');
    await writeFile(config, JSON.stringify({ providers: { 'custom-image': { baseUrl: 'https://images.example.test/v1', model: 'acme-image' } } }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const [key, value] of [['PIXO_MEDIA_CONFIG_DIR', saved.config], ['PIXO_DATA_DIR', saved.data], ['PIXO_CUSTOM_IMAGE_API_KEY', saved.key]] as const) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  it('asks a non-native provider for a keyable backdrop and writes an exact-size alpha PNG', async () => {
    const b64 = await magentaRender();
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const snapshots: Array<{ name: string; bytes: Buffer }> = [];

    const result = await generateMedia({
      projectRoot, projectsRoot, projectId: 'game', surface: 'image', model: 'custom-image',
      prompt: 'A gold coin icon\n\nBackground: transparent.', output: 'assets/icons/coin.jpg', width: 64, height: 64, background: 'transparent',
      onBytesWritten: (written) => { snapshots.push({ name: written.name, bytes: written.bytes }); },
    });

    expect(requests).toHaveLength(1);
    expect(String(requests[0]!.prompt)).toMatch(/^A gold coin icon\n\nFinal asset size: 64x64 px/);
    expect(String(requests[0]!.prompt)).toContain('flat, uniform #FF00FF color');
    // The art-style merge's "transparent" line would invite a fake checkerboard.
    expect(String(requests[0]!.prompt)).not.toContain('Background: transparent.');
    expect(result).toMatchObject({ name: 'assets/icons/coin.png', mime: 'image/png', width: 64, height: 64, transparent: true, warnings: [] });
    expect(result.assetProvenance.promptText).toBe('A gold coin icon\n\nBackground: transparent.');
    expect(result.assetProvenance.params).toMatchObject({ width: 64, height: 64, requestedWidth: 64, requestedHeight: 64, background: 'transparent', alpha: 'keyed' });

    const written = await readFile(path.join(projectsRoot, 'game', 'assets', 'icons', 'coin.png'));
    expect(await sharp(written).metadata()).toMatchObject({ width: 64, height: 64, hasAlpha: true });
    const { data } = await sharp(written).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)]).toEqual([240, 200, 20, 255]);
    // The chat snapshot is the final file, not the provider's render.
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.name).toBe('assets/icons/coin.png');
    expect(snapshots[0]!.bytes.equals(written)).toBe(true);
  });

  it('frames a wide size with the nearest provider aspect and clamps it to 1.5K', async () => {
    const b64 = await magentaRender();
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const result = await generateMedia({
      projectRoot, projectsRoot, projectId: 'game', surface: 'image', model: 'custom-image',
      prompt: 'A forest level background', output: 'assets/bg/forest.png', width: 3840, height: 2160, background: 'scene',
    });
    expect(result).toMatchObject({ width: 1536, height: 864 });
    expect(result).not.toHaveProperty('transparent');
    expect(result.warnings).toContain('size 3840x2160 clamped to 1536x864 (long edge 16-1536px)');
    expect(String(requests[0]!.prompt)).not.toContain('#FF00FF');
    expect(result.assetProvenance.params).toMatchObject({ aspect: '16:9' });
  });

  it('refuses a size on a non-image surface before any provider call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateMedia({ projectRoot, projectsRoot, projectId: 'game', surface: 'video', model: 'kling-2.0', prompt: 'x', width: 64 }))
      .rejects.toThrow('width and height apply to image generation only');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Codex image_gen instruction', () => {
  it('asks for real alpha, gives a keyable fallback and the final size', () => {
    const text = codexImageInstruction({ dataRoot: '.', prompt: 'A slime', background: 'transparent', keyColor: [255, 0, 255],
      finalSize: { width: 96, height: 96, aspect: '1:1', warnings: [] } });
    expect(text).toContain('genuinely transparent background');
    expect(text).toContain('If you cannot return alpha: Background: the host removes it');
    expect(text).toContain('Final asset size: 96x96 px (the host resizes it). It is shown small');
  });
});
