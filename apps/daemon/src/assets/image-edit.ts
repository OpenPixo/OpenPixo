import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { EditProjectImageRequest, ImageEditOp } from '@openpixo/contracts';
import { assetRelPath } from './paths.js';
import { assetPath, hashFile, publishFiles, writeNew } from './ops/files.js';
import { image, imageResizeDimensions, transparentImageBounds } from './ops/images.js';
import sharp from 'sharp';

const MAX_DIMENSION = 8192;

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid image edit operation');
  return value as Record<string, unknown>;
}
function integer(value: unknown, key: string, minimum = 1, maximum = MAX_DIMENSION): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

/** Reject unsupported fields and values before any file is read or written. */
export function parseImageEditRequest(value: unknown): EditProjectImageRequest {
  const body = record(value, ['source', 'ops', 'output']);
  const source = assetRelPath(body.source), output = assetRelPath(body.output);
  if (path.posix.extname(output).toLowerCase() !== '.png') throw new Error('Image edit output must have a .png extension');
  if (!Array.isArray(body.ops) || !body.ops.length || body.ops.length > 64) throw new Error('Pass 1 to 64 image edit operations');
  const ops = body.ops.map((value): ImageEditOp => {
    const op = record(value, ['op', 'x', 'y', 'width', 'height', 'scale', 'filter', 'powerOfTwo', 'axis', 'degrees']);
    switch (op.op) {
      case 'crop':
        record(op, ['op', 'x', 'y', 'width', 'height']);
        return { op: 'crop', x: integer(op.x, 'x', 0, Number.MAX_SAFE_INTEGER), y: integer(op.y, 'y', 0, Number.MAX_SAFE_INTEGER),
          width: integer(op.width, 'width'), height: integer(op.height, 'height') };
      case 'resize': {
        record(op, ['op', 'width', 'height', 'scale', 'filter']);
        if (op.scale !== undefined && (typeof op.scale !== 'number' || !Number.isFinite(op.scale) || op.scale < 0.001 || op.scale > MAX_DIMENSION)) throw new Error('scale must be a positive multiplier');
        if ((op.width === undefined && op.height === undefined && op.scale === undefined)
          || (op.scale !== undefined && (op.width !== undefined || op.height !== undefined))) throw new Error('resize requires scale or width/height');
        if (op.filter !== undefined && op.filter !== 'nearest' && op.filter !== 'smooth') throw new Error('filter must be nearest or smooth');
        return { op: 'resize', ...(op.width !== undefined ? { width: integer(op.width, 'width') } : {}),
          ...(op.height !== undefined ? { height: integer(op.height, 'height') } : {}),
          ...(op.scale !== undefined ? { scale: op.scale as number } : {}),
          ...(op.filter !== undefined ? { filter: op.filter as 'nearest' | 'smooth' } : {}) };
      }
      case 'trim': record(op, ['op']); return { op: 'trim' };
      case 'pad': {
        record(op, ['op', 'width', 'height', 'powerOfTwo']);
        if (op.powerOfTwo === true) {
          if (op.width !== undefined || op.height !== undefined) throw new Error('Use powerOfTwo or width/height, not both');
          return { op: 'pad', powerOfTwo: true };
        }
        if (op.powerOfTwo !== undefined) throw new Error('powerOfTwo must be true');
        return { op: 'pad', width: integer(op.width, 'width'), height: integer(op.height, 'height') };
      }
      case 'flip':
        record(op, ['op', 'axis']);
        if (op.axis !== 'h' && op.axis !== 'v') throw new Error('flip axis must be h or v');
        return { op: 'flip', axis: op.axis };
      case 'rotate':
        record(op, ['op', 'degrees']);
        if (op.degrees !== 90) throw new Error('rotate supports 90 degrees clockwise');
        return { op: 'rotate', degrees: 90 };
      default: throw new Error('Unknown image edit operation');
    }
  });
  return { source, output, ops };
}

