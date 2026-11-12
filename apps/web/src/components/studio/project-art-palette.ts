import type { ProjectAsset } from '@openpixo/contracts';
import { detectFrameGrid } from '../assets/frame-grid';

/** Bound original-pixel reads to four small images/strips, never thumbnails or large paintings. */
export function smallPixelArtAssets(assets: ProjectAsset[]) {
  return assets.filter(asset => asset.kind === 'image' && asset.width && asset.height && asset.width * asset.height <= 65_536
    && ((asset.width <= 128 && asset.height <= 128) || (Math.min(asset.width, asset.height) <= 128 && detectFrameGrid(asset))))
    .sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!)).slice(0, 4);
}

/** Ignore transparent background RGB; stop once a smooth image exceeds a pixel-art palette. */
export function visiblePixelColors(data: Uint8ClampedArray): Set<number> {
  const colors = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    colors.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    if (colors.size > 256) break;
  }
  return colors;
}
