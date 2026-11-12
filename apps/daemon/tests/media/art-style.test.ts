import type { ArtStyle } from '@openpixo/contracts';
import { describe, expect, it } from 'vitest';
import { mergeImageArtStyle } from '../../src/media/art-style.js';

const artStyle: ArtStyle = {
  id: 'pixel-test', title: 'Pixel test', description: 'Crisp game art',
  dimension: ['2d'], medium: ['pixel'], prompt: 'Crisp pixel clusters', negativePrompt: 'blur, gradients',
  palette: ['#112233', '#abcdef'], constraints: { pixelSize: 1, outline: 'single dark edge', background: 'transparent', recommendedResolution: '1024x1024' },
  previews: [], examples: [], license: 'Apache-2.0',
};

describe('image art-style merge', () => {
  it('combines subject, style, palette and constraints before caller and style negatives', () => {
    expect(mergeImageArtStyle({ prompt: 'A knight', negativePrompt: 'text' }, artStyle)).toEqual({
      prompt: 'A knight\n\nCrisp pixel clusters\n\nPalette: #112233, #abcdef.\nPixel grid unit: 1px.\nOutline: single dark edge.\nBackground: transparent.\nRecommended output resolution: 1024x1024.\n\nAvoid: text, blur, gradients',
      resolution: '1024x1024',
    });
  });

  it('lets request background and resolution override style defaults in both text and settings', () => {
    const result = mergeImageArtStyle({ prompt: 'A forest', background: 'scene', resolution: '1536x1024' }, artStyle);
    expect(result.resolution).toBe('1536x1024');
    expect(result.prompt).toContain('Background: a complete scene.');
    expect(result.prompt).toContain('Output resolution: 1536x1024.');
    expect(result.prompt).not.toContain('transparent');
    expect(result.prompt).not.toContain('1024x1024');
  });

  it('preserves an unstyled request and supports caller negatives without a preset', () => {
    expect(mergeImageArtStyle({ prompt: 'A knight' }, null)).toEqual({ prompt: 'A knight' });
    expect(mergeImageArtStyle({ prompt: 'A knight', resolution: '1536x1024' }, null)).toEqual({ prompt: 'A knight', resolution: '1536x1024' });
    expect(mergeImageArtStyle({ prompt: 'A knight', negativePrompt: 'text' }, null)).toEqual({ prompt: 'A knight\n\nAvoid: text' });
  });
});

