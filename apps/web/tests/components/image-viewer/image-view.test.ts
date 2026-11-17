import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centeredView,
  clampPan,
  fitScale,
  formatHexColor,
  formatZoom,
  pixelAt,
  siblingImages,
  stepZoom,
  zoomAt,
} from '../../../src/components/image-viewer/image-view';

const viewport = { width: 848, height: 648 };

describe('fitScale', () => {
  it('shrinks a large image to fit inside the padded viewport', () => {
    expect(fitScale({ width: 1600, height: 600 }, viewport)).toBeCloseTo(0.5);
  });

  it('enlarges a small sprite by a whole number only', () => {
    // 800 x 600 of room over a 16 x 16 sprite is 37.5x; the fit stays crisp at 37x.
    expect(fitScale({ width: 16, height: 16 }, viewport)).toBe(37);
  });

  it('never leaves the zoom range', () => {
    expect(fitScale({ width: 1, height: 1 }, viewport)).toBe(MAX_ZOOM);
    expect(fitScale({ width: 1_000_000, height: 10 }, viewport)).toBe(MIN_ZOOM);
  });
});

describe('stepZoom', () => {
  it('moves to the neighbouring stop', () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.75);
  });

  it('snaps an in-between scale to the next stop in that direction', () => {
    expect(stepZoom(37, 1)).toBe(48);
    expect(stepZoom(37, -1)).toBe(32);
  });

  it('stops at both ends', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe('zoomAt', () => {
  it('keeps the image point under the pointer in place', () => {
    const image = { width: 64, height: 64 };
    const view = centeredView(image, viewport, 4);
    const anchor = { x: view.x + 40, y: view.y + 20 };
    const before = pixelAt(view, anchor, image);
    const zoomed = zoomAt(view, 8, anchor, image, viewport);
    expect(zoomed.scale).toBe(8);
    expect(pixelAt(zoomed, anchor, image)).toEqual(before);
  });
});

describe('clampPan', () => {
  it('keeps part of the image on screen after a long drag', () => {
    const image = { width: 100, height: 100 };
    const dragged = clampPan({ scale: 1, x: 5000, y: -5000 }, image, viewport);
    expect(dragged.x).toBe(viewport.width - 32);
    expect(dragged.y).toBe(32 - 100);
  });
});

describe('pixelAt', () => {
  it('maps a viewport point to the source pixel and refuses points off the image', () => {
    const image = { width: 16, height: 8 };
    const view = { scale: 10, x: 100, y: 50 };
    expect(pixelAt(view, { x: 100, y: 50 }, image)).toEqual({ x: 0, y: 0 });
    expect(pixelAt(view, { x: 259, y: 129 }, image)).toEqual({ x: 15, y: 7 });
    expect(pixelAt(view, { x: 260, y: 60 }, image)).toBeNull();
    expect(pixelAt(view, { x: 99, y: 60 }, image)).toBeNull();
  });
});

describe('formatters', () => {
  it('writes opaque colours as six digits and translucent ones with alpha', () => {
    expect(formatHexColor(255, 8, 0)).toBe('#ff0800');
    expect(formatHexColor(255, 8, 0, 128)).toBe('#ff080080');
  });

  it('labels zoom in percent', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(8)).toBe('800%');
    expect(formatZoom(0.05)).toBe('5%');
    expect(formatZoom(0.0625)).toBe('6.3%');
  });
});

describe('siblingImages', () => {
  const names = [
    'sprites/walk_10.png',
    'sprites/walk_2.png',
    'sprites/walk_1.png',
    'sprites/notes.txt',
    'sprites/icon.svg',
    'sprites/deep/other.png',
    'cover.png',
  ];

  it('steps through raster images of the same folder in natural order, wrapping', () => {
    expect(siblingImages(names, 'sprites/walk_2.png')).toEqual({
      index: 1, total: 3, previous: 'sprites/walk_1.png', next: 'sprites/walk_10.png',
    });
    expect(siblingImages(names, 'sprites/walk_10.png').next).toBe('sprites/walk_1.png');
    expect(siblingImages(names, 'sprites/walk_1.png').previous).toBe('sprites/walk_10.png');
  });

  it('offers no stepping when the image is alone in its folder', () => {
    expect(siblingImages(names, 'cover.png')).toEqual({ index: 0, total: 1, previous: null, next: null });
  });
});
