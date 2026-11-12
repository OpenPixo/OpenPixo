import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { GamePlaytestFrame, GameVerifyScreenshot } from '@openpixo/contracts';
import { gamePngSize } from './verify-process.js';

/**
 * Game frames and screenshots an agent looks at. Each image it opens stays in its
 * conversation and is sent again with every later request: a Codex run that opened
 * 182 full-size PNG frames (about 700 KB each) sent about 158 MB per request until
 * OpenAI refused every turn. So frames are stored as JPEG at the 1280 px game
 * viewport, each playtest gets one overview image, and old runs leave the disk.
 */
export const GAME_FRAME_MAX_WIDTH = 1280;
const FRAME_QUALITY = 82;
const OVERVIEW_QUALITY = 80;
const OVERVIEW_WIDTH = 1280;
const OVERVIEW_GAP = 4;
const OVERVIEW_CAPTION = 22;
const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Save one captured frame (PNG from the capture host or Godot) as the stored JPEG. */
export async function saveGameFrame(artifactDir: string, png: Buffer): Promise<GameVerifyScreenshot> {
  const size = gamePngSize(png); // a real PNG of bounded size and dimensions, before anything decodes it
  const ref = randomUUID();
  let encoded: { data: Buffer; info: { width: number; height: number } };
  try {
    encoded = await sharp(png).flatten({ background: '#000' })
      .resize({ width: GAME_FRAME_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: FRAME_QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  } catch {
    // A frame the encoder cannot read is still evidence: keep it as it came.
    const file = path.resolve(artifactDir, `${ref}.png`);
    await writeFile(file, png);
    return { ref, ...size, path: file };
  }
  const file = path.resolve(artifactDir, `${ref}.jpg`);
  await writeFile(file, encoded.data);
  return { ref, width: encoded.info.width, height: encoded.info.height, path: file };
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, ch => `&#${ch.charCodeAt(0)};`);
}

/** `#3 · 1.5s · after-jump`: the frame's place in `playtest.frames`, its time and its label. */
function caption(index: number, frame: GamePlaytestFrame): string {
  return `#${index + 1} · ${(frame.atMs / 1000).toFixed(1)}s${frame.label ? ` · ${frame.label}` : ''}`;
}

/**
 * Every frame of one playtest as numbered, labelled tiles in one JPEG, up to four
 * across. A playtest with one frame gets that frame at full width.
 */
export async function saveGamePlaytestOverview(artifactDir: string, frames: GamePlaytestFrame[]): Promise<GameVerifyScreenshot | null> {
  if (!frames.length) return null;
  const columns = Math.min(4, frames.length), rows = Math.ceil(frames.length / columns);
  const tileWidth = Math.floor((OVERVIEW_WIDTH - (columns - 1) * OVERVIEW_GAP) / columns);
  const first = frames[0]!;
  const tileHeight = Math.max(1, Math.round(tileWidth * (first.height || 9) / (first.width || 16)));
  const width = columns * tileWidth + (columns + 1) * OVERVIEW_GAP;
  const height = rows * (tileHeight + OVERVIEW_CAPTION) + (rows + 1) * OVERVIEW_GAP;
  const layers = await Promise.all(frames.map(async (frame, index) => {
    const left = OVERVIEW_GAP + (index % columns) * (tileWidth + OVERVIEW_GAP);
    const top = OVERVIEW_GAP + Math.floor(index / columns) * (tileHeight + OVERVIEW_CAPTION + OVERVIEW_GAP);
    // A frame kept as it came because it could not be decoded leaves its tile black.
    const tile = await sharp(frame.path).resize(tileWidth, tileHeight, { fit: 'contain', background: '#000' }).toBuffer()
      .catch(() => sharp({ create: { width: tileWidth, height: tileHeight, channels: 3, background: '#000' } }).png().toBuffer());
    const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${OVERVIEW_CAPTION}">`
      + `<text x="4" y="16" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#ffffff">${escapeXml(caption(index, frame))}</text></svg>`);
    return [{ input: tile, left, top }, { input: text, left, top: top + tileHeight }];
  }));
  const ref = randomUUID(), file = path.resolve(artifactDir, `${ref}.jpg`);
  const data = await sharp({ create: { width, height, channels: 3, background: '#1b1b22' } })
    .composite(layers.flat()).jpeg({ quality: OVERVIEW_QUALITY, mozjpeg: true }).toBuffer();
  await writeFile(file, data);
  return { ref, width, height, path: file };
}

