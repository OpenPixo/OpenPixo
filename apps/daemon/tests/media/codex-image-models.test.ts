import { describe, expect, it } from 'vitest';
import type { Recipe } from '@openpixo/contracts';
import { findMediaModel, findProvider, IMAGE_MODELS } from '../../src/media/models.js';
import { configuredRecipeProviders, selectRecipeModel } from '../../src/recipes/models.js';

const recipe = (models: Partial<NonNullable<Recipe['models']>> = {}) => ({ surface: 'image',
  models: { requires: ['t2i'], recommended: [], fallback: [], ...models } }) as Recipe;

describe('Codex sign-in image model', () => {
  it('registers an integrated image provider without an API key', () => {
    expect(findProvider('codex-cli')).toMatchObject({ integrated: true, credentialsRequired: false });
    expect(findMediaModel('codex-image')).toMatchObject({ provider: 'codex-cli', caps: ['t2i', 'i2i'] });
  });

  it('uses a ready keyless provider for recipes without a configured recommendation', () => {
    const config = { providers: { 'codex-cli': { configured: false, available: true, keyless: true } } };
    const providers = configuredRecipeProviders(config, false);
    expect(providers.has('codex-cli')).toBe(true);
    expect(selectRecipeModel(recipe(), IMAGE_MODELS, providers).id).toBe('codex-image');
  });

  it('keeps configured paid recommendations ahead of the keyless fallback', () => {
    const providers = new Set(['openai', 'codex-cli']);
    expect(selectRecipeModel(recipe({ recommended: ['gpt-image-2'], requires: ['t2i'] }), IMAGE_MODELS, providers).id).toBe('gpt-image-2');
    expect(selectRecipeModel(recipe({ recommended: ['gpt-image-2'], requires: ['t2i'] }), IMAGE_MODELS, providers, 'codex-image').id).toBe('codex-image');
  });


  it('uses configured paid models before Codex unless Codex was explicitly selected', () => {
    const providers = new Set(['openai', 'codex-cli']);
    expect(selectRecipeModel(recipe(), IMAGE_MODELS, providers).provider).toBe('openai');
    expect(selectRecipeModel(recipe({ recommended: ['codex-image'] }), IMAGE_MODELS, providers).provider).toBe('openai');
    expect(selectRecipeModel(recipe({ requires: ['i2i'] }), IMAGE_MODELS, new Set(['codex-cli'])).id).toBe('codex-image');
  });
  it('never treats a missing sign-in as available or overrides an explicit unavailable choice', () => {
    const config = { providers: { 'codex-cli': { configured: false, available: false, keyless: true } } };
    expect(configuredRecipeProviders(config, false).has('codex-cli')).toBe(false);
    expect(() => selectRecipeModel(recipe(), IMAGE_MODELS, new Set(['codex-cli']), 'missing-model')).toThrow();
  });
});
