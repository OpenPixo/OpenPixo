import { readFileSync, readdirSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { GAME_RECIPES_PROMPT_LIMIT, PluginManifestSchema, resolveLocalizedText, type GameRecipePromptEntry, type RecipeDetail, type RecipeSummary } from '@openpixo/contracts';

export interface RecipeFilter { surface?: string; category?: string; engine?: string }

/** Only an explicit passing real-provider evaluation marks a recipe as verified. */
export function recipeEvaluationVerified(evaluation: string): boolean {
  const status = /^\s*Status:\s*([a-z-]+)/im.exec(evaluation)?.[1]?.toLowerCase();
  return status === 'passed' || status === 'verified';
}

function readVerification(folder: string): boolean {
  try { return recipeEvaluationVerified(readFileSync(path.join(folder, 'evals', 'README.md'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[recipes] Cannot read evaluation for ${path.basename(folder)}`);
    return false;
  }
}

/** BUNDLED_PLUGINS_DIR is already resolved for both source and packaged runtimes. */
export function discoverRecipes(bundledPluginsDir: string): RecipeDetail[] {
  const root = path.join(bundledPluginsDir, 'recipes');
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const recipes: RecipeDetail[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(path.join(root, entry.name, 'pixo.json'), 'utf8')));
      const recipe = manifest.pixo?.recipe;
      if (manifest.pixo?.kind !== 'recipe' || !recipe) continue;
      recipes.push({ id: entry.name, title: manifest.title ?? manifest.name, description: manifest.description ?? '',
        version: manifest.version, surface: recipe.surface, category: recipe.category, engines: recipe.engines,
        requires: recipe.models?.requires ?? [], verified: readVerification(path.join(root, entry.name)),
        ...(recipe.whenToUse ? { whenToUse: recipe.whenToUse } : {}), ...(recipe.dimension ? { dimension: recipe.dimension } : {}),
        ...(recipe.acts ? { acts: recipe.acts } : {}),
        ...(recipe.inputs.some(input => input.type === 'character-ref' && input.required) ? { needsGame: true } : {}),
        ...(manifest.pixo.preview?.poster ? { preview: manifest.pixo.preview.poster } : {}), manifest });
    } catch (error) { console.warn(`[recipes] Skipping invalid manifest ${entry.name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return recipes;
}

export function recipeSummaries(recipes: RecipeDetail[], filter: RecipeFilter = {}): RecipeSummary[] {
  return recipes.filter(recipe => (!filter.surface || recipe.surface === filter.surface)
    && (!filter.category || recipe.category === filter.category)
    && (!filter.engine || recipe.engines.includes('any') || recipe.engines.includes(filter.engine)))
    .map(({ manifest, ...summary }) => ({ ...summary, verified: summary.verified ?? false,
      title_i18n: manifest.title_i18n, description_i18n: manifest.description_i18n,
      ...(manifest.examples?.length ? { examples: manifest.examples } : {}) }));
}

export type RecipeExamplePicture = 'before' | 'after' | 'cover';
const EXAMPLE_PICTURE = /\.(?:png|jpe?g|webp|gif|avif)$/i;

/**
 * The file of one example picture a recipe's manifest lists, inside that recipe's own
 * folder, or null. Nothing a manifest does not name, and nothing outside the folder, is served.
 */
export async function resolveRecipeExamplePicture(bundledPluginsDir: string, recipe: RecipeDetail, index: number, which: string): Promise<string | null> {
  if (which !== 'before' && which !== 'after' && which !== 'cover') return null;
  const relative = Number.isSafeInteger(index) && index >= 0 ? recipe.manifest.examples?.[index]?.[which] : undefined;
  if (!relative || path.isAbsolute(relative) || /^[a-z]:/i.test(relative) || !EXAMPLE_PICTURE.test(relative)) return null;
  try {
    const root = await realpath(path.join(bundledPluginsDir, 'recipes', recipe.id));
    const target = await realpath(path.resolve(root, relative));
    const within = path.relative(root, target);
    if (!within || path.isAbsolute(within) || within === '..' || within.startsWith(`..${path.sep}`)) return null;
    return (await stat(target)).isFile() ? target : null;
  } catch { return null; }
}

export function findRecipe(recipes: RecipeDetail[], id: string): RecipeDetail {
  const recipe = recipes.find(recipe => recipe.id === id || recipe.manifest.name === id);
  if (!recipe) throw new Error(`Recipe not found: ${id}`);
  return recipe;
}

const promptRank = (recipe: RecipeDetail) => recipe.surface === 'code' ? 2 : recipe.category === 'plain' ? 1 : 0;

export function gameRecipePromptEntries(bundledPluginsDir: string, engine?: string, locale?: string): GameRecipePromptEntry[] {
  return discoverRecipes(bundledPluginsDir)
    .filter(recipe => recipe.engines.includes('any') || recipe.engines.includes(engine ?? 'unknown'))
    // Presets first, then the plain recipes (which do what a raw media call does), then code.
    .sort((a, b) => promptRank(a) - promptRank(b) || a.id.localeCompare(b.id))
    .slice(0, GAME_RECIPES_PROMPT_LIMIT)
    .map(recipe => ({ id: recipe.manifest.name, title: resolveLocalizedText(recipe.manifest.title_i18n, locale) || recipe.title, surface: recipe.surface, category: recipe.category,
      verified: recipe.verified ?? false }));
}
