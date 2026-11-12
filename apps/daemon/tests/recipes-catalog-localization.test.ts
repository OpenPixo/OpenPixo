import { expect, it } from 'vitest';
import { PluginManifestSchema } from '@openpixo/contracts';
import { recipeSummaries } from '../src/recipes/catalog.js';
import { recipeDetail } from './fixtures/recipes.js';

it('keeps manifest title and description translations on recipe summaries for UI locale selection', () => {
  const recipe = recipeDetail();
  recipe.manifest = PluginManifestSchema.parse({ ...recipe.manifest,
    title_i18n: { en: recipe.title, 'zh-CN': '循环背景音乐' },
    description_i18n: { en: 'A looping track.', 'zh-CN': '适合游戏场景的循环音乐。' },
  });
  expect(recipeSummaries([recipe])).toMatchObject([{
    id: recipe.id,
    title_i18n: recipe.manifest.title_i18n,
    description_i18n: recipe.manifest.description_i18n,
  }]);
  expect(recipeSummaries([recipe])[0]).not.toHaveProperty('manifest');
});
