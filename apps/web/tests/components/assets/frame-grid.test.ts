// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectAsset } from '@openpixo/contracts';
import { detectFrameGrid, parseSpriteDescriptor } from '../../../src/components/assets/frame-grid';
import { SpritePreview } from '../../../src/components/assets/SpritePreview';
import { useSpriteDescriptor } from '../../../src/components/assets/useSpriteDescriptor';
import { I18nProvider } from '../../../src/i18n';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('local sprite frame detection', () => {
  it('recognizes horizontal and vertical square-frame strips', () => {
    expect(detectFrameGrid({ width: 192, height: 32, semantics: [] })).toMatchObject({ cols: 6, rows: 1, cellWidth: 32, cellHeight: 32 });
    expect(detectFrameGrid({ width: 16, height: 64, semantics: [] })).toMatchObject({ cols: 1, rows: 4, cellWidth: 16, cellHeight: 16 });
  });
  it('prefers declared sidecar grids, including non-square cells', () => {
    expect(detectFrameGrid({ width: 192, height: 64, semantics: [{ type: 'grid', source: 'player.tres', grid: { cellWidth: 32, cellHeight: 64 } }] }))
      .toMatchObject({ cols: 6, rows: 1, cellWidth: 32, cellHeight: 64 });
  });
  it('refuses ambiguous squares, fractional cells, and unbounded guesses', () => {
    expect(detectFrameGrid({ width: 64, height: 64, semantics: [] })).toBeNull();
    expect(detectFrameGrid({ width: 193, height: 32, semantics: [] })).toBeNull();
    expect(detectFrameGrid({ width: 100000, height: 1, semantics: [] })).toBeNull();
    expect(detectFrameGrid({ width: 0, height: 32, semantics: [] })).toBeNull();
  });
});

describe('exported sprite descriptors', () => {
  const image = { width: 64, height: 64, semantics: [] };
  it('reads Phaser and Aseprite frame hashes instead of guessing square sheets', () => {
    const frames = Object.fromEntries([0, 1, 2, 3].map(i => [String(i), { frame: { x: i % 2 * 32, y: Math.floor(i / 2) * 32, w: 32, h: 32 }, duration: 125 }]));
    expect(parseSpriteDescriptor(JSON.stringify({ frames }), image)).toMatchObject({ frames: [{ x: 0, y: 0, width: 32, height: 32 }, {}, {}, {}], fps: 8 });
  });
  it('preserves 125ms Aseprite frame timing instead of the 12 FPS default', () => {
    const frames = [0, 1].map(i => ({ frame: { x: i * 32, y: 0, w: 32, h: 32 }, duration: 125 }));
    const descriptor = parseSpriteDescriptor(JSON.stringify({ frames }), image);
    expect(descriptor?.frames.map(frame => frame.durationMs)).toEqual([125, 125]);
    expect(1000 / (descriptor?.fps ?? 12)).toBe(125);
  });
  it('keeps each authored duration when Aseprite frame timing varies', () => {
    const frames = [125, 250].map((duration, i) => ({ frame: { x: i * 32, y: 0, w: 32, h: 32 }, duration }));
    expect(parseSpriteDescriptor(JSON.stringify({ frames }), image)?.frames.map(frame => frame.durationMs)).toEqual([125, 250]);
  });
  it('reads Godot AtlasTexture regions without evaluating resource text', () => {
    const text = '[sub_resource type="AtlasTexture"]\nregion = Rect2(0, 0, 32, 64)\n[sub_resource type="AtlasTexture"]\nregion = Rect2(32, 0, 32, 64)\n"speed": 10.0';
    expect(parseSpriteDescriptor(text, image)).toMatchObject({ frames: [{ width: 32, height: 64 }, { x: 32 }], fps: 10 });
  });
  it('rejects malformed, rotated and out-of-bounds frames', () => {
    expect(parseSpriteDescriptor('not json', image)).toBeNull();
    expect(parseSpriteDescriptor(JSON.stringify({ frames: { a: { frame: { x: 64, y: 0, w: 32, h: 32 } } } }), image)).toBeNull();
    expect(parseSpriteDescriptor(JSON.stringify({ frames: { a: { rotated: true, frame: { x: 0, y: 0, w: 32, h: 32 } } } }), image)).toBeNull();
  });
});

