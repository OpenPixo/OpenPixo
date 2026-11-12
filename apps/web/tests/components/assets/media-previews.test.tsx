// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectAsset } from '@openpixo/contracts';
import { PixelAssetImage } from '../../../src/components/assets/PixelAssetImage';
import { SpritePreview } from '../../../src/components/assets/SpritePreview';
import { I18nProvider } from '../../../src/i18n';

const asset = (extra: Partial<ProjectAsset> = {}): ProjectAsset => ({
  projectId: 'game', relPath: 'coin.png', kind: 'image', size: 128, mtime: 1,
  width: 16, height: 16, semantics: [], tags: [], indexedAt: 1, origin: 'imported', ...extra,
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('game media previews', () => {
  it('loads original small-image pixels and renders a whole-number scale', () => {
    render(<PixelAssetImage source="/api/projects/p1/raw/coin.png?v=1" name="coin.png" width={16} height={16} />);
    const image = screen.getByAltText('coin.png');
    expect(image.getAttribute('src')).toContain('/raw/coin.png');
    expect(Number(image.getAttribute('width')) / 16).toBeGreaterThanOrEqual(1);
    expect(Number(image.getAttribute('width')) % 16).toBe(0);
    expect(image).toHaveStyle({ imageRendering: 'pixelated' });
  });

  it('uses a matching export sidecar to animate a square sheet', async () => {
    const frames = Object.fromEntries([0, 1, 2, 3].map(i => [String(i), { frame: { x: i % 2 * 32, y: Math.floor(i / 2) * 32, w: 32, h: 32 } }]));
    const read = vi.fn(async () => Response.json({ frames }));
    vi.stubGlobal('fetch', read);
    render(<I18nProvider initial="en"><SpritePreview asset={asset({ relPath: 'hero.png', width: 64, height: 64 })}
      files={['hero.png', 'hero.phaser.json']} source="/hero.png" viewerOnly busy={false} onGrid={vi.fn()} /></I18nProvider>);
    expect(await screen.findByRole('img', { name: 'Frame 1 / 4' })).toHaveAttribute('viewBox', '0 0 32 32');
    expect(read).toHaveBeenCalledWith('/api/projects/game/raw/hero.phaser.json?v=1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('plays a detected six-frame strip, changes fps, pauses, and overlays its grid', () => {
    vi.useFakeTimers();
    render(<I18nProvider initial="en"><SpritePreview asset={asset({ relPath: 'player.png', width: 192, height: 32 })}
      source="/player.png" viewerOnly busy={false} onGrid={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('img', { name: 'Frame 1 / 6' })).toHaveAttribute('viewBox', '0 0 32 32');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'FPS' }), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('img', { name: 'Frame 2 / 6' })).toHaveAttribute('viewBox', '32 0 32 32');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('img', { name: 'Frame 2 / 6' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Frame grid' }));
    const grid = screen.getByRole('img', { name: 'Frame grid' });
    expect(grid).toHaveAttribute('viewBox', '0 0 192 32');
    expect(grid.querySelectorAll('rect')).toHaveLength(6);
    expect(within(screen.getByRole('region')).queryByRole('button', { name: 'Save grid' })).toBeNull();
  });
});
