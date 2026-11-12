// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectAsset } from '@openpixo/contracts';
import { smallPixelArtAssets, visiblePixelColors } from '../../../src/components/studio/project-art-palette';
import { useProjectArtPalette } from '../../../src/components/studio/useProjectArtPalette';

const asset = (extra: Partial<ProjectAsset> = {}): ProjectAsset => ({
  projectId: 'game', relPath: 'coin.png', width: 16, height: 16, kind: 'image', size: 100,
  mtime: 12, semantics: [], tags: [], indexedAt: 1, origin: 'imported', ...extra,
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('counts original visible RGB colors without treating transparent pixels as a palette', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 200, 0, 255, 0, 255, 1, 2, 3, 0]);
  expect(visiblePixelColors(pixels).size).toBe(2);
  const smooth = new Uint8ClampedArray(Array.from({ length: 300 }, (_, i) => [i % 256, Math.floor(i / 256), 0, 255]).flat());
  expect(visiblePixelColors(smooth).size).toBeGreaterThan(256);
});

it('samples at most four small originals, including strips, and ignores large paintings', () => {
  const assets = [asset({ relPath: 'large.png', width: 1024, height: 1024 }),
    asset({ relPath: 'player.png', width: 192, height: 32 }), ...Array.from({ length: 6 }, (_, i) => asset({ relPath: `${i}.png` }))];
  const samples = smallPixelArtAssets(assets);
  expect(samples).toHaveLength(4);
  expect(samples[0]?.relPath).toBe('player.png');
  expect(samples.some(item => item.relPath === 'large.png')).toBe(false);
});

it('reads source pixels locally and discards a previous project palette while new images load', async () => {
  const images: Array<{ naturalWidth: number; naturalHeight: number; src: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  vi.stubGlobal('Image', class {
    naturalWidth = 16; naturalHeight = 16; src = ''; onload = null; onerror = null;
    constructor() { images.push(this); }
  });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage,
    getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]) }),
  } as unknown as CanvasRenderingContext2D);
  const view = renderHook(({ projectId }) => useProjectArtPalette(projectId, [asset()], true), { initialProps: { projectId: 'game' } });
  expect(images[0]?.src).toContain('/api/projects/game/raw/coin.png?v=12');
  await act(async () => { images[0]!.onload?.(); });
  expect(view.result.current).toBe(2);
  expect(drawImage).toHaveBeenCalledWith(images[0], 0, 0);
  view.rerender({ projectId: 'other' });
  expect(view.result.current).toBeNull();
  expect(images[0]?.src).toBe('');
  await act(async () => { images[1]!.onerror?.(); });
  expect(view.result.current).toBeNull();
});
