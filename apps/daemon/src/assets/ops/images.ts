import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { AssetOpName } from '@openpixo/contracts';
import { assetPath, choiceParam, integerParam, numberParam, writeNew } from './files.js';

export interface OpPlan {
  outputs: string[];
  detail?: Record<string, unknown>;
  produce: (temporaryPaths: string[]) => Promise<void>;
}

export const image = (input: string | Buffer) => sharp(input, { limitInputPixels: 64 * 1024 * 1024 }).toColourspace('srgb');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export const outputStem = (out: string, source: string) => path.posix.join(out, source.slice(0, source.length - path.posix.extname(source).length));

/** Shared resize geometry for batch processing and the ordered image editor. */
export function imageResizeDimensions(width: number, height: number, params: Record<string, unknown>): { width: number; height: number; resize: { width?: number; height?: number } } {
  if (params.width === undefined && params.height === undefined && params.scale === undefined) throw new Error('resize requires width, height, or scale');
  if (params.scale !== undefined && (params.width !== undefined || params.height !== undefined)) throw new Error('Use scale or width/height, not both');
  const scale = params.scale === undefined ? undefined : numberParam(params, 'scale', undefined, 0.001, 8192);
  const w = params.width === undefined ? (scale === undefined ? undefined : Math.max(1, Math.round(width * scale))) : integerParam(params, 'width', undefined, 1);
  const h = params.height === undefined ? (scale === undefined ? undefined : Math.max(1, Math.round(height * scale))) : integerParam(params, 'height', undefined, 1);
  const outputWidth = w ?? Math.max(1, Math.round(width * h! / height));
  const outputHeight = h ?? Math.max(1, Math.round(height * w! / width));
  if (outputWidth > 8192 || outputHeight > 8192) throw new Error('Output dimensions exceed 8192');
  return { width: outputWidth, height: outputHeight, resize: { ...(w !== undefined ? { width: w } : {}), ...(h !== undefined ? { height: h } : {}) } };
}

/** Alpha, rather than corner color, defines transparent sprite borders. */
export function transparentImageBounds(data: Uint8Array, width: number, height: number) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  return right < 0 ? { left: 0, top: 0, width: 1, height: 1 } : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

type RGB = [number, number, number];
const PRESETS: Record<string, string[]> = {
  gameboy: ['0f380f', '306230', '8bac0f', '9bbc0f'],
  grayscale: ['000000', '555555', 'aaaaaa', 'ffffff'],
  pico8: ['000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8', 'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa'],
};

function rgb(hex: string): RGB {
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) throw new Error('color must be six hex digits');
  const value = hex.replace(/^#/, '');
  return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16)) as RGB;
}
const hex = (color: RGB) => color.map(value => value.toString(16).padStart(2, '0')).join('');

