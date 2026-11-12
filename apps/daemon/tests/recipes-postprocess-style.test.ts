import { expect, it } from 'vitest';
import type { ArtStyle } from '@openpixo/contracts';
import { applyRecipePostprocessStyle } from '../src/recipes/postprocess-style.js';

const style: ArtStyle = { id: 'pixel-test', title: 'Pixel', description: '', dimension: ['2d'], medium: ['pixel'], prompt: 'Pixel', negativePrompt: '',
  constraints: { pixelSize: 3 }, palette: ['#000000', '#ffffff'], previews: [], license: 'Apache-2.0' };

it('uses the explicit pixel style input without needing a project preset and leaves non-pixel pipelines unchanged', () => {
  const steps = [{ op: 'resize' as const, params: { width: 12 } }];
  expect(applyRecipePostprocessStyle(steps, null, { style: 'hand-painted' })).toBe(steps);
  expect(applyRecipePostprocessStyle(steps, null, { style: 'pixel art' })).toEqual([
    { op: 'resize', params: { width: 12, filter: 'nearest' } }, { op: 'pixelate', params: { pixelSize: 1 } },
  ]);
  expect(steps[0]!.params).toEqual({ width: 12 });
});

it('preserves deliberate resize, pixelate and palette settings instead of adding competing defaults', () => {
  const steps = [{ op: 'resize' as const, params: { width: 12, filter: 'lanczos' } },
    { op: 'pixelate' as const, params: { size: 6, palette: 'pico8', dither: 'ordered' } },
    { op: 'slice' as const, params: { grid: '2x2' } }];
  expect(applyRecipePostprocessStyle(steps, style, {})).toEqual(steps);
});

it('places style policy after the final frame resize and before analysis/export', () => {
  const steps = [{ op: 'resize' as const, params: { width: 960 } }, { op: 'slice' as const, params: { grid: '3x3' } },
    { op: 'resize' as const, params: { width: 64 } }, { op: 'export-spritesheet' as const, params: {} }];
  const result = applyRecipePostprocessStyle(steps, style, {});
  expect(result.map(step => step.op)).toEqual(['resize', 'slice', 'resize', 'pixelate', 'palette', 'export-spritesheet']);
  expect(result[3]!.params).toEqual({ pixelSize: 3 });
  expect(result[4]!.params).toEqual({ apply: true, colors: 2, palette: ['#000000', '#ffffff'] });
});

it('honors an explicit color-count constraint when the host supplies it', () => {
  const capped = { ...style, constraints: { ...style.constraints, colorCount: 1 } };
  const steps = applyRecipePostprocessStyle([], capped, {});
  expect(steps.find(step => step.op === 'palette')!.params).toMatchObject({ apply: true, colors: 1, palette: ['#000000', '#ffffff'] });
});
