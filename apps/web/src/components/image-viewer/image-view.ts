/**
 * Pure geometry for the file viewer's image view: zoom levels, panning,
 * the pixel under the pointer, and stepping through sibling images.
 *
 * A view is the image's on-screen scale plus the viewport position of its
 * top-left corner. Everything here is in CSS pixels of the viewport.
 */

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface ImageView { scale: number; x: number; y: number }

/**
 * Zoom stops. Above 100% every stop is a whole number so each source pixel
 * covers the same number of screen pixels and pixel art stays even.
 */
export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64] as const;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 64;
/** The pixel grid is drawn from this scale up; below it the lines would bury the image. */
export const PIXEL_GRID_MIN_SCALE = 8;
/** Space kept around a fitted image. */
export const FIT_PADDING = 24;
/** How much of the image must stay inside the viewport while panning. */
const PAN_KEEP_VISIBLE = 32;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * The largest scale that shows the whole image inside the viewport. A small
 * image is enlarged to fill it, but only by a whole number, so a 16 px sprite
 * fits at a crisp 30x rather than a smeared 31.4x.
 */
export function fitScale(image: Size, viewport: Size, padding = FIT_PADDING): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  const room = {
    width: Math.max(1, viewport.width - padding * 2),
    height: Math.max(1, viewport.height - padding * 2),
  };
  const raw = Math.min(room.width / image.width, room.height / image.height);
  return clampZoom(raw >= 1 ? Math.floor(raw) : raw);
}

/** The next zoom stop above (`1`) or below (`-1`) the current scale. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > scale + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((step) => step < scale - 1e-6) ?? MIN_ZOOM;
}

/** A view of the image at `scale`, centred in the viewport and snapped to whole pixels. */
export function centeredView(image: Size, viewport: Size, scale: number): ImageView {
  return {
    scale,
    x: Math.round((viewport.width - image.width * scale) / 2),
    y: Math.round((viewport.height - image.height * scale) / 2),
  };
}

/** Change the scale while keeping the image point under `anchor` where it is. */
export function zoomAt(view: ImageView, scale: number, anchor: Point, image: Size, viewport: Size): ImageView {
  const next = clampZoom(scale);
  const ratio = next / view.scale;
  return clampPan({
    scale: next,
    x: Math.round(anchor.x - (anchor.x - view.x) * ratio),
    y: Math.round(anchor.y - (anchor.y - view.y) * ratio),
  }, image, viewport);
}

/** Keep part of the image on screen so a drag can never lose it. */
export function clampPan(view: ImageView, image: Size, viewport: Size): ImageView {
  const width = image.width * view.scale;
  const height = image.height * view.scale;
  const keepX = Math.min(PAN_KEEP_VISIBLE, width);
  const keepY = Math.min(PAN_KEEP_VISIBLE, height);
  return {
    scale: view.scale,
    x: Math.min(viewport.width - keepX, Math.max(keepX - width, view.x)),
    y: Math.min(viewport.height - keepY, Math.max(keepY - height, view.y)),
  };
}

/** The source pixel under a viewport point, or null when the point is off the image. */
export function pixelAt(view: ImageView, point: Point, image: Size): Point | null {
  const x = Math.floor((point.x - view.x) / view.scale);
  const y = Math.floor((point.y - view.y) / view.scale);
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  return { x, y };
}

/** `#rrggbb`, or `#rrggbbaa` when the pixel is not fully opaque. */
export function formatHexColor(r: number, g: number, b: number, a = 255): string {
  const hex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a >= 255 ? '' : hex(a)}`;
}

/** The scale as the label a person reads, e.g. `25%`, `100%`, `800%`. */
export function formatZoom(scale: number): string {
  const percent = scale * 100;
  return `${percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10}%`;
}

const RASTER_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|avif|ico|tga)$/i;

function folderOf(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash < 0 ? '' : name.slice(0, slash);
}

export interface SiblingImages { index: number; total: number; previous: string | null; next: string | null }

/**
 * The raster images in the same folder as `current`, in the order a file
 * browser lists them (numbers compared as numbers, so `walk_2` precedes
 * `walk_10`). Stepping wraps at both ends. Folders deeper or shallower than
 * the current one are not included.
 */
export function siblingImages(names: readonly string[], current: string): SiblingImages {
  const folder = folderOf(current);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const siblings = names
    .filter((name) => folderOf(name) === folder && RASTER_EXTENSIONS.test(name))
    .sort(collator.compare);
  const index = siblings.indexOf(current);
  if (index < 0 || siblings.length < 2) {
    return { index: Math.max(0, index), total: Math.max(1, siblings.length), previous: null, next: null };
  }
  return {
    index,
    total: siblings.length,
    previous: siblings[(index - 1 + siblings.length) % siblings.length]!,
    next: siblings[(index + 1) % siblings.length]!,
  };
}
