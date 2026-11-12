import type { AssetFrame, ProjectAsset } from '@openpixo/contracts';

type SpriteAsset = Pick<ProjectAsset, 'width' | 'height' | 'semantics'>;
export interface DetectedFrameGrid {
  cols: number; rows: number; cellWidth: number; cellHeight: number; source: 'declared' | 'dimensions';
}
const positiveInteger = (value: number | undefined): value is number => Number.isSafeInteger(value) && value! > 0;

/** Only integral, bounded grids are previewable. Square images need explicit metadata. */
export function detectFrameGrid(asset: SpriteAsset): DetectedFrameGrid | null {
  const { width, height } = asset;
  if (!positiveInteger(width) || !positiveInteger(height)) return null;
  const declared = asset.semantics.find(semantic => semantic.grid)?.grid;
  if (declared) {
    const cellWidth = 'cols' in declared ? width / declared.cols : declared.cellWidth;
    const cellHeight = 'rows' in declared ? height / declared.rows : declared.cellHeight;
    if (!positiveInteger(cellWidth) || !positiveInteger(cellHeight) || width % cellWidth || height % cellHeight) return null;
    const cols = width / cellWidth, rows = height / cellHeight;
    return cols * rows <= 1024 ? { cols, rows, cellWidth, cellHeight, source: 'declared' } : null;
  }
  const cell = Math.min(width, height), count = Math.max(width, height) / cell;
  if (cell > 128 || !Number.isInteger(count) || count < 2 || count > 64) return null;
  return { cols: width / cell, rows: height / cell, cellWidth: cell, cellHeight: cell, source: 'dimensions' };
}

/** Indexed JSON / engine sidecars take precedence over a guess from strip dimensions. */
export function spriteFrames(asset: SpriteAsset): AssetFrame[] {
  const { width, height } = asset;
  if (!positiveInteger(width) || !positiveInteger(height)) return [];
  const grid = detectFrameGrid(asset);
  const declared = asset.semantics.find(semantic => semantic.frames?.length)?.frames;
  if (grid?.source !== 'declared') {
    if (declared) return declared.length <= 1024 && declared.every(frame => Number.isSafeInteger(frame.x) && Number.isSafeInteger(frame.y)
      && frame.x >= 0 && frame.y >= 0 && positiveInteger(frame.width) && positiveInteger(frame.height)
      && frame.x + frame.width <= width && frame.y + frame.height <= height) ? declared : [];
  }
  return grid ? Array.from({ length: grid.cols * grid.rows }, (_, index) => ({
    x: index % grid.cols * grid.cellWidth, y: Math.floor(index / grid.cols) * grid.cellHeight,
    width: grid.cellWidth, height: grid.cellHeight,
    ...(declared?.length === grid.cols * grid.rows && declared[index]?.durationMs !== undefined ? { durationMs: declared[index]!.durationMs } : {}),
  })) : [];
}

export function isPixelAsset(asset: Pick<ProjectAsset, 'kind' | 'width' | 'height' | 'semantics'>) {
  return asset.kind === 'image' && !!asset.width && !!asset.height
    && (Math.max(asset.width, asset.height) <= 256 || spriteFrames(asset).length > 1);
}

export function integerPreviewScale(width: number, height: number, availableWidth: number, availableHeight: number): number {
  return width > 0 && height > 0 ? Math.max(1, Math.floor(Math.min(availableWidth / width, availableHeight / height))) : 1;
}

/** The bounded, declarative subset emitted by the sprite export operation. Never evaluates Godot text. */
export function parseSpriteDescriptor(text: string, asset: SpriteAsset): { frames: AssetFrame[]; fps?: number } | null {
  if (text.length > 262144 || !positiveInteger(asset.width) || !positiveInteger(asset.height)) return null;
  let frames: AssetFrame[] = [], fps: number | undefined;
  try {
    if (text.trimStart().startsWith('{')) {
      const value = JSON.parse(text);
      if (!value.frames || typeof value.frames !== 'object') return null;
      const entries: Array<{ frame?: { x: number; y: number; w: number; h: number }; rotated?: boolean; duration?: number }> = Object.values(value.frames);
      if (entries.length > 1024 || entries.some(entry => !entry?.frame || entry.rotated)) return null;
      frames = entries.map(entry => ({ x: entry.frame!.x, y: entry.frame!.y, width: entry.frame!.w, height: entry.frame!.h,
        ...(typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration > 0 ? { durationMs: entry.duration } : {}) }));
      const duration = entries[0]?.duration;
      if (typeof duration === 'number' && duration > 0) fps = 1000 / duration;
    } else {
      frames = [...text.matchAll(/^region\s*=\s*Rect2\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gm)]
        .map(match => ({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) }));
      const speed = /"speed"\s*:\s*(\d+(?:\.\d+)?)/.exec(text);
      if (speed) fps = Number(speed[1]);
    }
  } catch { return null; }
  if (!frames.length || frames.length > 1024 || !frames.every(frame => Number.isSafeInteger(frame.x) && Number.isSafeInteger(frame.y)
    && frame.x >= 0 && frame.y >= 0 && positiveInteger(frame.width) && positiveInteger(frame.height)
    && frame.x + frame.width <= asset.width! && frame.y + frame.height <= asset.height!)) return null;
  return { frames, ...(fps && Number.isFinite(fps) && fps > 0 && fps <= 240 ? { fps } : {}) };
}