describe('indexed sprite timing', () => {
  const frames = [0, 1].map(i => ({ x: i * 32, y: 0, width: 32, height: 32, durationMs: 125 }));
  const asset = (semantics: ProjectAsset['semantics']): ProjectAsset => ({
    projectId: 'game', relPath: 'hero.png', kind: 'image', size: 128, mtime: 1,
    width: 64, height: 32, semantics, tags: [], indexedAt: 1, origin: 'imported',
  });
  const files = ['hero.png', 'hero.aseprite.json'];
  const preview = (image: ProjectAsset) => createElement(I18nProvider, { initial: 'en', children: createElement(SpritePreview, {
    asset: image, files, source: '/hero.png', viewerOnly: true, busy: false, onGrid: vi.fn(),
  }) });

  it('uses indexed 125ms frame durations without fetching a sidecar', () => {
    const read = vi.fn();
    vi.stubGlobal('fetch', read);
    const image = asset([{ type: 'sprite-sheet', source: files[1]!, frames }]);
    const { result } = renderHook(() => useSpriteDescriptor(image, files));
    expect(result.current).toMatchObject({ frames, fps: 8 });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['grid', 'frames', 'partial timing'] as const)('reads sidecar timing when indexed %s lacks complete durations', async kind => {
    const read = vi.fn(async () => Response.json({ frames: frames.map(frame => ({
      frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height }, duration: 125,
    })) }));
    vi.stubGlobal('fetch', read);
    const semantics: ProjectAsset['semantics'] = kind === 'grid'
      ? [{ type: 'grid', source: 'hero.png', grid: { cols: 2, rows: 1 } }]
      : [{ type: 'sprite-sheet', source: files[1]!, frames: frames.map((frame, i) => ({
        ...frame, durationMs: kind === 'partial timing' && i === 0 ? 125 : undefined,
      })) }];
    const image = asset(semantics);
    const { result } = renderHook(() => useSpriteDescriptor(image, files));
    await waitFor(() => expect(result.current?.fps).toBe(8));
    expect(result.current?.frames.map(frame => frame.durationMs)).toEqual([125, 125]);
    expect(read).toHaveBeenCalledWith('/api/projects/game/raw/hero.aseprite.json?v=1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('plays indexed 8 FPS frames at 125ms intervals in SpritePreview', () => {
    vi.useFakeTimers();
    render(preview(asset([{ type: 'sprite-sheet', source: files[1]!, frames }])));
    expect(screen.getByRole('spinbutton', { name: 'FPS' })).toHaveValue(8);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(124));
    expect(screen.getByRole('img', { name: 'Frame 1 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toHaveAttribute('viewBox', '32 0 32 32');
  });

  it('plays unequal frame durations and loops after their total duration', () => {
    vi.useFakeTimers();
    const timed = frames.map((frame, i) => ({ ...frame, durationMs: i === 0 ? 125 : 250 }));
    render(preview(asset([{ type: 'sprite-sheet', source: files[1]!, frames: timed }])));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(125));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(249));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('img', { name: 'Frame 1 / 2' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'FPS' })).toHaveValue(2000 / 375);
  });

  it.each([4, 10])('overrides authored timing at %s FPS until the descriptor reloads', fps => {
    vi.useFakeTimers();
    const timed = frames.map((frame, i) => ({ ...frame, durationMs: i === 0 ? 125 : 375 }));
    const image = asset([{ type: 'sprite-sheet', source: files[1]!, frames: timed }]);
    const { rerender } = render(preview(image));
    expect(screen.getByRole('spinbutton', { name: 'FPS' })).toHaveValue(4);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'FPS' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'FPS' }), { target: { value: String(fps) } });
    const interval = 1000 / fps;
    act(() => vi.advanceTimersByTime(interval - 1));
    expect(screen.getByRole('img', { name: 'Frame 1 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(interval - 1));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('img', { name: 'Frame 1 / 2' })).toBeTruthy();
    rerender(preview({ ...image, mtime: 2 }));
    expect(screen.getByRole('spinbutton', { name: 'FPS' })).toHaveValue(4);
    act(() => vi.advanceTimersByTime(124));
    expect(screen.getByRole('img', { name: 'Frame 1 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(374));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('img', { name: 'Frame 1 / 2' })).toBeTruthy();
  });

  it('cancels playback on pause and unmount, and resumes for the current frame duration', () => {
    vi.useFakeTimers();
    const timed = frames.map((frame, i) => ({ ...frame, durationMs: i === 0 ? 125 : 250 }));
    const { unmount } = render(preview(asset([{ type: 'sprite-sheet', source: files[1]!, frames: timed }])));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(125));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(249));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('img', { name: 'Frame 1 / 2' })).toBeTruthy();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restarts the timer when frame durations change with the same count and average FPS', () => {
    vi.useFakeTimers();
    const image = (durations: number[]) => asset([{ type: 'sprite-sheet', source: files[1]!,
      frames: frames.map((frame, i) => ({ ...frame, durationMs: durations[i]! })),
    }]);
    const { rerender } = render(preview(image([125, 375])));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(100));
    rerender(preview(image([375, 125])));
    act(() => vi.advanceTimersByTime(374));
    expect(screen.getByRole('img', { name: 'Frame 1 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(124));
    expect(screen.getByRole('img', { name: 'Frame 2 / 2' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('img', { name: 'Frame 1 / 2' })).toBeTruthy();
  });
});
