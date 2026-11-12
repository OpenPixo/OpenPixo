import sharp from 'sharp';
import { resolveImageOutputSize, type ImageOutputSize } from '@openpixo/contracts';

/**
 * Final shaping of a generated image: exact size and real transparency.
 *
 * Every image provider (Codex image_gen, BYOK APIs, OpenPixo hosted) renders at
 * its own native size and may or may not return alpha. This module is the one
 * place that turns those bytes into what the caller asked for, so size and
 * transparency behave the same whichever provider produced the pixels.
 */
export interface ImageOutputPlan {
  /** Exact final size, or null to keep the provider's size. */
  size: ImageOutputSize | null;
  /** An explicit transparent request: the result must carry alpha. */
  transparent: boolean;
  /** Nearest-neighbour resampling for pixel-art styles. */
  pixelArt: boolean;
  /** The flat color non-native providers were asked to paint behind the subject. */
  keyColor: RgbColor;
}

export type RgbColor = readonly [number, number, number];

export interface ShapedImage {
  bytes: Buffer;
  /** `.png` when the bytes were re-encoded; undefined when untouched. */
  ext: '.png' | undefined;
  width: number | undefined;
  height: number | undefined;
  /** The provider's own render size, before any resize. */
  sourceWidth: number | undefined;
  sourceHeight: number | undefined;
  transparent: boolean;
  /** How alpha was obtained: provider alpha, a host cutout, or none requested. */
  alpha: 'native' | 'keyed' | 'none';
  warnings: string[];
}

const MAGENTA: RgbColor = [255, 0, 255];
const GREEN: RgbColor = [0, 255, 0];
const PINKISH_SUBJECT = /magenta|fuchsia|pink|purple|violet|lilac|品红|洋红|粉|紫/iu;
/** Color distance (RGB Euclidean) that still counts as background. */
const KEY_TOLERANCE = 64;
/** Beyond the tolerance, this band fades from transparent to opaque. */
const KEY_FEATHER = 48;
const INPUT_PIXEL_LIMIT = 64 * 1024 * 1024;

/** Picks a key color the subject is unlikely to contain. */
export function keyColorForPrompt(prompt: string | undefined): RgbColor {
  return PINKISH_SUBJECT.test(prompt ?? '') ? GREEN : MAGENTA;
}

