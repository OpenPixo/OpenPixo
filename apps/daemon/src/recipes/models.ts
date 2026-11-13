import type { Recipe } from '@openpixo/contracts';
import { AUDIO_MODELS_BY_KIND, IMAGE_MODELS, MODEL3D_MODELS, VIDEO_MODELS, MEDIA_PROVIDERS, canonicalMediaModelId, type MediaModel } from '../media/models.js';

export class RecipeNoModelError extends Error { readonly code = 'RECIPE_NO_MODEL'; }
export function modelsForRecipe(recipe: Recipe): MediaModel[] {
  if (recipe.surface === 'image') return IMAGE_MODELS;
  if (recipe.surface === 'video') return VIDEO_MODELS;
  if (recipe.surface === 'audio') return Object.values(AUDIO_MODELS_BY_KIND).flat();
  if (recipe.surface === 'model3d') return MODEL3D_MODELS;
  return [];
}

/**
 * The hosted models a recipe may fall back to once every own tool is out: paid from
 * the art budget for an agent, or at a price the user confirmed. A recipe with
 * references needs the image edit service. Audio picks the one service that makes
 * its kind (the recipe's required capability decides). 3D starts at the default,
 * medium tier; the other tiers are reached by naming them with `model`. Hosted audio
 * arrives as mp3, which every audio post-processing step reads.
 */
export function hostedRecipeModelIds(recipe: Recipe, hasReferences: boolean): string[] {
  if (recipe.surface === 'image') return hasReferences ? ['openpixo-image-edit'] : ['openpixo-image', 'openpixo-image-edit'];
  if (recipe.surface === 'audio') return ['openpixo-sfx', 'openpixo-voice', 'openpixo-music'];
  if (recipe.surface === 'model3d') return hasReferences ? ['openpixo-model3d', 'openpixo-model3d-draft', 'openpixo-model3d-high'] : [];
  return [];
}

/**
 * Own tools first, in the recipe's order, then Codex; `hosted` (paid from the art
 * budget) only after all of them, so a recipe never spends credits while a tool that
 * costs nothing extra could make the image.
 */
export function selectRecipeModel(recipe: Recipe, models: MediaModel[], availableProviders: ReadonlySet<string>, override?: string, hosted: readonly string[] = []): MediaModel {
  const preferredIds = [...(recipe.models?.recommended ?? []), ...(recipe.models?.fallback ?? [])]
    .filter(id => id !== 'codex-image');
  const fits = (model: MediaModel | undefined): model is MediaModel => Boolean(model) && (recipe.models?.requires ?? []).every(cap => model!.caps.includes(cap));
  const find = (id: string) => models.find(model => model.id === canonicalMediaModelId(id));
  const own = override ? [override] : [...preferredIds,
    ...models.filter(model => model.provider !== 'codex-cli' && availableProviders.has(model.provider)).map(model => model.id),
    'codex-image'];
  for (const id of own) {
    const model = find(id);
    if (fits(model) && availableProviders.has(model.provider)) return model;
  }
  for (const id of override ? [override] : hosted) {
    const model = find(id);
    if (fits(model) && hosted.includes(model.id)) return model;
  }
  throw new RecipeNoModelError('No usable model: configure a provider with the required capabilities in Settings → Media providers.');
}
export function configuredRecipeProviders(config: { providers: Record<string, { configured: boolean; baseUrl?: string; available?: boolean; keyless?: boolean }> }, testMode: boolean): Set<string> {
  // Hosted models spend credits, so they are never "configured": the recipe route adds
  // them for an agent's image recipe only, priced and reserved against the art budget.
  return new Set(MEDIA_PROVIDERS.filter(provider => provider.integrated && provider.id !== 'hyperframes' && provider.id !== 'openpixo'
    && (provider.id === 'stub' ? testMode : provider.id === 'codex-cli' ? config.providers[provider.id]?.available === true : config.providers[provider.id]?.configured
      || (provider.id === 'custom-image' && Boolean(config.providers[provider.id]?.baseUrl))))
    .map(provider => provider.id));
}
