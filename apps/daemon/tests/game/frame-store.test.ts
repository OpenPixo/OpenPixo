import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GAME_FRAME_MAX_WIDTH, pruneGameVerifyArtifacts, saveGameFrame, saveGamePlaytestOverview } from '../../src/game/frame-store.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'pixo-frames-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

/** Smooth shapes with fine grain compress like painted game art, not like a flat test colour. */
async function paintedPng(width = 1280, height = 720): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3, u = x / width, v = y / height;
    for (let c = 0; c < 3; c++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const shade = 128 + 90 * Math.sin(u * (7 + c) + v * 5) * Math.cos(v * (4 + c) - u * 3);
      pixels[i + c] = Math.max(0, Math.min(255, Math.round(shade + (seed % 17) - 8)));
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

it('keeps a frame it cannot re-encode as the PNG it came as', async () => {
  // Valid PNG header and size, but image data a decoder rejects.
  const broken = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64');
  const shot = await saveGameFrame(dir, broken);
  expect(shot).toEqual({ ref: shot.ref, width: 1, height: 1, path: path.join(dir, `${shot.ref}.png`) });
  expect(await readFile(shot.path!)).toEqual(broken);
});

it('saves a playtest frame as a JPEG far smaller than the PNG the capture host sent', async () => {
  const png = await paintedPng();
  const shot = await saveGameFrame(dir, png);
  const bytes = await readFile(shot.path!);
  expect(shot.path).toBe(path.join(dir, `${shot.ref}.jpg`));
  expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  expect({ width: shot.width, height: shot.height }).toEqual({ width: 1280, height: 720 });
  expect(bytes.length).toBeLessThan(png.length / 3);
});

it('scales a high-DPI capture down to the 1280 px game viewport', async () => {
  const shot = await saveGameFrame(dir, await paintedPng(2560, 1440));
  expect({ width: shot.width, height: shot.height }).toEqual({ width: GAME_FRAME_MAX_WIDTH, height: 720 });
  expect(await sharp(shot.path!).metadata()).toMatchObject({ width: 1280, height: 720, format: 'jpeg' });
});

it('draws every frame of a playtest into one overview image', async () => {
  const frames = [];
  for (let i = 0; i < 12; i++) frames.push({ ...await saveGameFrame(dir, await paintedPng()), atMs: i * 500, ...(i === 3 ? { label: 'after-jump' } : {}) });
  const overview = await saveGamePlaytestOverview(dir, frames);
  const meta = await sharp(overview!.path!).metadata();
  const frameBytes = (await Promise.all(frames.map(frame => stat(frame.path!)))).reduce((sum, info) => sum + info.size, 0);
  expect(meta).toMatchObject({ format: 'jpeg', width: overview!.width, height: overview!.height });
  expect(overview!.width).toBeLessThanOrEqual(1300);
  expect((await stat(overview!.path!)).size).toBeLessThan(frameBytes / 4);
});

it('makes a lone frame fill the overview instead of shrinking it to a tile', async () => {
  const frame = { ...await saveGameFrame(dir, await paintedPng()), atMs: 0 };
  const overview = await saveGamePlaytestOverview(dir, [frame]);
  expect(overview!.width).toBeGreaterThanOrEqual(1280);
  expect(await saveGamePlaytestOverview(dir, [])).toBeNull();
});

async function record(name: string, refs: { logRef: string; shots: string[]; overview?: string }, ageMs: number, now: number) {
  const result = { status: 'passed', steps: [{ name: 'run', logRef: refs.logRef }], screenshots: refs.shots.map(ref => ({ ref })),
    ...(refs.overview ? { playtest: { frames: refs.shots.map(ref => ({ ref })), overview: { ref: refs.overview } } } : {}) };
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(result));
  await utimes(file, (now - ageMs) / 1000, (now - ageMs) / 1000);
  for (const [ref, ext] of [[refs.logRef, 'log'], ...refs.shots.map(ref => [ref, 'jpg']), ...(refs.overview ? [[refs.overview, 'jpg']] : [])] as const) {
    const artifact = path.join(dir, `${ref}.${ext}`);
    await writeFile(artifact, 'x');
    await utimes(artifact, (now - ageMs) / 1000, (now - ageMs) / 1000);
  }
  return result;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

it('keeps the newest playtests and deletes older frames, logs and records from disk', async () => {
  const now = Date.now(), day = 24 * 3600_000;
  for (let i = 0; i < 14; i++) await record(`${uuid(100 + i)}.json`, { logRef: uuid(200 + i), shots: [uuid(300 + i)], overview: uuid(400 + i) }, (14 - i) * day, now);
  // The UI reads these pointers, so whatever they name survives however old it is.
  const pinned = await record('latest.json', { logRef: uuid(500), shots: [uuid(501)] }, 30 * day, now);
  await writeFile(path.join(dir, `${uuid(600)}.png`), 'old orphan');
  await utimes(path.join(dir, `${uuid(600)}.png`), (now - day) / 1000, (now - day) / 1000);
  await writeFile(path.join(dir, `${uuid(601)}.jpg`), 'frame of a playtest still running');

  const removed = await pruneGameVerifyArtifacts(dir, { keep: 10, now });

  const left = new Set(await readdir(dir));
  for (let i = 0; i < 4; i++) for (const name of [`${uuid(100 + i)}.json`, `${uuid(200 + i)}.log`, `${uuid(300 + i)}.jpg`, `${uuid(400 + i)}.jpg`]) expect(left.has(name)).toBe(false);
  for (let i = 4; i < 14; i++) for (const name of [`${uuid(100 + i)}.json`, `${uuid(200 + i)}.log`, `${uuid(300 + i)}.jpg`, `${uuid(400 + i)}.jpg`]) expect(left.has(name)).toBe(true);
  expect(left.has('latest.json') && left.has(`${pinned.steps[0]!.logRef}.log`) && left.has(`${uuid(501)}.jpg`)).toBe(true);
  expect(left.has(`${uuid(600)}.png`)).toBe(false);
  expect(left.has(`${uuid(601)}.jpg`)).toBe(true);
  expect(removed).toBe(17);
});

it('leaves files alone when it cannot read a record', async () => {
  const now = Date.now();
  await writeFile(path.join(dir, `${uuid(1)}.json`), '{not json');
  await writeFile(path.join(dir, `${uuid(2)}.jpg`), 'x');
  await utimes(path.join(dir, `${uuid(2)}.jpg`), (now - 7 * 24 * 3600_000) / 1000, (now - 7 * 24 * 3600_000) / 1000);
  expect(await pruneGameVerifyArtifacts(dir, { keep: 10, now })).toBe(0);
  expect((await readdir(dir)).sort()).toEqual([`${uuid(1)}.json`, `${uuid(2)}.jpg`]);
});
