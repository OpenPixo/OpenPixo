import sharp from 'sharp';

/**
 * Deterministic geometry for sprite frames and sheet pieces: what is drawn where,
 * and how to put every frame of an animation on one canvas with one scale and the
 * feet on one line. No model calls. A model that cannot see images judges frames
 * from `measureFrame` and `summarizeFrames`, so their numbers and sentences are the
 * contract; the cut in `pixo media generate --sheet` and `pixo asset frames` share it.
 */

/** Straight (not premultiplied) RGBA pixels. */
export interface Rgba { data: Buffer; width: number; height: number }

export interface FrameRect { left: number; top: number; width: number; height: number }

export interface FrameMeasure {
  width: number;
  height: number;
  /** Nothing visible: fewer opaque pixels than a speck. */
  empty: boolean;
  /** The drawn subject's box, or null when empty. */
  bounds: FrameRect | null;
  /** Rows of transparent space under the subject (0 = feet on the bottom edge). */
  bottomGap: number | null;
  /** Horizontal centre of the subject's lowest rows: where it stands, which a swung arm or weapon does not move. */
  feetX: number | null;
  /** The subject touches any edge of the frame, the bottom included. */
  touchesEdge: boolean;
}

/** Alpha above this counts as drawn; below it is keyed-out fringe. */
const ALPHA_DRAWN = 8;
/** The bottom share of the subject that counts as its feet. */
const FEET_SHARE = 0.15;

export async function readRgba(input: Buffer | string): Promise<Rgba> {
  const { data, info } = await sharp(input, { limitInputPixels: 64 * 1024 * 1024 }).toColourspace('srgb').ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function encodePng(image: Rgba): Promise<Buffer> {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer();
}

export function blankRgba(width: number, height: number): Rgba {
  return { data: Buffer.alloc(width * height * 4), width, height };
}

export function cropRgba(image: Rgba, rect: FrameRect): Rgba {
  const out = blankRgba(rect.width, rect.height);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.top + y) * image.width + rect.left) * 4;
    image.data.copy(out.data, y * rect.width * 4, from, from + rect.width * 4);
  }
  return out;
}

/** Copies `source` onto `target` at (left, top), clipping whatever falls outside. */
export function blitRgba(target: Rgba, source: Rgba, left: number, top: number): void {
  for (let y = 0; y < source.height; y++) {
    const ty = top + y;
    if (ty < 0 || ty >= target.height) continue;
    const x0 = Math.max(0, -left), x1 = Math.min(source.width, target.width - left);
    if (x1 <= x0) continue;
    const from = (y * source.width + x0) * 4;
    source.data.copy(target.data, (ty * target.width + left + x0) * 4, from, (y * source.width + x1) * 4);
  }
}

export async function resizeRgba(image: Rgba, width: number, height: number, pixelArt: boolean): Promise<Rgba> {
  if (width === image.width && height === image.height) return image;
  const data = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .resize(width, height, { fit: 'fill', kernel: pixelArt ? 'nearest' : 'lanczos3' }).raw().toBuffer();
  return { data, width, height };
}

export function measureFrame(image: Rgba): FrameMeasure {
  const { data, width, height } = image;
  let left = width, top = height, right = -1, bottom = -1, drawn = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3]! > ALPHA_DRAWN) {
      drawn++;
      if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
    }
  }
  if (right < 0 || drawn < Math.max(4, width * height * 0.0005)) {
    return { width, height, empty: true, bounds: null, bottomGap: null, feetX: null, touchesEdge: false };
  }
  const bounds = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const feetTop = bottom - Math.max(0, Math.ceil(bounds.height * FEET_SHARE) - 1);
  let sum = 0, count = 0;
  for (let y = feetTop; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (data[(y * width + x) * 4 + 3]! > ALPHA_DRAWN) { sum += x + 0.5; count++; }
  }
  return {
    width, height, empty: false, bounds, bottomGap: height - 1 - bottom,
    feetX: Math.round((count ? sum / count : left + bounds.width / 2) * 10) / 10,
    touchesEdge: left === 0 || top === 0 || right === width - 1 || bottom === height - 1,
  };
}

/**
 * One piece of a sheet fitted on its own: its drawing cropped and fitted, centred,
 * into the final size, the way a single generated image is. Without a size the cell
 * is kept as cut. An opaque piece is filled to the size instead.
 */
