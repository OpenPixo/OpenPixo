import path from 'node:path';
import sharp from 'sharp';
import { integerParam, numberParam, writeNew } from './files.js';
import { runFfmpeg } from './audio.js';
import { outputStem, type OpPlan } from './images.js';

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** How far apart, on average per channel out of 255, the last frame may be from the first and still count as the same picture. */
const REPEATED_END_DIFFERENCE = 6;

/** Splits FFmpeg's `image2pipe` PNG stream into one buffer per frame, by walking the PNG chunks. */
export function splitPngStream(stream: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset < stream.length) {
    if (!stream.subarray(offset, offset + 8).equals(PNG_SIGNATURE)) throw new Error('FFmpeg did not produce PNG frames');
    let cursor = offset + 8;
    for (;;) {
      if (cursor + 12 > stream.length) throw new Error('Truncated PNG frame from FFmpeg');
      const length = stream.readUInt32BE(cursor);
      const type = stream.toString('ascii', cursor + 4, cursor + 8);
      cursor += 12 + length;
      if (type === 'IEND') break;
    }
    frames.push(stream.subarray(offset, cursor));
    offset = cursor;
  }
  return frames;
}

/** Mean absolute difference per channel (0–255) of two pictures, compared small. */
async function difference(a: Buffer, b: Buffer): Promise<number> {
  const small = (frame: Buffer) => sharp(frame).resize(96, 96, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const [x, y] = await Promise.all([small(a), small(b)]);
  let total = 0;
  for (let i = 0; i < x.length; i++) total += Math.abs(x[i]! - y[i]!);
  return total / x.length;
}

/**
 * Picks `count` frames spread evenly over `total`, always starting with the first. Even
 * spacing keeps a loop's timing even when fewer frames are kept.
 */
export function evenFrameIndices(total: number, count: number): number[] {
  if (count >= total) return Array.from({ length: total }, (_, index) => index);
  return Array.from({ length: count }, (_, index) => Math.floor(index * total / count));
}

/**
 * `video-frames`: one PNG per video frame, in time order, as `<out>/<source>/frame-NNNN.png`
 * with a `<out>/<source>.json` manifest first, the same layout as `slice`. The video is decoded
 * while planning, because every output name must be known before anything is published.
 *
 * - `count`: keep this many frames, spread evenly; absent keeps every frame.
 * - `fps`: resample the video to this rate first.
 * - `dropRepeatedEnd`: drop the last frame when it repeats the first, which a clip that loops
 *   back to its start image ends with; the loop would otherwise show that pose twice.
 */
export async function planVideoFrames(source: string, file: string, params: Record<string, unknown>, out: string): Promise<OpPlan> {
  // Force the container by extension, as audio does: a renamed playlist cannot reach other files or URLs.
  const demuxers: Record<string, string> = { '.mp4': 'mov', '.mov': 'mov', '.m4v': 'mov', '.webm': 'matroska', '.mkv': 'matroska' };
  const demuxer = demuxers[path.extname(source).toLowerCase()];
  if (!demuxer) throw new Error('Unsupported video input container');
  if (params.dropRepeatedEnd !== undefined && typeof params.dropRepeatedEnd !== 'boolean') throw new Error('dropRepeatedEnd must be boolean');
  const fps = params.fps === undefined ? undefined : numberParam(params, 'fps', undefined, 0.1, 120);
  const count = params.count === undefined ? undefined : integerParam(params, 'count', undefined, 1, 600);
  const stream = await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-f', demuxer, '-i', file,
    '-map', '0:v:0', '-an', '-map_metadata', '-1', ...(fps ? ['-vf', `fps=${fps}`] : []), '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']);
  let frames = splitPngStream(stream);
  if (!frames.length) throw new Error('Video has no frames');
  if (frames.length > 600) throw new Error('Video has more than 600 frames; pass fps to keep fewer');
  const decoded = frames.length;
  let droppedRepeatedEnd = false;
  if (params.dropRepeatedEnd === true && frames.length > 2 && await difference(frames[0]!, frames.at(-1)!) <= REPEATED_END_DIFFERENCE) {
    frames = frames.slice(0, -1);
    droppedRepeatedEnd = true;
  }
  const kept = evenFrameIndices(frames.length, count ?? frames.length);
  const stem = outputStem(out, source);
  const names = kept.map((_, index) => `${stem}/frame-${String(index).padStart(4, '0')}.png`);
  const meta = await sharp(frames[0]!).metadata();
  const detail = { decoded, droppedRepeatedEnd, frameCount: kept.length, sourceFrames: kept, width: meta.width, height: meta.height };
  return { outputs: [`${stem}.json`, ...names], detail, produce: async targets => {
    for (let i = 0; i < kept.length; i++) await writeNew(targets[i + 1]!, frames[kept[i]!]!);
    await writeNew(targets[0]!, json({ source, ...detail, frames: names }));
  } };
}
