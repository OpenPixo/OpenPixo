import { describe, expect, it } from 'vitest';

import {
  IMAGE_OUTPUT_MAX_EDGE,
  IMAGE_OUTPUT_MIN_EDGE,
  ImageOutputSizeError,
  resolveImageOutputSize,
} from '../src/index';

describe('resolveImageOutputSize', () => {
  it('leaves the provider default alone when no size is requested', () => {
    expect(resolveImageOutputSize({})).toBeNull();
    expect(resolveImageOutputSize({ aspect: '16:9' })).toBeNull();
  });

  it('keeps an in-range size and frames it with the nearest provider aspect', () => {
    expect(resolveImageOutputSize({ width: 64, height: 64 })).toEqual({ width: 64, height: 64, aspect: '1:1', warnings: [] });
    expect(resolveImageOutputSize({ width: 1536, height: 864 })).toMatchObject({ width: 1536, height: 864, aspect: '16:9', warnings: [] });
    expect(resolveImageOutputSize({ width: 96, height: 128 })).toMatchObject({ aspect: '3:4' });
  });

  it('derives the missing side from the requested aspect', () => {
    expect(resolveImageOutputSize({ width: 320, aspect: '16:9' })).toMatchObject({ width: 320, height: 180, aspect: '16:9' });
    expect(resolveImageOutputSize({ height: 256 })).toMatchObject({ width: 256, height: 256, aspect: '1:1' });
  });

  it('shrinks an oversized request proportionally and says so', () => {
    const size = resolveImageOutputSize({ width: 4096, height: 2048 })!;
    expect(size).toMatchObject({ width: IMAGE_OUTPUT_MAX_EDGE, height: 768, aspect: '16:9' });
    expect(size.warnings[0]).toContain('4096x2048 clamped to 1536x768');
  });

  it('raises a tiny edge to the minimum', () => {
    const size = resolveImageOutputSize({ width: 8, height: 8 })!;
    expect(size).toMatchObject({ width: IMAGE_OUTPUT_MIN_EDGE, height: IMAGE_OUTPUT_MIN_EDGE });
    expect(size.warnings).toHaveLength(1);
  });

  it('reports an aspect that disagrees with the explicit size', () => {
    const size = resolveImageOutputSize({ width: 128, height: 128, aspect: '16:9' })!;
    expect(size.aspect).toBe('1:1');
    expect(size.warnings).toEqual(['aspect 16:9 replaced by 1:1 to frame 128x128']);
  });

  it('rejects values that are not pixel counts', () => {
    for (const width of [0, -4, 12.5, '64', Number.NaN]) {
      expect(() => resolveImageOutputSize({ width })).toThrow(ImageOutputSizeError);
    }
    expect(() => resolveImageOutputSize({ width: 64, aspect: '2:1' })).toThrow(/aspect must be one of/);
  });
});