export async function fitPiece(cell: Rgba, size: { width: number; height: number } | null, transparent: boolean, pixelArt: boolean): Promise<Rgba> {
  if (!size) return cell;
  const kernel = pixelArt ? 'nearest' : 'lanczos3';
  if (!transparent) {
    const data = await sharp(cell.data, { raw: { width: cell.width, height: cell.height, channels: 4 } })
      .resize(size.width, size.height, { fit: 'cover', position: 'centre', kernel }).raw().toBuffer();
    return { data, width: size.width, height: size.height };
  }
  const bounds = measureFrame(cell).bounds;
  if (!bounds) return blankRgba(size.width, size.height);
  const data = await sharp(cropRgba(cell, bounds).data, { raw: { width: bounds.width, height: bounds.height, channels: 4 } })
    .resize(size.width, size.height, { fit: 'contain', position: 'centre', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel }).raw().toBuffer();
  return { data, width: size.width, height: size.height };
}

export interface AlignFramesOptions {
  /** Final canvas for every frame. Absent: the smallest canvas that holds them all at their own scale. */
  canvas?: { width: number; height: number } | undefined;
  /** Transparent pixels kept around the drawing on each side; the feet sit this far above the bottom. */
  padding?: number | undefined;
  /** Scale each frame's drawing to the frames' median height first, for a sheet whose character grows and shrinks. */
  matchHeight?: boolean | undefined;
  pixelArt?: boolean | undefined;
}

