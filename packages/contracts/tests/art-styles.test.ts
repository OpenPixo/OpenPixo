import { describe, expect, it } from 'vitest';
import { RecipeRunRequestSchema } from '../src/api/recipes.js';
import { SetProjectArtStyleRequestSchema } from '../src/api/styles.js';
import {
  ArtStyleSchema,
  PluginExampleSchema,
  PluginManifestSchema,
} from '../src/plugins/manifest.js';

function example() {
  return {
    title: 'Knight sprite',
    title_i18n: { 'zh-CN': '骑士精灵' },
    prompt: 'Generate a 32x32 knight sprite in this style.',
    prompt_i18n: { 'zh-CN': '用此风格生成一个 32x32 的骑士精灵。' },
  };
}

function style() {
  return {
    id: '16-bit-pixel',
    dimension: ['2d'],
    medium: ['pixel'],
    prompt: 'Crisp pixel clusters with restrained shading.',
    negativePrompt: 'Blurred edges, smooth gradients.',
    palette: ['#102030', '#ABCDEF'],
    constraints: {
      pixelSize: 32,
      outline: 'One-pixel dark outline.',
      background: 'transparent',
      recommendedResolution: '1024x1024',
    },
    previews: ['previews/hero.webp'],
  };
}

describe('art-style and example contracts', () => {
  it('preserves a bounded integer color count for limited-palette styles', () => {
    for (const colorCount of [1, 2, 4, 256]) {
      expect(ArtStyleSchema.parse({ ...style(), constraints: { colorCount } }).constraints).toEqual({ colorCount });
    }
    for (const colorCount of [0, 257, 1.5, '4']) {
      expect(ArtStyleSchema.safeParse({ ...style(), constraints: { colorCount } }).success).toBe(false);
    }
  });

  it('preserves the exact portable example shape and rejects unsupported keys', () => {
    expect(PluginExampleSchema.parse(example())).toEqual(example());
    expect(PluginExampleSchema.parse({ title: 'Knight', prompt: 'Draw a knight.' })).toEqual({
      title: 'Knight', prompt: 'Draw a knight.',
    });
    expect(PluginExampleSchema.safeParse({ ...example(), description: 'Unsupported' }).success).toBe(false);
    expect(PluginExampleSchema.safeParse({ ...example(), title_i18n: { en: 'Knight' } }).success).toBe(false);
    expect(PluginExampleSchema.safeParse({ ...example(), prompt_i18n: { 'zh-CN': '骑士', fr: 'Chevalier' } }).success).toBe(false);
    expect(PluginExampleSchema.safeParse({ title: 'Knight' }).success).toBe(false);
  });

  it('accepts examples on skill and style manifests and requires a style payload', () => {
    const skill = PluginManifestSchema.parse({
      name: 'openpixo/knight-skill', version: '1.0.0', examples: [example()], pixo: { kind: 'skill' },
    });
    const manifest = PluginManifestSchema.parse({
      name: 'openpixo/16-bit-pixel', version: '1.0.0', license: 'Apache-2.0',
      title: '16-bit pixel', examples: [example()], pixo: { kind: 'style', style: style() },
    });

    expect(skill.examples).toEqual([example()]);
    expect(manifest.examples).toEqual([example()]);
    expect(manifest.pixo?.style).toEqual(style());
    expect(PluginManifestSchema.safeParse({
      name: 'openpixo/missing-style', version: '1.0.0', pixo: { kind: 'style' },
    }).success).toBe(false);
  });

  it('validates portable style paths, palettes, dimensions and constraints', () => {
    expect(ArtStyleSchema.parse(style())).toEqual(style());
    expect(ArtStyleSchema.parse({ ...style(), previews: [] }).previews).toEqual([]);

    const invalidStyles = [
      { ...style(), id: '../pixel' },
      { ...style(), dimension: ['4d'] },
      { ...style(), palette: ['#fff'] },
      { ...style(), palette: ['102030'] },
      { ...style(), constraints: { pixelSize: 0 } },
      { ...style(), constraints: { pixelSize: 1.5 } },
      { ...style(), constraints: { background: 'opaque' } },
      ...['../hero.webp', '/hero.webp', 'C:\\hero.webp', 'https://example.test/hero.webp'].map(
        preview => ({ ...style(), previews: [preview] }),
      ),
    ];
    for (const invalidStyle of invalidStyles) {
      expect(ArtStyleSchema.safeParse(invalidStyle).success, JSON.stringify(invalidStyle)).toBe(false);
    }
  });

  it('requires an explicit project default selector and allows clearing it', () => {
    expect(SetProjectArtStyleRequestSchema.parse({ styleId: '16-bit-pixel' })).toEqual({ styleId: '16-bit-pixel' });
    expect(SetProjectArtStyleRequestSchema.parse({ styleId: null })).toEqual({ styleId: null });
    expect(SetProjectArtStyleRequestSchema.safeParse({}).success).toBe(false);
    expect(SetProjectArtStyleRequestSchema.safeParse({ styleId: '' }).success).toBe(false);
    expect(SetProjectArtStyleRequestSchema.safeParse({ styleId: null, prompt: 'Override' }).success).toBe(false);
  });

  it('keeps recipe inheritance, no-style and explicit-style selectors distinct', () => {
    const inherited = RecipeRunRequestSchema.parse({ recipeId: 'sprite' });
    const disabled = RecipeRunRequestSchema.parse({ recipeId: 'sprite', styleId: null });
    const selected = RecipeRunRequestSchema.parse({ recipeId: 'sprite', styleId: '16-bit-pixel' });

    expect(inherited).not.toHaveProperty('styleId');
    expect(disabled.styleId).toBeNull();
    expect(selected.styleId).toBe('16-bit-pixel');
    expect(RecipeRunRequestSchema.safeParse({ recipeId: 'sprite', styleId: '' }).success).toBe(false);
  });
});