export interface ImageEditResult {
  source: string;
  sourceSha256: string;
  output: string;
  outputSha256: string;
  width: number;
  height: number;
  ops: ImageEditOp[];
}

/** Applies each transform to the previous result; Sharp coalesces repeated pipeline operations otherwise. */
export async function runImageEdit(projectRoot: string, value: unknown): Promise<ImageEditResult> {
  const request = parseImageEditRequest(value);
  const file = await assetPath(projectRoot, request.source);
  if (!(await stat(file)).isFile()) throw new Error('Input must be a regular file');
  const original = await readFile(file);
  const sourceSha256 = createHash('sha256').update(original).digest('hex');
  const metadata = await image(original).metadata();
  let width = metadata.width, height = metadata.height;
  if (!width || !height) throw new Error('Image has no dimensions');
  if ((metadata.pages ?? 1) > 1) throw new Error('Animated images are not supported by this operation');
  const output = request.output.includes('/') ? request.output : path.posix.join(path.posix.dirname(request.source), request.output);
  const hashes = await publishFiles(projectRoot, [output], async ([target]) => {
    let buffer: Buffer = original;
    // Browser image decoding honors EXIF; crop coordinates must describe that same visible image.
    if (metadata.orientation && metadata.orientation !== 1) {
      buffer = await image(original).autoOrient().png().toBuffer();
      const oriented = await image(buffer).metadata();
      width = oriented.width!; height = oriented.height!;
    }
    for (const op of request.ops) {
      let transform = image(buffer);
      switch (op.op) {
        case 'crop':
          if (op.x + op.width > width! || op.y + op.height > height!) throw new Error('Crop rectangle extends outside the image');
          transform = transform.extract({ left: op.x, top: op.y, width: op.width, height: op.height });
          width = op.width; height = op.height;
          break;
        case 'resize': {
          const dimensions = imageResizeDimensions(width!, height!, op);
          width = dimensions.width; height = dimensions.height;
          transform = transform.resize({ width, height, fit: 'fill', kernel: op.filter === 'nearest' ? sharp.kernel.nearest : sharp.kernel.lanczos3 });
          break;
        }
        case 'trim': {
          const data = await transform.ensureAlpha().raw().toBuffer();
          const bounds = transparentImageBounds(data, width!, height!);
          width = bounds.width; height = bounds.height;
          transform = image(buffer).extract(bounds);
          break;
        }
        case 'pad': {
          const outputWidth = op.powerOfTwo ? 2 ** Math.ceil(Math.log2(width!)) : op.width!;
          const outputHeight = op.powerOfTwo ? 2 ** Math.ceil(Math.log2(height!)) : op.height!;
          if (outputWidth < width! || outputHeight < height!) throw new Error('Canvas size must not be smaller than the image');
          const left = Math.floor((outputWidth - width!) / 2), top = Math.floor((outputHeight - height!) / 2);
          transform = transform.ensureAlpha().extend({ left, top, right: outputWidth - width! - left, bottom: outputHeight - height! - top,
            background: { r: 0, g: 0, b: 0, alpha: 0 } });
          width = outputWidth; height = outputHeight;
          break;
        }
        case 'flip': transform = op.axis === 'h' ? transform.flop() : transform.flip(); break;
        case 'rotate': transform = transform.rotate(90); [width, height] = [height, width]; break;
      }
      if (width! > MAX_DIMENSION || height! > MAX_DIMENSION) throw new Error('Output dimensions exceed 8192');
      buffer = await transform.png().toBuffer();
    }
    // Publish only if the path still resolves safely and its source bytes are unchanged.
    if (await hashFile(await assetPath(projectRoot, request.source)) !== sourceSha256) throw new Error('Original changed during processing; retry');
    await writeNew(target!, buffer);
  });
  return { source: request.source, sourceSha256, output, outputSha256: hashes[output]!, width: width!, height: height!, ops: request.ops };
}
