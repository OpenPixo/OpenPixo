import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runAssetOp } from '../src/assets/ops/index.js';

// Each recipe postprocess step writes under the previous step's path, so a walk's frames reach
// paths past Windows' 260-character limit, which the image library cannot open by itself.
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'asset-ops-long-')); });
afterEach(async () => {
  if (!root.startsWith(path.join(tmpdir(), 'asset-ops-long-'))) throw new Error('Unsafe cleanup target');
  await rm(root, { recursive: true, force: true });
});

it('processes pictures whose path is longer than 260 characters', async () => {
  let relative = '';
  while (path.join(root, relative).length < 280) relative = path.posix.join(relative, 'derived/0-a-long-step-folder-name');
  const source = path.posix.join(relative, 'frame-0000.png');
  await mkdir(path.join(root, relative), { recursive: true });
  await writeFile(path.join(root, source), await sharp({ create: { width: 8, height: 4, channels: 3, background: { r: 0, g: 255, b: 0 } } }).png().toBuffer());
  expect(path.join(root, source).length).toBeGreaterThan(260);

  const resized = await runAssetOp({ projectRoot: root }, { op: 'resize', inputs: [source], params: { width: 16, height: 8 }, out: 'derived/1-resize' });
  expect(resized.results.map(result => result.error ?? result.status)).toEqual(['succeeded']);
  const keyed = await runAssetOp({ projectRoot: root }, { op: 'remove-bg', inputs: [resized.results[0]!.output!], params: { mode: 'chroma', color: '00ff00' }, out: 'derived/2-remove-bg' });
  expect(keyed.results.map(result => result.error ?? result.status)).toEqual(['succeeded']);
});
