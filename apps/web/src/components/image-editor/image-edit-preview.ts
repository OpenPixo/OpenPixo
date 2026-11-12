import type { ImageEditOp } from '@openpixo/contracts';

export interface ImageSize { width: number; height: number }
export interface CropRect extends ImageSize { x: number; y: number }
export type CropHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const MAX_IMAGE_SIZE = 8192;
export const fullCrop = ({ width, height }: ImageSize): CropRect => ({ x: 0, y: 0, width, height });
export const powerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(1, value)));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

export function constrainCrop(rect: CropRect, size: ImageSize): CropRect {
  const x = clamp(rect.x, 0, size.width - 1), y = clamp(rect.y, 0, size.height - 1);
  return { x, y, width: clamp(rect.width, 1, size.width - x), height: clamp(rect.height, 1, size.height - y) };
}

/** Drag coordinates are image pixels, independent of the viewport zoom. */
export function dragCrop(start: CropRect, handle: CropHandle, dx: number, dy: number, size: ImageSize, aspect: number | null): CropRect {
  if (handle === 'move') return { ...start, x: clamp(start.x + dx, 0, size.width - start.width), y: clamp(start.y + dy, 0, size.height - start.height) };
  const left = handle.includes('w'), top = handle.includes('n');
  let width = start.width + (left ? -dx : handle.includes('e') ? dx : 0);
  let height = start.height + (top ? -dy : handle.includes('s') ? dy : 0);
  const anchorX = left ? start.x + start.width : start.x, anchorY = top ? start.y + start.height : start.y;
  const maxWidth = left ? anchorX : size.width - anchorX, maxHeight = top ? anchorY : size.height - anchorY;
  if (aspect) {
    if (handle === 'n' || handle === 's' || Math.abs(dy) > Math.abs(dx)) width = height * aspect;
    else height = width / aspect;
    const fit = Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height));
    width *= fit; height *= fit;
  }
  width = clamp(width, 1, maxWidth); height = clamp(height, 1, maxHeight);
  return { x: left ? anchorX - width : start.x, y: top ? anchorY - height : start.y, width, height };
}

export function imageEditSize(size: ImageSize, op: ImageEditOp): ImageSize {
  switch (op.op) {
    case 'crop': return { width: op.width, height: op.height };
    case 'resize': {
      const width = op.scale !== undefined ? Math.max(1, Math.round(size.width * op.scale)) : op.width ?? Math.max(1, Math.round(size.width * (op.height ?? size.height) / size.height));
      const height = op.scale !== undefined ? Math.max(1, Math.round(size.height * op.scale)) : op.height ?? Math.max(1, Math.round(size.height * width / size.width));
      return { width, height };
    }
    case 'pad': return op.powerOfTwo ? { width: powerOfTwo(size.width), height: powerOfTwo(size.height) } : { width: op.width ?? size.width, height: op.height ?? size.height };
    case 'rotate': return { width: size.height, height: size.width };
    default: return size;
  }
}

function canvas(size: ImageSize, original = false): HTMLCanvasElement {
  if (size.width < 1 || size.height < 1 || (!original && (size.width > MAX_IMAGE_SIZE || size.height > MAX_IMAGE_SIZE)) || size.width * size.height > 64_000_000 || !Number.isInteger(size.width) || !Number.isInteger(size.height)) throw new Error('image-size');
  const output = document.createElement('canvas'); output.width = size.width; output.height = size.height;
  return output;
}
function context(output: HTMLCanvasElement) {
  const ctx = output.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas-unavailable');
  return ctx;
}

export function imageToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const output = canvas({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }, true);
  context(output).drawImage(image, 0, 0);
  return output;
}

/** Every operation materializes a fresh canvas so later operations see the preceding result. */
export function renderImageEdit(source: HTMLCanvasElement, op: ImageEditOp): HTMLCanvasElement {
  if (op.op === 'trim') {
    const data = context(source).getImageData(0, 0, source.width, source.height).data;
    let left = source.width, top = source.height, right = -1, bottom = -1;
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      if (data[(y * source.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    return renderImageEdit(source, { op: 'crop', x: right < 0 ? 0 : left, y: bottom < 0 ? 0 : top, width: right < 0 ? 1 : right - left + 1, height: bottom < 0 ? 1 : bottom - top + 1 });
  }
  const size = imageEditSize(source, op), output = canvas(size), ctx = context(output);
  switch (op.op) {
    case 'crop': ctx.drawImage(source, op.x, op.y, op.width, op.height, 0, 0, size.width, size.height); break;
    case 'resize': ctx.imageSmoothingEnabled = op.filter !== 'nearest'; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(source, 0, 0, size.width, size.height); break;
    case 'pad': ctx.drawImage(source, Math.floor((size.width - source.width) / 2), Math.floor((size.height - source.height) / 2)); break;
    case 'flip': ctx.translate(op.axis === 'h' ? size.width : 0, op.axis === 'v' ? size.height : 0); ctx.scale(op.axis === 'h' ? -1 : 1, op.axis === 'v' ? -1 : 1); ctx.drawImage(source, 0, 0); break;
    case 'rotate': ctx.translate(size.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(source, 0, 0); break;
  }
  return output;
}

export function defaultImageOutput(path: string, operation: ImageEditOp['op'] = 'crop') {
  const file = path.split(/[\\/]/).pop() ?? 'image';
  return `${file.replace(/\.[^.]+$/, '')}_${operation}.png`;
}