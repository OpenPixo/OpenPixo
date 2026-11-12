import { describe, expect, it } from 'vitest';

import {
  AUDIO_MODELS_BY_KIND,
  IMAGE_MODELS,
  MEDIA_PROVIDERS,
  VIDEO_MODELS,
  canonicalMediaModelId,
  findMediaModel,
} from '../../src/media/models.js';
import { selectRecipeModel } from '../../src/recipes/models.js';
import type { Recipe } from '@openpixo/contracts';

describe('image model defaults', () => {

  it('preserves explicit OpenAI BYOK model selection', () => {
    expect(canonicalMediaModelId('gpt-image-2')).toBe('gpt-image-2');
    expect(findMediaModel('gpt-image-2')?.provider).toBe('openai');
  });
});

const retiredModels = [
  ['gpt-image-1', 'gpt-image-2'],
  ['gpt-image-1.5', 'gpt-image-2'],
  ['gpt-image-1-mini', 'gpt-image-2'],
  ['openai/gpt-image-1.5', 'openai/gpt-image-2'],
  ['dall-e-2', 'dall-e-3'],
  ['senseaudio-image-1.0-260319', 'senseaudio-image-2.0-260319'],
  ['flux-pro', 'flux-1.1-pro'],
  ['imagen-3', 'imagen-4'],
  ['doubao-seedance-1-0-pro-250528', 'doubao-seedance-2-0-260128'],
  ['doubao-seedance-1-0-lite-i2v-250428', 'doubao-seedance-2-0-260128'],
  ['doubao-seedance-1-0-lite-t2v-250428', 'doubao-seedance-2-0-260128'],
  ['kling-1.5', 'kling-2.0'],
  ['kling-1.6', 'kling-2.0'],
  ['veo-2', 'veo-3'],
  ['veo-2-fal', 'veo-3-gateway'],
  ['veo-3-fal', 'veo-3-gateway'],
  ['flux-dev-fal', 'flux-dev-gateway'],
  ['flux-schnell-fal', 'flux-schnell-gateway'],
  ['ideogram-v3-fal', 'ideogram-v3-gateway'],
  ['recraft-v3-fal', 'recraft-v3-gateway'],
  ['seedance-1-pro-fal', 'seedance-1-pro-gateway'],
  ['kling-2.1-t2v-fal', 'kling-2.1-t2v-gateway'],
  ['suno-v4-5', 'suno-v5'],
] as const;

describe('the catalogue served to the UI, CLI and agents', () => {
  it('never names the upstream behind the media gateway', () => {
    const served = JSON.stringify({ MEDIA_PROVIDERS, IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS_BY_KIND });
    expect(served).not.toMatch(/\bfal\b|fal\.(?:ai|run|media)|fal-ai|-fal\b/i);
  });
});

describe('superseded media models', () => {
  const catalogue = [...IMAGE_MODELS, ...VIDEO_MODELS, ...Object.values(AUDIO_MODELS_BY_KIND).flat()];

  it.each(retiredModels)('hides %s and resolves saved selections to %s', (id, successor) => {
    expect(catalogue.some(model => model.id === id)).toBe(false);
    expect(canonicalMediaModelId(id)).toBe(successor);
    expect(findMediaModel(id)?.id).toBe(successor);
    expect(canonicalMediaModelId(successor)).toBe(successor);
  });

  it.each(['kling-2.0', 'wan-2.1-t2v', 'wan-2.1-i2v', 'aihubmix-gpt-image-1',
    'midjourney-v7', 'elevenlabs-v3', 'minimax-video-01', 'flux-dev', 'flux-schnell'])('keeps %s without a newer same-provider sibling', id => {
    expect(catalogue.some(model => model.id === id)).toBe(true);
    expect(canonicalMediaModelId(id)).toBe(id);
  });

  it('preserves unknown custom model ids', () => {
    expect(canonicalMediaModelId('custom-deployment')).toBe('custom-deployment');
    expect(findMediaModel('custom-deployment')).toBeNull();
    expect(canonicalMediaModelId('constructor')).toBe('constructor');
  });

  it('migrates recipe recommendations, fallbacks, and explicit overrides before selecting', () => {
    const recipe = { surface: 'image', models: { requires: ['t2i'], recommended: ['dall-e-2'], fallback: [] } } as unknown as Recipe;
    const providers = new Set(['openai']);
    expect(selectRecipeModel(recipe, IMAGE_MODELS, providers).id).toBe('dall-e-3');
    expect(selectRecipeModel(recipe, IMAGE_MODELS, providers, 'gpt-image-1').id).toBe('gpt-image-2');
    recipe.models = { ...recipe.models!, recommended: [], fallback: ['dall-e-2'] };
    expect(selectRecipeModel(recipe, IMAGE_MODELS, providers).id).toBe('dall-e-3');
  });
});
