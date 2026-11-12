import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImageEditOp } from '@openpixo/contracts';
import { parseImageEditRequest, runImageEdit } from '../src/assets/image-edit.js';

let workspace: string, projectRoot: string;
const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 128];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(name = 'tiny.png', pixels = [...red, ...green], width = 2, height = 1) {
  const bytes = await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toBuffer();
  await writeFile(path.join(projectRoot, 'sprites', name), bytes);
  return bytes;
}
async function edit(ops: ImageEditOp[], output = 'edited.png', source = 'sprites/tiny.png') {
  const result = await runImageEdit(projectRoot, { source, ops, output });
  const decoded = await sharp(await readFile(path.join(projectRoot, result.output))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { result, ...decoded };
}
beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'image-edit-'));
  projectRoot = path.join(workspace, 'game');
  await mkdir(path.join(projectRoot, 'sprites'), { recursive: true });
});
afterEach(async () => {
  if (!workspace.startsWith(path.join(tmpdir(), 'image-edit-'))) throw new Error('Unsafe cleanup target');
  await rm(workspace, { recursive: true, force: true });
});

describe('ordered deterministic image editing', () => {
  it('crops an exact pixel rectangle, preserves alpha and the original, and saves beside the source', async () => {
    const original = await fixture('tiny.png', [...red, ...green, ...blue], 3);
    const { result, data, info } = await edit([{ op: 'crop', x: 1, y: 0, width: 2, height: 1 }]);
    expect([info.width, info.height]).toEqual([2, 1]);
    expect([...data]).toEqual([...green, ...blue]);
    expect(result).toMatchObject({ output: 'sprites/edited.png', sourceSha256: hash(original), outputSha256: expect.any(String) });
    expect(await readFile(path.join(projectRoot, 'sprites/tiny.png'))).toEqual(original);
    expect(result.outputSha256).toBe(hash(await readFile(path.join(projectRoot, result.output))));
  });

  it('resizes by pixels or percentage with aspect inferred from one dimension and nearest pixels', async () => {
    await fixture();
    const nearest = await edit([{ op: 'resize', scale: 2, filter: 'nearest' }]);
    expect([nearest.info.width, nearest.info.height]).toEqual([4, 2]);
    expect([...nearest.data.subarray(0, 16)]).toEqual([...red, ...red, ...green, ...green]);
    const locked = await edit([{ op: 'resize', height: 3 }], 'locked.png');
    expect([locked.info.width, locked.info.height]).toEqual([6, 3]);
    const exact = await edit([{ op: 'resize', width: 3, height: 4, filter: 'smooth' }], 'smooth.png');
    expect([exact.info.width, exact.info.height]).toEqual([3, 4]);
    expect(exact.data[4]).toBeGreaterThan(0);
    expect(exact.data[5]).toBeGreaterThan(0);
  });

  it('trims transparent alpha edges and keeps a fully transparent image as 1 by 1', async () => {
    const pixels = Array(4 * 4 * 4).fill(0);
    pixels.splice((1 * 4 + 2) * 4, 4, ...blue);
    await fixture('tiny.png', pixels, 4, 4);
    const trimmed = await edit([{ op: 'trim' }]);
    expect([trimmed.info.width, trimmed.info.height]).toEqual([1, 1]);
    expect([...trimmed.data]).toEqual(blue);
    await fixture('empty.png', Array(3 * 2 * 4).fill(0), 3, 2);
    const empty = await edit([{ op: 'trim' }], 'empty_trim.png', 'sprites/empty.png');
    expect([empty.info.width, empty.info.height, empty.data[3]]).toEqual([1, 1, 0]);
  });

  it('pads a centered transparent canvas and rounds each dimension to the next power of two', async () => {
    await fixture('tiny.png', [...red, ...green, ...blue], 3);
    const padded = await edit([{ op: 'pad', width: 6, height: 4 }]);
    expect([padded.info.width, padded.info.height]).toEqual([6, 4]);
    expect(padded.data[3]).toBe(0);
    expect([...padded.data.subarray((1 * 6 + 1) * 4, (1 * 6 + 4) * 4)]).toEqual([...red, ...green, ...blue]);
    const pot = await edit([{ op: 'pad', powerOfTwo: true }], 'pot.png');
    expect([pot.info.width, pot.info.height]).toEqual([4, 1]);
    expect([...pot.data.subarray(0, 12)]).toEqual([...red, ...green, ...blue]);
    expect(pot.data[15]).toBe(0);
  });

  it.each([
    { op: { op: 'flip', axis: 'h' } as ImageEditOp, expected: [...green, ...red, ...green, ...blue], width: 2, height: 2 },
    { op: { op: 'flip', axis: 'v' } as ImageEditOp, expected: [...blue, ...green, ...red, ...green], width: 2, height: 2 },
    { op: { op: 'rotate', degrees: 90 } as ImageEditOp, expected: [...blue, ...red, ...green, ...green], width: 2, height: 2 },
  ])('applies $op to exact sprite pixels', async ({ op, expected, width, height }) => {
    await fixture('tiny.png', [...red, ...green, ...blue, ...green], 2, 2);
    const edited = await edit([op]);
    expect([edited.info.width, edited.info.height]).toEqual([width, height]);
    expect([...edited.data]).toEqual(expected);
  });

  it('materializes repeated operations in caller order, including rotate dimension changes', async () => {
    await fixture();
    const edited = await edit([
      { op: 'resize', scale: 2, filter: 'nearest' }, { op: 'crop', x: 1, y: 0, width: 2, height: 1 },
      { op: 'flip', axis: 'h' }, { op: 'resize', width: 4, height: 1, filter: 'nearest' }, { op: 'rotate', degrees: 90 },
    ]);
    expect([edited.info.width, edited.info.height]).toEqual([1, 4]);
    expect([...edited.data]).toEqual([...green, ...green, ...red, ...red]);
  });

  it('rejects output collisions, traversal, absolute paths and symlink escapes without writing outside the project', async () => {
    const original = await fixture();
    const outside = path.join(workspace, 'outside');
    await mkdir(outside); await writeFile(path.join(outside, 'secret.png'), original);
    await symlink(outside, path.join(projectRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const request = { source: 'sprites/tiny.png', ops: [{ op: 'trim' }], output: 'edited.png' };
    for (const source of ['../outside/secret.png', path.join(outside, 'secret.png'), 'escape/secret.png']) {
      await expect(runImageEdit(projectRoot, { ...request, source })).rejects.toThrow();
    }
    for (const output of ['../outside/edited.png', path.join(outside, 'edited.png'), 'escape/edited.png', 'tiny.png']) {
      await expect(runImageEdit(projectRoot, { ...request, output })).rejects.toThrow();
    }
    await edit([{ op: 'trim' }]);
    const saved = await readFile(path.join(projectRoot, 'sprites/edited.png'));
    await expect(edit([{ op: 'flip', axis: 'h' }])).rejects.toThrow('already exists');
    expect(await readFile(path.join(projectRoot, 'sprites/edited.png'))).toEqual(saved);
    expect(await readFile(path.join(projectRoot, 'sprites/tiny.png'))).toEqual(original);
    expect(await readdir(outside)).toEqual(['secret.png']);
  });

  it('honors EXIF orientation so crop coordinates match the visible browser image', async () => {
    const original = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#ff0000' } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    await writeFile(path.join(projectRoot, 'sprites/oriented.jpg'), original);
    const rotated = await edit([{ op: 'crop', x: 0, y: 0, width: 1, height: 3 }], 'oriented_crop.png', 'sprites/oriented.jpg');
    expect([rotated.info.width, rotated.info.height]).toEqual([1, 3]);
    expect(await readFile(path.join(projectRoot, 'sprites/oriented.jpg'))).toEqual(original);
  });
  it('rejects invalid geometry, unknown fields and oversized output without partial files', async () => {
    await fixture();
    for (const ops of [[], [{ op: 'crop', x: 0, y: 0, width: 4, height: 1 }], [{ op: 'pad', width: 1, height: 1 }],
      [{ op: 'resize', width: 8192, height: 8193 }], [{ op: 'resize', scale: 8192 }], [{ op: 'rotate', degrees: 45 }],
      [{ op: 'trim', extra: true }], [{ op: 'crop', x: -1, y: 0, width: 1, height: 1 }]]) {
      await expect(runImageEdit(projectRoot, { source: 'sprites/tiny.png', output: 'invalid.png', ops })).rejects.toThrow();
    }
    expect(() => parseImageEditRequest({ source: 'sprites/tiny.png', output: 'edited.jpg', ops: [{ op: 'trim' }] })).toThrow('.png');
    expect(await readdir(path.join(projectRoot, 'sprites'))).toEqual(['tiny.png']);
  });
});
