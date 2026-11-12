import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * Pictures the agent sends to a hosted model, kept small enough to send.
 *
 * The bundled OpenCode attaches every image the agent reads as a full-size base64 data URL in a
 * user message and keeps it in the conversation, so every later request carries it again. It never
 * shrinks one, and the cloud takes at most 4 MB a request: one 2 MB piece of game art is about 3 MB
 * as base64. Codex and Claude Code fit pictures before sending them; this does the same for the
 * hosted agent, following Codex's rule so the agent sees what a player sees:
 *
 * - A picture within {@link MAX_IMAGE_EDGE} and {@link MAX_ONE_IMAGE_BYTES} goes as it is, byte for
 *   byte. A game screen of 1920x1080 or less normally does.
 * - A larger one is scaled down in its own format: PNG stays PNG, so pixel edges and small text stay
 *   sharp. Only a picture that still does not fit at {@link LAST_EDGE} becomes a JPEG.
 * - Only the newest {@link MAX_KEPT_IMAGES} pictures that fit the room the conversation leaves stay;
 *   older ones become a line saying they were left out.
 *
 * The same picture always comes out as the same bytes, so each request still opens with what the
 * last one sent and the vendor's prompt cache keeps applying. It misses once, from the message
 * where a picture is dropped.
 */
export const MAX_KEPT_IMAGES = 4;
/** Codex's limit for a high-detail picture; vendors scale larger ones down themselves anyway. */
export const MAX_IMAGE_EDGE = 2048;
/** One picture as base64. */
export const MAX_ONE_IMAGE_BYTES = 1_000_000;
/** All kept pictures together as base64, however short the conversation. */
export const MAX_IMAGE_BYTES = 2_400_000;
/** Left for the request's own JSON beyond its text and pictures. */
const REQUEST_HEADROOM_BYTES = 100_000;
/** The smallest edge tried, and the one a JPEG fallback is made at. */
const LAST_EDGE = 1280;
/** Long edges tried in turn, in the picture's own format, before falling back to JPEG at the last. */
const EDGES = [MAX_IMAGE_EDGE, 1600, LAST_EDGE] as const;
/** Codex's JPEG quality. */
const JPEG_QUALITY = 85;
/** Shown to the model where a picture was left out. */
export const DROPPED_IMAGE_TEXT = '[An earlier picture was left out to keep this request small. Read the file again to look at it.]';

export type FittedImageCache = Map<string, string>;
const CACHE_LIMIT = 32;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface ImagePart { part: Record<string, unknown>; url: string }

function imageParts(messages: unknown[]): ImagePart[] {
  const found: ImagePart[] = [];
  for (const message of messages) {
    if (!isObject(message) || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!isObject(part) || part.type !== 'image_url' || !isObject(part.image_url)) continue;
      const url = part.image_url.url;
      if (typeof url === 'string' && url.startsWith('data:image/')) found.push({ part, url });
    }
  }
  return found;
}

function dropImage(part: Record<string, unknown>): void {
  for (const key of Object.keys(part)) delete part[key];
  Object.assign(part, { type: 'text', text: DROPPED_IMAGE_TEXT });
}

function remember(cache: FittedImageCache, key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

/** Scaled to fit `edge` in the picture's own format, or JPEG when asked. */
async function encode(input: Buffer, edge: number, format: 'png' | 'jpeg' | 'webp'): Promise<string> {
  const scaled = sharp(input, { failOn: 'none' }).resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true });
  if (format === 'jpeg') return dataUrl('image/jpeg', await scaled.flatten({ background: '#808080' }).jpeg({ quality: JPEG_QUALITY }).toBuffer());
  if (format === 'webp') return dataUrl('image/webp', await scaled.webp({ lossless: true }).toBuffer());
  return dataUrl('image/png', await scaled.png({ compressionLevel: 9 }).toBuffer());
}

/** The picture as it is when it fits, otherwise the first smaller version that does. */
async function fitImage(url: string, cache: FittedImageCache): Promise<string> {
  const key = createHash('sha256').update(url).digest('hex');
  const known = cache.get(key);
  if (known !== undefined) { remember(cache, key, known); return known; }
  let fitted = url;
  const comma = url.indexOf(',');
  if (comma > 0 && url.slice(0, comma).endsWith(';base64')) {
    try {
      const input = Buffer.from(url.slice(comma + 1), 'base64');
      const meta = await sharp(input, { failOn: 'none' }).metadata();
      const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
      if (longEdge > MAX_IMAGE_EDGE || url.length > MAX_ONE_IMAGE_BYTES) {
        const format = meta.format === 'jpeg' || meta.format === 'webp' ? meta.format : 'png';
        let candidate: string | null = null;
        for (const edge of EDGES) {
          candidate = await encode(input, edge, format);
          if (candidate.length <= MAX_ONE_IMAGE_BYTES) break;
        }
        if (candidate && candidate.length > MAX_ONE_IMAGE_BYTES && format !== 'jpeg') candidate = await encode(input, LAST_EDGE, 'jpeg');
        if (candidate && candidate.length < url.length) fitted = candidate;
      }
    } catch { /* a picture sharp cannot read goes as it is, for the vendor to judge */ }
  }
  remember(cache, key, fitted);
  return fitted;
}

/**
 * The request with its pictures fitted so the whole request stays within `maxRequestBytes`. A body
 * without pictures, or one that does not parse, is returned unchanged.
 */
export async function fitInlineImages(body: Buffer, cache: FittedImageCache = new Map(), maxRequestBytes = 4_000_000): Promise<Buffer> {
  if (!body.includes('"image_url"')) return body;
  let request: unknown;
  try { request = JSON.parse(body.toString('utf8')); } catch { return body; }
  if (!isObject(request) || !Array.isArray(request.messages)) return body;
  const parts = imageParts(request.messages);
  if (parts.length === 0) return body;

  const conversationBytes = body.length - parts.reduce((total, entry) => total + entry.url.length, 0);
  let budget = Math.min(MAX_IMAGE_BYTES, maxRequestBytes - REQUEST_HEADROOM_BYTES - conversationBytes);
  let changed = false;
  const fitted: string[] = [];
  for (const entry of parts) {
    const url = await fitImage(entry.url, cache);
    fitted.push(url);
    if (url !== entry.url) {
      (entry.part.image_url as Record<string, unknown>).url = url;
      changed = true;
    }
  }
  // Keep the newest pictures that fit, newest first; leave out every one before the first that does not.
  let firstKept = parts.length;
  for (let index = parts.length - 1; index >= 0 && parts.length - index <= MAX_KEPT_IMAGES; index -= 1) {
    if (fitted[index]!.length > budget) break;
    budget -= fitted[index]!.length;
    firstKept = index;
  }
  for (let index = 0; index < firstKept; index += 1) {
    dropImage(parts[index]!.part);
    changed = true;
  }
  return changed ? Buffer.from(JSON.stringify(request)) : body;
}
