import type { ArtStyle, EngineProfile, GameEngineId, ProjectAsset, RecipeSummary } from '@openpixo/contracts';
import { smallPixelArtAssets } from './project-art-palette';

export type ProjectArtDimension = '2d' | '3d';

const engineName = (engine: string) => engine.toLowerCase().replace(/^(phaser3|phaser-3)$/, 'phaser')
  .replace(/^(godot4|godot-4)$/, 'godot').replace(/^three\.js$/, 'threejs');

/** Unknown projects stay browsable; a known engine only sees compatible recipes by default. */
export function recipeMatchesEngine(recipe: Pick<RecipeSummary, 'engines'>, engine?: GameEngineId | null) {
  return !engine || engine === 'unknown' || recipe.engines.some(value => value === 'any' || engineName(value) === engineName(engine));
}

export function isStarterRecipe(recipe: Pick<RecipeSummary, 'surface' | 'category' | 'id'>) {
  return recipe.surface === 'code' && (recipe.category === 'starter' || /(?:^|[-/])starter(?:-|$)/i.test(recipe.id)
    || /^(platformer|roguelike|tower-defense)(?:-|$)/i.test(recipe.id));
}

export type RecipeGroup = 'art' | 'audio' | 'model3d' | 'features' | 'starters';

/** The order the Recipes section offers them in. */
export const RECIPE_GROUPS: readonly RecipeGroup[] = ['art', 'audio', 'model3d', 'features', 'starters'];

/** Sorts a recipe by what the user is making, which is how they come looking for it. */
export function recipeGroup(recipe: Pick<RecipeSummary, 'surface' | 'category' | 'id'>): RecipeGroup {
  if (isStarterRecipe(recipe)) return 'starters';
  switch (recipe.surface) {
    case 'audio': return 'audio';
    case 'model3d': return 'model3d';
    case 'code': return 'features';
    default: return 'art';
  }
}

export function projectArtDimension(profile: EngineProfile | null, templateId: string | undefined, assets: ProjectAsset[]): ProjectArtDimension | null {
  if (templateId && /(?:^|[-_])3d(?:[-_]|$)|threejs/.test(templateId)) return '3d';
  if (templateId && /(?:^|[-_])2d(?:[-_]|$)|phaser|platformer/.test(templateId)) return '2d';
  if (profile && ['phaser', 'rpg-maker', 'cocos-creator'].includes(profile.engine)) return '2d';
  if (profile && ['threejs', 'unreal'].includes(profile.engine)) return '3d';
  if (assets.some(asset => asset.kind === 'model3d')) return '3d';
  return assets.some(asset => asset.kind === 'image') ? '2d' : null;
}

/** A local hint from original sprite pixels; it never changes the saved project style. */
export function suggestedArtStyle(styles: ArtStyle[], assets: ProjectAsset[], dimension: ProjectArtDimension | null, colorCount?: number | null) {
  if (dimension === '3d' || !smallPixelArtAssets(assets).length || (colorCount != null && (colorCount === 0 || colorCount > 256))) return undefined;
  const preferred = colorCount != null && colorCount <= 4 ? 'pixel-8-bit' : 'pixel-16-bit';
  const pixelStyles = styles.filter(style => style.dimension.includes('2d') && (style.medium.some(value => /pixel/i.test(value)) || !!style.constraints?.pixelSize));
  return pixelStyles.find(style => style.id === preferred)?.id
    ?? pixelStyles.find(style => style.id === 'pixel-16-bit')?.id;
}

export function recipePreviewSource(recipe: Pick<RecipeSummary, 'preview'>) {
  return recipe.preview && /^(?:\/(?:api|artifacts)\/|https?:\/\/)/i.test(recipe.preview) ? recipe.preview : undefined;
}
