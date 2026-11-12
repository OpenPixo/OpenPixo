import { useEffect, useState } from 'react';
import type { ProjectAsset } from '@openpixo/contracts';
import { projectRawUrl } from '../../providers/registry';
import { appendResourceQuery } from '../../lib/resource-url';
import { smallPixelArtAssets, visiblePixelColors } from './project-art-palette';

export function useProjectArtPalette(projectId: string, assets: ProjectAsset[], enabled: boolean) {
  const sources = smallPixelArtAssets(assets).map(asset => appendResourceQuery(projectRawUrl(projectId, asset.relPath), `v=${asset.mtime}`));
  const sourceKey = JSON.stringify(enabled ? sources : []);
  const [result, setResult] = useState<{ key: string; colors: number | null }>({ key: '', colors: null });
  useEffect(() => {
    const urls: string[] = JSON.parse(sourceKey);
    if (!urls.length) return;
    let active = true;
    const images: HTMLImageElement[] = [];
    void Promise.all(urls.map(url => new Promise<Set<number> | null>(resolve => {
      const image = new Image(); images.push(image);
      image.onload = () => {
        try {
          const width = image.naturalWidth, height = image.naturalHeight;
          if (!width || !height || width * height > 65_536) { resolve(null); return; }
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) { resolve(null); return; }
          context.drawImage(image, 0, 0);
          resolve(visiblePixelColors(context.getImageData(0, 0, width, height).data));
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    }))).then(palettes => {
      if (!active) return;
      const colors = palettes.some(palette => palette !== null) ? new Set(palettes.flatMap(palette => [...(palette ?? [])])).size : null;
      setResult({ key: sourceKey, colors });
    });
    return () => { active = false; for (const image of images) { image.onload = null; image.onerror = null; image.src = ''; } };
  }, [sourceKey]);
  return result.key === sourceKey ? result.colors : null;
}