function hexColor(color: RgbColor): string {
  return `#${color.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * Prompt text for a provider without native alpha. Asking for "transparent"
 * alone makes such models paint a fake checkerboard, which cannot be keyed.
 */
export function keyedBackgroundInstruction(color: RgbColor): string {
  return [
    `Background: the host removes it after generation, so paint everything behind the subject as one flat, uniform ${hexColor(color)} color.`,
    'No checkerboard, gradient, texture, floor, cast shadow or scenery behind the subject. Keep the whole subject inside the frame with a small margin.',
  ].join(' ');
}

/** Hint text for the generator about the final pixel size. */
export function finalSizeInstruction(size: ImageOutputSize): string {
  const small = Math.max(size.width, size.height) <= 256;
  return `Final asset size: ${size.width}x${size.height} px (the host resizes it).${small ? ' It is shown small: use bold, readable shapes and few fine details.' : ''}`;
}

export function planImageOutput(input: {
  width?: unknown; height?: unknown; aspect?: unknown;
  background?: unknown; pixelArt?: boolean | undefined; prompt?: string | undefined;
}): ImageOutputPlan {
  return {
    size: resolveImageOutputSize(input),
    transparent: input.background === 'transparent',
    pixelArt: input.pixelArt === true,
    keyColor: keyColorForPrompt(input.prompt),
  };
}

export function planNeedsShaping(plan: ImageOutputPlan): boolean {
  return plan.size !== null || plan.transparent;
}

function distance(data: Buffer, offset: number, color: RgbColor): number {
  const dr = data[offset]! - color[0];
  const dg = data[offset + 1]! - color[1];
  const db = data[offset + 2]! - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function borderOffsets(width: number, height: number): number[] {
  const offsets: number[] = [];
  for (let x = 0; x < width; x++) {
    offsets.push(x * 4, ((height - 1) * width + x) * 4);
  }
  for (let y = 1; y < height - 1; y++) {
    offsets.push(y * width * 4, (y * width + width - 1) * 4);
  }
  return offsets;
}

/** Provider alpha counts as native when most of the border is see-through. */
function hasNativeAlpha(data: Buffer, width: number, height: number): boolean {
  const border = borderOffsets(width, height);
  const clear = border.filter((offset) => data[offset + 3]! < 16).length;
  return clear >= border.length * 0.5;
}

/** The border's dominant color, quantized so JPEG noise does not split it. */
function dominantBorderColor(data: Buffer, border: number[]): RgbColor {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const offset of border) {
    const key = ((data[offset]! >> 4) << 8) | ((data[offset + 1]! >> 4) << 4) | (data[offset + 2]! >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++; bucket.r += data[offset]!; bucket.g += data[offset + 1]!; bucket.b += data[offset + 2]!;
    buckets.set(key, bucket);
  }
  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const bucket of buckets.values()) if (bucket.count > best.count) best = bucket;
  return [Math.round(best.r / best.count), Math.round(best.g / best.count), Math.round(best.b / best.count)];
}

/**
 * Keys out the background connected to the image border.
 *
 * A flood fill from the edges, not a global color replace: a subject pixel that
 * happens to match the background survives unless it touches the outside. The
 * pixels just beyond the tolerance fade out, which keeps edges soft.
 */
export function keyOutBorderBackground(data: Buffer, width: number, height: number, hint: RgbColor): { uniform: boolean } {
  const border = borderOffsets(width, height);
  const dominant = dominantBorderColor(data, border);
  // Trust the color we asked for when the border agrees with it; otherwise
  // the provider chose its own flat backdrop, which is just as removable.
  const background = distance(Buffer.from([...dominant, 255]), 0, hint) <= KEY_TOLERANCE ? hint : dominant;
  const matching = border.filter((offset) => distance(data, offset, background) <= KEY_TOLERANCE).length;
  const pixels = width * height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  for (const offset of border) {
    const index = offset / 4;
    if (!visited[index] && distance(data, offset, background) <= KEY_TOLERANCE + KEY_FEATHER) {
      visited[index] = 1;
      queue[tail++] = index;
    }
  }
  while (head < tail) {
    const index = queue[head++]!;
    const offset = index * 4;
    const d = distance(data, offset, background);
    if (d <= KEY_TOLERANCE) {
      data[offset + 3] = 0;
    } else {
      // Feather band: partial alpha, and the fill does not continue through it.
      data[offset + 3] = Math.min(data[offset + 3]!, Math.round(((d - KEY_TOLERANCE) / KEY_FEATHER) * 255));
      continue;
    }
    const x = index % width;
    const y = (index - x) / width;
    const neighbours = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
    for (const next of neighbours) {
      if (next < 0 || visited[next]) continue;
      visited[next] = 1;
      if (distance(data, next * 4, background) <= KEY_TOLERANCE + KEY_FEATHER) queue[tail++] = next;
    }
  }
  return { uniform: matching >= border.length * 0.6 };
}

function alphaBounds(data: Buffer, width: number, height: number) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3]! > 8) {
      if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Applies a plan to provider bytes. Bytes pass through untouched when the
 * plan asks for nothing; otherwise the result is always a PNG.
 */
export async function shapeImageOutput(bytes: Buffer, plan: ImageOutputPlan): Promise<ShapedImage> {
  const warnings = [...(plan.size?.warnings ?? [])];
  if (!planNeedsShaping(plan)) {
    const meta = await sharp(bytes, { limitInputPixels: INPUT_PIXEL_LIMIT }).metadata().catch(() => null);
    return { bytes, ext: undefined, width: meta?.width, height: meta?.height, sourceWidth: meta?.width, sourceHeight: meta?.height, transparent: false, alpha: 'none', warnings };
  }
  const hadAlpha = (await sharp(bytes, { limitInputPixels: INPUT_PIXEL_LIMIT }).metadata()).hasAlpha === true;
  const decoded = await sharp(bytes, { limitInputPixels: INPUT_PIXEL_LIMIT }).toColourspace('srgb').ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  const data = decoded.data;
  let alpha: ShapedImage['alpha'] = 'none';
  if (plan.transparent) {
    if (hasNativeAlpha(data, width, height)) {
      alpha = 'native';
    } else {
      alpha = 'keyed';
      const { uniform } = keyOutBorderBackground(data, width, height, plan.keyColor);
      if (!uniform) warnings.push('the generated background was not one flat color; parts of it may remain opaque');
    }
  }
  let pipeline = sharp(data, { raw: { width, height, channels: 4 } });
  if (plan.transparent && plan.size) {
    // Fit the subject itself into the requested size, not the empty margin around it.
    const bounds = alphaBounds(data, width, height);
    if (bounds && (bounds.width < width || bounds.height < height)) {
      pipeline = sharp(await pipeline.extract(bounds).png().toBuffer());
    }
  }
  if (plan.size) {
    pipeline = pipeline.resize(plan.size.width, plan.size.height, {
      fit: plan.transparent ? 'contain' : 'cover',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: plan.pixelArt ? 'nearest' : 'lanczos3',
    });
  }
  // An opaque render stays opaque; only a transparent request adds alpha.
  if (!plan.transparent && !hadAlpha) pipeline = pipeline.removeAlpha();
  const output = await pipeline.png().toBuffer({ resolveWithObject: true });
  return {
    bytes: output.data,
    ext: '.png',
    width: output.info.width,
    height: output.info.height,
    sourceWidth: width,
    sourceHeight: height,
    transparent: plan.transparent,
    alpha,
    warnings,
  };
}