export interface AlignedFrames {
  frames: Rgba[];
  canvas: { width: number; height: number };
  /** The one scale applied to every frame to fit the canvas (1 when no canvas was given). */
  scale: number;
  measures: FrameMeasure[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Puts every frame on the same canvas with one scale, standing on one line at the
 * bottom centre: each drawing is placed so its feet (`feetX`) are on the canvas's
 * centre line and its lowest row `padding` above the bottom. The same scale for all
 * keeps a crouch shorter than a stand; `matchHeight` evens out a model's drift first.
 */
export async function alignFrames(frames: Rgba[], options: AlignFramesOptions = {}): Promise<AlignedFrames> {
  const padding = options.padding ?? 0;
  const pixelArt = options.pixelArt === true;
  const measures = frames.map(measureFrame);
  const drawn = measures.filter((measure) => !measure.empty);
  const heightTarget = options.matchHeight && drawn.length ? median(drawn.map((measure) => measure.bounds!.height)) : null;
  const own = measures.map((measure) => (heightTarget && measure.bounds ? heightTarget / measure.bounds.height : 1));
  let halfWidth = 0, subjectHeight = 0;
  measures.forEach((measure, index) => {
    if (!measure.bounds) return;
    const k = own[index]!;
    halfWidth = Math.max(halfWidth, k * (measure.feetX! - measure.bounds.left), k * (measure.bounds.left + measure.bounds.width - measure.feetX!));
    subjectHeight = Math.max(subjectHeight, k * measure.bounds.height);
  });
  const canvas = options.canvas ?? {
    width: Math.max(1, Math.ceil(2 * halfWidth) + 2 * padding),
    height: Math.max(1, Math.ceil(subjectHeight) + 2 * padding),
  };
  const scale = options.canvas && drawn.length
    ? Math.min((canvas.width - 2 * padding) / Math.max(1, 2 * halfWidth), (canvas.height - 2 * padding) / Math.max(1, subjectHeight))
    : 1;
  if (!(scale > 0)) throw new Error('padding leaves no room for the frames on this canvas');
  const out: Rgba[] = [];
  for (let index = 0; index < frames.length; index++) {
    const measure = measures[index]!;
    const target = blankRgba(canvas.width, canvas.height);
    if (measure.bounds) {
      const k = own[index]! * scale;
      const piece = await resizeRgba(cropRgba(frames[index]!, measure.bounds),
        Math.max(1, Math.round(measure.bounds.width * k)), Math.max(1, Math.round(measure.bounds.height * k)), pixelArt);
      blitRgba(target, piece, Math.round(canvas.width / 2 - (measure.feetX! - measure.bounds.left) * k), canvas.height - padding - piece.height);
    }
    out.push(target);
  }
  return { frames: out, canvas, scale: Math.round(scale * 10000) / 10000, measures };
}

export interface FramesSummary {
  frames: number;
  /** Every frame has the same pixel size. */
  sameCanvas: boolean;
  /** 1-based frame numbers. */
  emptyFrames: number[];
  /** Frames whose drawing touches the top or a side; the bottom is where the feet stand. */
  edgeFrames: number[];
  /** How far the feet move up and down between frames, in pixels. */
  baselineSpreadPx: number;
  /** How far the feet move sideways between frames, in pixels. */
  feetXSpreadPx: number;
  /** Tallest drawing against the shortest, as a percentage of the median height. */
  heightDriftPercent: number;
  widthDriftPercent: number;
  /** Plain sentences, one per problem found; empty when the frames hold steady. */
  issues: string[];
  ok: boolean;
}

function spread(values: { frame: number; value: number }[]): { size: number; low: number; high: number } {
  let low = values[0]!, high = values[0]!;
  for (const entry of values) { if (entry.value < low.value) low = entry; if (entry.value > high.value) high = entry; }
  return { size: Math.round((high.value - low.value) * 10) / 10, low: low.frame, high: high.frame };
}

/** Whether a set of frames will play as one steady animation, in numbers and in sentences. */
export function summarizeFrames(measures: FrameMeasure[]): FramesSummary {
  const issues: string[] = [];
  const sizes = [...new Set(measures.map((measure) => `${measure.width}x${measure.height}`))];
  const sameCanvas = sizes.length === 1;
  if (!sameCanvas) issues.push(`The frames are different sizes (${sizes.join(', ')}); align them so they share one canvas.`);
  const emptyFrames = measures.flatMap((measure, index) => (measure.empty ? [index + 1] : []));
  for (const frame of emptyFrames) issues.push(`Frame ${frame} is empty.`);
  // Feet on the bottom edge are where an aligned sprite stands; the other three edges cut it off.
  const edgeFrames = measures.flatMap((measure, index) => (measure.bounds && (measure.bounds.left === 0 || measure.bounds.top === 0
    || measure.bounds.left + measure.bounds.width === measure.width) ? [index + 1] : []));
  for (const frame of edgeFrames) issues.push(`Frame ${frame} touches its top or side edge, so part of the drawing may be cut off.`);
  const drawn = measures.map((measure, index) => ({ measure, frame: index + 1 })).filter((entry) => entry.measure.bounds);
  const canvasHeight = Math.max(...measures.map((measure) => measure.height));
  const canvasWidth = Math.max(...measures.map((measure) => measure.width));
  let baselineSpreadPx = 0, feetXSpreadPx = 0, heightDriftPercent = 0, widthDriftPercent = 0;
  if (drawn.length >= 2) {
    // Measured against each frame's own canvas, so differently sized frames still compare by where the feet stand.
    const baseline = spread(drawn.map(({ measure, frame }) => ({ frame, value: measure.bottomGap! })));
    const feet = spread(drawn.map(({ measure, frame }) => ({ frame, value: measure.feetX! - measure.width / 2 })));
    const heights = spread(drawn.map(({ measure, frame }) => ({ frame, value: measure.bounds!.height })));
    const widths = spread(drawn.map(({ measure, frame }) => ({ frame, value: measure.bounds!.width })));
    const mid = median(drawn.map(({ measure }) => measure.bounds!.height));
    const midWidth = median(drawn.map(({ measure }) => measure.bounds!.width));
    baselineSpreadPx = baseline.size;
    feetXSpreadPx = feet.size;
    heightDriftPercent = Math.round((heights.size / mid) * 1000) / 10;
    widthDriftPercent = Math.round((widths.size / midWidth) * 1000) / 10;
    if (baseline.size > Math.max(2, canvasHeight * 0.03)) {
      issues.push(`The feet move up and down by ${baseline.size} px (frame ${baseline.low} lowest, frame ${baseline.high} highest); align the frames to put them on one line.`);
    }
    if (feet.size > Math.max(2, canvasWidth * 0.05)) {
      issues.push(`The character slides sideways by ${feet.size} px (frames ${feet.low} and ${feet.high}); align the frames to centre them.`);
    }
    if (heightDriftPercent > 15) {
      issues.push(`The drawing's height changes by ${heightDriftPercent}% (frame ${heights.low} shortest, frame ${heights.high} tallest). Fine for a crouch, squash or jump; otherwise the model drifted: remake the sheet, or align with match-height.`);
    }
  }
  return { frames: measures.length, sameCanvas, emptyFrames, edgeFrames, baselineSpreadPx, feetXSpreadPx, heightDriftPercent, widthDriftPercent, issues, ok: issues.length === 0 };
}

/** Even cell boundaries for a grid over a render of any size. */
export function sheetCells(width: number, height: number, columns: number, rows: number): FrameRect[] {
  const cells: FrameRect[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const left = Math.round((column * width) / columns), top = Math.round((row * height) / rows);
    cells.push({ left, top, width: Math.round(((column + 1) * width) / columns) - left, height: Math.round(((row + 1) * height) / rows) - top });
  }
  return cells;
}
