import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { measureFrame, readRgba, summarizeFrames } from '../../src/assets/ops/frames.js';
import { imageGenerationNote } from '../../src/media/image-sheet.js';
import { generateMedia } from '../../src/media/index.js';
import { resolveSheetRequest } from '../../src/media/sheet-request.js';

// One render cut into pieces: a mocked OpenAI-compatible endpoint stands in for any
// image provider, so nothing reaches the network and nothing is spent.

const MAGENTA = { r: 255, g: 0, b: 255 };

/** A 1536x1024 render on a flat magenta backdrop, one coloured block per listed 512 px cell. */
async function sheetRender(blocks: Array<{ cell: number; left: number; top: number; width: number; height: number } | null>): Promise<string> {
  const composites = [];
  for (const block of blocks) {
    if (!block) continue;
    const column = (block.cell - 1) % 3, row = Math.floor((block.cell - 1) / 3);
    composites.push({
      input: await sharp({ create: { width: block.width, height: block.height, channels: 3, background: { r: 30, g: 160, b: 60 } } }).png().toBuffer(),
      left: column * 512 + block.left, top: row * 512 + block.top,
    });
  }
  const render = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: MAGENTA } }).composite(composites).png().toBuffer();
  return render.toString('base64');
}

describe('generate --sheet', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const saved = { config: process.env.PIXO_MEDIA_CONFIG_DIR, data: process.env.PIXO_DATA_DIR, key: process.env.PIXO_CUSTOM_IMAGE_API_KEY };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pixo-image-sheet-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.pixo', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    delete process.env.PIXO_MEDIA_CONFIG_DIR;
    delete process.env.PIXO_DATA_DIR;
    delete process.env.PIXO_CUSTOM_IMAGE_API_KEY;
    await writeFile(path.join(projectRoot, '.pixo', 'media-config.json'),
      JSON.stringify({ providers: { 'custom-image': { baseUrl: 'https://images.example.test/v1', model: 'acme-image' } } }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const [key, value] of [['PIXO_MEDIA_CONFIG_DIR', saved.config], ['PIXO_DATA_DIR', saved.data], ['PIXO_CUSTOM_IMAGE_API_KEY', saved.key]] as const) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  function stubProvider(b64: string) {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    return requests;
  }

  it('renders once with the layout in the prompt and writes each icon under its name at its size', async () => {
    const requests = stubProvider(await sheetRender([
      { cell: 1, left: 156, top: 156, width: 200, height: 200 },
      { cell: 2, left: 100, top: 200, width: 300, height: 100 },
      { cell: 3, left: 0, top: 156, width: 200, height: 200 },
      null,
    ]));
    const resolved = resolveSheetRequest({ surface: 'image', model: 'custom-image', prompt: 'Farm pickups', output: 'assets/icons/pickups-sheet.png',
      width: 64, height: 64, background: 'transparent', sheet: { columns: 3, rows: 2, names: ['coin', 'heart', 'key', 'gem'] } }, 'openai');
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved.body).not.toHaveProperty('width');
    expect(resolved.body.aspect).toBe('4:3');

    const result = await generateMedia({
      projectRoot, projectsRoot, projectId: 'game', surface: 'image', model: 'custom-image',
      prompt: resolved.body.prompt as string, output: 'assets/icons/pickups-sheet.png', aspect: resolved.body.aspect as string,
      background: 'transparent', sheet: resolved.plan,
    });

    expect(requests).toHaveLength(1);
    const sent = String(requests[0]!.prompt);
    expect(sent).toMatch(/^Farm pickups\n\nLayout: one image split into an even grid of 3 columns and 2 rows/);
    expect(sent).toContain('Cells in order: 1 coin, 2 heart, 3 key, 4 gem; the remaining 2 cells empty.');
    // The sheet is not sized, so it is not cropped to the drawing.
    expect(sent).not.toContain('Final asset size');
    expect(result).toMatchObject({ name: 'assets/icons/pickups-sheet.png', width: 1536, height: 1024, renderedWidth: 1536, renderedHeight: 1024,
      sheet: { columns: 3, rows: 2, frames: false, cellWidth: 512, cellHeight: 512 } });
    expect(result.pieces).toEqual([
      { cell: 1, name: 'assets/icons/coin.png', width: 64, height: 64 },
      { cell: 2, name: 'assets/icons/heart.png', width: 64, height: 64 },
      { cell: 3, name: 'assets/icons/key.png', width: 64, height: 64, touchesEdge: true },
      { cell: 4, name: 'assets/icons/gem.png', width: 64, height: 64, empty: true },
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'cell 3 (key) touches its cell\'s edge; part of it may be in the next cell',
      'cell 4 (gem) came out empty',
    ]));
    expect(result.note).toBe('rendered 1536x1024 as one sheet, cut into 4 pieces of 64x64.');
    const coin = await readRgba(await readFile(path.join(projectsRoot, 'game/assets/icons/coin.png')));
    // The block fills the icon: fitted on its own, as one generated image would be.
    expect(measureFrame(coin).bounds).toEqual({ left: 0, top: 0, width: 64, height: 64 });
    const heart = measureFrame(await readRgba(await readFile(path.join(projectsRoot, 'game/assets/icons/heart.png'))));
    expect(heart.bounds).toMatchObject({ width: 64, left: 0 });
    expect(heart.bounds!.height).toBeLessThan(24);
    await expect(stat(path.join(projectsRoot, 'game/assets/icons/pickups-sheet.png'))).resolves.toBeTruthy();
  });

  it('cuts animation frames onto one canvas, one scale, feet on one line', async () => {
    stubProvider(await sheetRender([
      { cell: 1, left: 200, top: 100, width: 100, height: 300 },
      { cell: 2, left: 300, top: 60, width: 100, height: 300 },
      { cell: 4, left: 180, top: 140, width: 100, height: 300 },
      { cell: 5, left: 260, top: 100, width: 100, height: 300 },
    ]));
    const resolved = resolveSheetRequest({ surface: 'image', model: 'custom-image', prompt: 'Hero running, side view', output: 'assets/hero/hero-run-sheet.png',
      width: 48, height: 96, sheet: { columns: 2, rows: 2, frames: true } }, 'openai');
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved.body.background).toBe('transparent');
    expect(resolved.plan.names).toEqual(['hero-run-1', 'hero-run-2', 'hero-run-3', 'hero-run-4']);
    // Frame cells come from a 3x2 render here on purpose: the cut follows the grid asked for.
    const result = await generateMedia({
      projectRoot, projectsRoot, projectId: 'game', surface: 'image', model: 'custom-image',
      prompt: resolved.body.prompt as string, output: 'assets/hero/hero-run-sheet.png', background: 'transparent', sheet: resolved.plan,
    });
    expect(result.pieces?.map((piece) => piece.name)).toEqual(['assets/hero/hero-run-1.png', 'assets/hero/hero-run-2.png', 'assets/hero/hero-run-3.png', 'assets/hero/hero-run-4.png']);
    const frames = await Promise.all(result.pieces!.map(async (piece) => measureFrame(await readRgba(await readFile(path.join(projectsRoot, 'game', piece.name))))));
    expect(frames.every((frame) => frame.width === 48 && frame.height === 96)).toBe(true);
    expect(summarizeFrames(frames)).toMatchObject({ baselineSpreadPx: 0, sameCanvas: true });
    expect(result.note).toMatch(/cut into 4 frames of 48x96/);
  });

  it('refuses a sheet it cannot make, before anything is generated', () => {
    const base = { surface: 'image', model: 'custom-image', prompt: 'Icons', output: 'assets/icons/set-sheet.png' };
    expect(resolveSheetRequest({ ...base, sheet: { columns: 5, rows: 5 } }, 'openai')).toMatchObject({ ok: false, message: expect.stringMatching(/2 to 16 cells/) });
    expect(resolveSheetRequest({ ...base, sheet: { columns: 2, rows: 1, names: ['a', 'b', 'c'] } }, 'openai')).toMatchObject({ ok: false, message: expect.stringMatching(/3 names for 2 cells/) });
    expect(resolveSheetRequest({ ...base, sheet: { columns: 2, rows: 1, names: ['../a', 'b'] } }, 'openai')).toMatchObject({ ok: false });
    expect(resolveSheetRequest({ ...base, sheet: { columns: 2, rows: 1, names: ['set-sheet', 'b'] } }, 'openai')).toMatchObject({ ok: false });
    expect(resolveSheetRequest({ ...base, output: undefined, sheet: { columns: 2, rows: 1 } }, 'openai')).toMatchObject({ ok: false, message: expect.stringMatching(/--output/) });
    expect(resolveSheetRequest({ ...base, surface: 'audio', sheet: { columns: 2, rows: 1 } }, 'openai')).toMatchObject({ ok: false });
    // Hosted and Codex render only 1:1, 3:2 and 2:3.
    const hosted = resolveSheetRequest({ ...base, sheet: { columns: 4, rows: 2 } }, 'openpixo');
    expect(hosted).toMatchObject({ ok: true, body: { aspect: '3:2' } });
  });
});

describe('the tool facts note', () => {
  it('says what was rendered, what it became and what it cost, and nothing else', () => {
    expect(imageGenerationNote({ renderedWidth: 1024, renderedHeight: 1024, width: 64, height: 64, creditsCharged: 4 }))
      .toBe('rendered 1024x1024, resized to 64x64, 4 credits; small images in one style cost less made together as one sheet (--sheet).');
    expect(imageGenerationNote({ renderedWidth: 1536, renderedHeight: 1024, width: 1536, height: 1024 })).toBe('rendered 1536x1024.');
    expect(imageGenerationNote({ renderedWidth: 1536, renderedHeight: 1024, width: 1536, height: 1024, creditsCharged: 4, sheet: { columns: 3, rows: 2, frames: false, cellWidth: 512, cellHeight: 512 },
      pieces: [{ cell: 1, name: 'a.png', width: 64, height: 64 }, { cell: 2, name: 'b.png', width: 64, height: 64 }] }))
      .toBe('rendered 1536x1024 as one sheet, cut into 2 pieces of 64x64, 4 credits for all 2.');
    expect(imageGenerationNote({})).toBeUndefined();
  });
});
