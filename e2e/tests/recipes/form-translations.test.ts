import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLocalizedText } from '@openpixo/contracts';
import { discoverRecipes } from '../../../apps/daemon/src/recipes/catalog.js';
import { recipeVariables, renderRecipeTemplate, validateRecipeInputs } from '../../../apps/daemon/src/recipes/template.js';

const bundled = path.join(path.resolve(import.meta.dirname, '../../..'), 'plugins/_official');
const LOCALE = 'zh-CN';
const CJK = /\p{Script=Han}/u;

/** File names and folder names: the field asks for lowercase with no spaces, so an example stays one. */
const isIdentifier = (text: string) => /^[a-z0-9_]+$/.test(text);
/** Numbers, grids and file formats read the same in every language. */
const isNeutralOption = (text: string) => /^-?\d+(?:x\d+)?$/.test(text) || text === 'ogg' || text === 'wav';
/** A list of language codes the recipe reads literally. */
const CODE_DEFAULTS = new Set(['feature-localization.languages']);

const recipes = discoverRecipes(bundled);

describe('recipe forms in Simplified Chinese', () => {
  it('[P1] discovers the whole catalogue, so no invalid manifest is silently dropped', () => {
    const root = path.join(bundled, 'recipes');
    const folders = readdirSync(root).filter((name) => existsSync(path.join(root, name, 'pixo.json')));
    expect(recipes.map((recipe) => recipe.id).sort()).toEqual(folders.sort());
    expect(recipes.length).toBeGreaterThan(0);
  });

  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))('[P1] %s reads fully in Chinese', (id, recipe) => {
    for (const input of recipe.manifest.pixo!.recipe!.inputs) {
      const where = `${id}.${input.name}`;
      expect(input.label_i18n?.[LOCALE], `${where} label`).toMatch(CJK);

      if (input.placeholder && !isIdentifier(input.placeholder)) {
        expect(input.placeholder_i18n?.[LOCALE], `${where} placeholder`).toMatch(CJK);
      }

      for (const option of input.options ?? []) {
        if (isNeutralOption(option)) continue;
        expect(input.optionLabels_i18n?.[LOCALE]?.[option], `${where} option "${option}"`).toMatch(CJK);
      }

      const freeText = input.type === undefined || input.type === 'string' || input.type === 'text';
      if (freeText && typeof input.default === 'string' && !CODE_DEFAULTS.has(where)) {
        expect(input.default_i18n?.[LOCALE], `${where} default`).toMatch(CJK);
      }
    }
  });

  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))('[P1] %s keeps select defaults among the values it accepts', (id, recipe) => {
    for (const input of recipe.manifest.pixo!.recipe!.inputs) {
      if (input.type === 'select' && input.default !== undefined) {
        expect(input.options, `${id}.${input.name}`).toContain(input.default);
      }
    }
  });

  it.each(recipes.filter((recipe) => recipe.surface === 'code').map((recipe) => [recipe.id, recipe] as const))('[P1] %s accepts its Chinese prefills and writes them into the task', (id, recipe) => {
    const manifest = recipe.manifest;
    const inputs = manifest.pixo!.recipe!.inputs;
    const supplied = Object.fromEntries(inputs.filter((input) => input.default_i18n).map((input) => [input.name, input.default_i18n![LOCALE]!]));

    const validated = validateRecipeInputs(manifest.pixo!.recipe!, supplied);
    expect(validated, id).toMatchObject(supplied);

    const query = renderRecipeTemplate(resolveLocalizedText(manifest.pixo!.useCase!.query, 'en'), recipeVariables(validated));
    for (const text of Object.values(supplied)) expect(query, id).toContain(text);
  });
});
