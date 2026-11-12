import { useEffect, useState } from 'react';
import type { ProjectAsset } from '@openpixo/contracts';
import { projectRawUrl } from '../../providers/registry';
import { parseSpriteDescriptor, spriteFrames } from './frame-grid';

/** Only read a matching sidecar already present in the project's file list. */
export function useSpriteDescriptor(asset: ProjectAsset, files: readonly string[]) {
  const [descriptor, setDescriptor] = useState<ReturnType<typeof parseSpriteDescriptor>>(null);
  const stem = asset.relPath.replace(/\.[^/.]+$/, '');
  const paths = [`${stem}.phaser.json`, `${stem}.aseprite.json`, `${stem}.tres`].filter(path => files.includes(path));
  const key = paths.join('\n');
  useEffect(() => {
    const controller = new AbortController();
    const frames = spriteFrames(asset);
    const timed = frames.length > 0 && frames.every(frame => typeof frame.durationMs === 'number'
      && Number.isFinite(frame.durationMs) && frame.durationMs > 0);
    setDescriptor(timed ? { frames, fps: 1000 / frames[0]!.durationMs! } : null);
    if (!key || timed) return () => controller.abort();
    void Promise.allSettled(paths.map(async path => {
      const response = await fetch(`${projectRawUrl(asset.projectId, path)}?v=${asset.mtime}`, { signal: controller.signal });
      if (!response.ok || Number(response.headers.get('content-length')) > 262144) return null;
      return parseSpriteDescriptor(await response.text(), asset);
    })).then(values => { if (!controller.signal.aborted) setDescriptor(values.flatMap(value => value.status === 'fulfilled' && value.value ? [value.value] : [])[0] ?? null); })
      .catch(() => { /* Optional preview metadata never blocks the asset. */ });
    return () => controller.abort();
  }, [asset.projectId, asset.relPath, asset.mtime, asset.width, asset.height, asset.semantics, key]);
  return descriptor;
}