async function readPalette(root: string, value: unknown): Promise<RGB[] | undefined> {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (!value.length || value.length > 256 || value.some(color => typeof color !== 'string')) throw new Error('Palette must contain 1–256 hex colors');
    return value.map(color => rgb(color as string));
  }
  if (typeof value !== 'string') throw new Error('palette must be a preset or a project-relative .gpl/.hex file');
  const preset = PRESETS[value === 'pico-8' ? 'pico8' : value];
  if (preset) return preset.map(rgb);
  const extension = path.extname(value).toLowerCase();
  if (!['.gpl', '.hex'].includes(extension)) throw new Error('Unknown palette; use gameboy, pico8, grayscale, or a .gpl/.hex file');
  const text = await readFile(await assetPath(root, value), 'utf8');
  const colors: RGB[] = [];
  for (const line of text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    if (extension === '.hex') colors.push(rgb(line));
    else {
      if (/^(GIMP Palette|Name:|Columns:|#)/.test(line)) continue;
      const match = /^(\d+)\s+(\d+)\s+(\d+)(?:\s|$)/.exec(line);
      if (!match) throw new Error('Invalid GIMP palette entry');
      const color = match.slice(1).map(Number) as RGB;
      if (color.some(channel => channel > 255)) throw new Error('Palette channels must be 0–255');
      colors.push(color);
    }
  }
  if (colors.length < 1 || colors.length > 256) throw new Error('Palette must contain 1–256 colors');
  return colors;
}

function pair(value: unknown, key: string): [number, number] {
  const match = typeof value === 'string' ? /^(\d+)[xX](\d+)$/.exec(value) : null;
  if (!match) throw new Error(`${key} must have the form WxH`);
  const result = [Number(match[1]), Number(match[2])] as [number, number];
  if (result.some(value => value < 1 || value > 8192)) throw new Error(`${key} dimensions must be 1–8192`);
  return result;
}

export async function planImageOp(root: string, source: string, file: string, op: AssetOpName, params: Record<string, unknown>, out: string): Promise<OpPlan> {
  if (op === 'remove-bg' && params.mode === 'model') throw new Error('remove-bg mode model is not supported yet; use chroma (provider path deferred)');
  const metadata = await image(file).metadata();
  const width = metadata.width, height = metadata.height;
  if (!width || !height) throw new Error('Image has no dimensions');
  if ((metadata.pages ?? 1) > 1) throw new Error('Animated images are not supported by this operation');
  const stem = outputStem(out, source);
  const primary = `${stem}.png`;
  switch (op) {
    case 'resize': {
      const filter = choiceParam(params, 'filter', ['nearest', 'lanczos'] as const, 'lanczos');
      const dimensions = imageResizeDimensions(width, height, params);
      return { outputs: [primary], produce: async ([target]) => {
        await writeNew(target!, await image(file).resize({ ...dimensions.resize, fit: 'fill', kernel: filter === 'nearest' ? sharp.kernel.nearest : sharp.kernel.lanczos3 }).png().toBuffer());
      } };
    }
    case 'trim': {
      const padding = integerParam(params, 'padding', 0, 0, 4096);
      const { data } = await image(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const bounds = transparentImageBounds(data, width, height);
      if (bounds.width + padding * 2 > 8192 || bounds.height + padding * 2 > 8192) throw new Error('Padded image exceeds 8192');
      return { outputs: [primary], detail: { bounds, padding }, produce: async ([target]) => {
        await writeNew(target!, await image(file).extract(bounds).extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
      } };
    }
    case 'slice': {
      if ((params.grid === undefined) === (params.cell === undefined)) throw new Error('slice requires exactly one of grid or cell');
      const margin = integerParam(params, 'margin', 0), spacing = integerParam(params, 'spacing', 0);
      let columns: number, rows: number, cellWidth: number, cellHeight: number;
      if (params.grid !== undefined) {
        [columns, rows] = pair(params.grid, 'grid');
        cellWidth = (width - 2 * margin - (columns - 1) * spacing) / columns;
        cellHeight = (height - 2 * margin - (rows - 1) * spacing) / rows;
        if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) throw new Error('Grid does not divide the image exactly with this margin/spacing');
      } else {
        [cellWidth, cellHeight] = pair(params.cell, 'cell');
        columns = Math.floor((width - 2 * margin + spacing) / (cellWidth + spacing));
        rows = Math.floor((height - 2 * margin + spacing) / (cellHeight + spacing));
      }
      if (cellWidth < 1 || cellHeight < 1 || columns < 1 || rows < 1 || columns * rows > 4096) throw new Error('Slice must produce 1–4096 nonempty frames');
      const frameColumns = integerParam(params, 'frameColumns', columns, 1, columns);
      const frames = Array.from({ length: frameColumns * rows }, (_, index) => ({
        path: `${stem}/frame-${String(index).padStart(4, '0')}.png`,
        left: margin + (index % frameColumns) * (cellWidth + spacing), top: margin + Math.floor(index / frameColumns) * (cellHeight + spacing), width: cellWidth, height: cellHeight,
      }));
      const manifest = `${stem}.json`;
      return { outputs: [manifest, ...frames.map(frame => frame.path)], detail: { columns, rows, frameColumns, frameCount: frames.length }, produce: async targets => {
        for (let i = 0; i < frames.length; i++) {
          const { path: _path, ...region } = frames[i]!;
          await writeNew(targets[i + 1]!, await image(file).extract(region).png().toBuffer());
        }
        await writeNew(targets[0]!, json({ source, columns, rows, frameColumns, margin, spacing, frames }));
      } };
    }
    case 'pixelate': {
      // size is the longest side of the low-resolution image, enlarged back with nearest.
      if ((params.size === undefined) === (params.pixelSize === undefined)) throw new Error('pixelate requires exactly one of size or pixelSize');
      const unit = params.pixelSize === undefined ? undefined : integerParam(params, 'pixelSize', undefined, 1);
      const size = unit === undefined ? integerParam(params, 'size', undefined, 1) : undefined;
      const palette = await readPalette(root, params.palette);
      const dither = choiceParam(params, 'dither', ['none', 'ordered'] as const, 'none');
      if (dither === 'ordered' && !palette) throw new Error('Ordered dithering requires a palette');
      const ratio = size === undefined ? 1 : Math.min(1, size / Math.max(width, height));
      const lowWidth = unit ? Math.ceil(width / unit) : Math.max(1, Math.round(width * ratio));
      const lowHeight = unit ? Math.ceil(height / unit) : Math.max(1, Math.round(height * ratio));
      return { outputs: [primary], detail: { lowWidth, lowHeight }, produce: async ([target]) => {
        let data: Buffer;
        if (unit) {
          const original = await image(file).ensureAlpha().raw().toBuffer();
          data = Buffer.alloc(lowWidth * lowHeight * 4);
          for (let y = 0; y < lowHeight; y++) for (let x = 0; x < lowWidth; x++) {
            const offset = (Math.min(height - 1, y * unit + Math.floor(unit / 2)) * width + Math.min(width - 1, x * unit + Math.floor(unit / 2))) * 4;
            original.copy(data, (y * lowWidth + x) * 4, offset, offset + 4);
          }
        } else data = await image(file).resize(lowWidth, lowHeight, { kernel: 'nearest', fit: 'fill' }).ensureAlpha().raw().toBuffer();
        if (palette) {
          const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
          for (let i = 0; i < data.length; i += 4) {
            const pixel = i / 4;
            const offset = dither === 'ordered' ? ((bayer[(Math.floor(pixel / lowWidth) % 4) * 4 + pixel % lowWidth % 4]! + 0.5) / 16 - 0.5) * 64 : 0;
            const color = palette.reduce((best, color) => {
              const distance = (candidate: RGB) => candidate.reduce((sum, channel, c) => sum + (channel - (data[i + c]! + offset)) ** 2, 0);
              return distance(color) < distance(best) ? color : best;
            });
            data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
          }
        }
        if (unit) {
          // Fixed-size blocks keep the grid uniform even when the right/bottom block is clipped.
          const full = Buffer.alloc(width * height * 4);
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const offset = (Math.floor(y / unit) * lowWidth + Math.floor(x / unit)) * 4;
            data.copy(full, (y * width + x) * 4, offset, offset + 4);
          }
          await writeNew(target!, await sharp(full, { raw: { width, height, channels: 4 } }).png().toBuffer());
        } else await writeNew(target!, await sharp(data, { raw: { width: lowWidth, height: lowHeight, channels: 4 } }).resize(width, height, { kernel: 'nearest', fit: 'fill' }).png().toBuffer());
      } };
    }
    case 'palette': {
      const declared = await readPalette(root, params.palette);
      const count = integerParam(params, 'colors', declared?.length, 1, 256);
      if (params.apply !== undefined && typeof params.apply !== 'boolean') throw new Error('apply must be boolean');
      const apply = params.apply === true;
      return { outputs: [...(apply ? [primary] : []), `${stem}.gpl`, `${stem}.hex`], produce: async targets => {
        const quantized = await image(file).resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true, kernel: 'nearest' }).png({ palette: true, colours: Math.max(2, count), dither: 0 }).toBuffer();
        const data = await image(quantized).ensureAlpha().raw().toBuffer();
        const frequency = new Map<string, number>();
        for (let i = 0; i < data.length; i += 4) if (data[i + 3]) {
          const color = hex([data[i]!, data[i + 1]!, data[i + 2]!]);
          frequency.set(color, (frequency.get(color) ?? 0) + 1);
        }
        const colors = declared ? declared.slice(0, count).map(hex) : [...frequency].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, count).map(([color]) => color);
        if (!colors.length) { if (apply) colors.push('000000'); else throw new Error('Image contains no visible colors'); }
        if (apply) {
          const palette = colors.map(rgb);
          const rgba = await image(file).ensureAlpha().raw().toBuffer();
          for (let i = 0; i < rgba.length; i += 4) {
            if (!rgba[i + 3]) continue;
            const distance = (color: RGB) => color.reduce((sum, channel, c) => sum + (channel - rgba[i + c]!) ** 2, 0);
            const color = palette.reduce((best, color) => distance(color) < distance(best) ? color : best);
            rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2];
          }
          await writeNew(targets[0]!, await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer());
        }
        const gpl = targets[apply ? 1 : 0], hexFile = targets[apply ? 2 : 1];
        await writeNew(gpl!, `GIMP Palette\nName: OpenPixo palette\nColumns: 8\n#\n${colors.map(color => `${rgb(color).join(' ')}\t#${color}`).join('\n')}\n`);
        await writeNew(hexFile!, `${colors.join('\n')}\n`);
      } };
    }
    case 'seamless-check': {
      if (width * 2 > 8192 || height * 2 > 8192) throw new Error('Tiled preview exceeds 8192');
      const data = await image(file).ensureAlpha().raw().toBuffer();
      let horizontal = 0, vertical = 0;
      for (let y = 0; y < height; y++) for (let c = 0; c < 4; c++) horizontal += Math.abs(data[(y * width) * 4 + c]! - data[(y * width + width - 1) * 4 + c]!);
      for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) vertical += Math.abs(data[x * 4 + c]! - data[((height - 1) * width + x) * 4 + c]!);
      const horizontalDifference = horizontal / (height * 4 * 255), verticalDifference = vertical / (width * 4 * 255);
      const detail = { score: 1 - (horizontalDifference + verticalDifference) / 2, horizontalDifference, verticalDifference };
      return { outputs: [`${stem}.json`, `${stem}-tiled.png`], detail, produce: async ([score, preview]) => {
        const buffer = await image(file).png().toBuffer();
        await writeNew(preview!, await sharp({ create: { width: width * 2, height: height * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([
          { input: buffer, left: 0, top: 0 }, { input: buffer, left: width, top: 0 }, { input: buffer, left: 0, top: height }, { input: buffer, left: width, top: height },
        ]).png().toBuffer());
        await writeNew(score!, json({ source, ...detail }));
      } };
    }
    case 'remove-bg': {
      choiceParam(params, 'mode', ['chroma', 'model'] as const, 'chroma');
      if (typeof params.color !== 'string') throw new Error('chroma requires color');
      const color = rgb(params.color), tolerance = numberParam(params, 'tolerance', 0, 0, 255);
      return { outputs: [primary], produce: async ([target]) => {
        const data = await image(file).ensureAlpha().raw().toBuffer();
        for (let i = 0; i < data.length; i += 4) if (color.every((channel, c) => Math.abs(data[i + c]! - channel) <= tolerance)) data[i + 3] = 0;
        await writeNew(target!, await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer());
      } };
    }
    default: throw new Error(`Unsupported image operation: ${op}`);
  }
}