/** Width and height of a stored frame, or null when the bytes are not a PNG or a JPEG. */
export async function gameFrameSize(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  const png = bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const jpeg = bytes.length >= 4 && bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
  if (!png && !jpeg) return null;
  try {
    const meta = await sharp(bytes).metadata();
    return meta.width && meta.height && meta.format === (png ? 'png' : 'jpeg') ? { width: meta.width, height: meta.height } : null;
  } catch { return null; }
}

const POINTERS = ['latest.json', 'latest-playtest.json'];

function refsOf(result: unknown): string[] {
  const value = result as { steps?: Array<{ logRef?: unknown }>; screenshots?: Array<{ ref?: unknown }>;
    playtest?: { frames?: Array<{ ref?: unknown }>; overview?: { ref?: unknown } } } | null;
  const refs = [...(value?.steps ?? []).map(step => step?.logRef), ...(value?.screenshots ?? []).map(shot => shot?.ref),
    ...(value?.playtest?.frames ?? []).map(frame => frame?.ref), value?.playtest?.overview?.ref];
  return refs.filter((ref): ref is string => typeof ref === 'string');
}

/**
 * Keep the newest `keep` registered results and whatever `latest.json` and
 * `latest-playtest.json` name; delete older records and every frame, log or
 * leftover movie folder nothing kept names. Files younger than `graceMs` stay,
 * because a playtest writes its frames before its result is registered. When a
 * record that would be kept cannot be read, nothing is deleted. Returns the count.
 */
export async function pruneGameVerifyArtifacts(dir: string,
  options: { keep?: number; graceMs?: number; now?: number } = {}): Promise<number> {
  const keep = options.keep ?? 10, graceMs = options.graceMs ?? 3600_000, now = options.now ?? Date.now();
  const entries = await readdir(dir, { withFileTypes: true });
  const dated = await Promise.all(entries.map(async entry => ({ entry, mtimeMs: (await stat(path.join(dir, entry.name))).mtimeMs })));
  const records = dated.filter(({ entry }) => entry.isFile() && entry.name.endsWith('.json') && REF.test(entry.name.slice(0, -5)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const kept = [...records.slice(0, keep).map(({ entry }) => entry.name), ...POINTERS.filter(name => entries.some(entry => entry.name === name))];
  const referenced = new Set<string>();
  for (const name of kept) {
    try { for (const ref of refsOf(JSON.parse(await readFile(path.join(dir, name), 'utf8')))) referenced.add(ref); }
    catch { return 0; }
  }
  const doomed = [...records.slice(keep).map(({ entry }) => entry.name)];
  for (const { entry, mtimeMs } of dated) {
    if (now - mtimeMs < graceMs) continue;
    const match = /^(.+)\.(png|jpg|log)$/.exec(entry.name);
    if (entry.isFile() && match && REF.test(match[1]!) && !referenced.has(match[1]!)) doomed.push(entry.name);
    // Godot movie folders are removed after each playtest; one is left only by a crash.
    if (entry.isDirectory() && REF.test(entry.name)) doomed.push(entry.name);
  }
  let removed = 0;
  for (const name of doomed) {
    try { await rm(path.join(dir, name), { recursive: true, force: true }); removed++; } catch { /* in use: try again next time */ }
  }
  return removed;
}
