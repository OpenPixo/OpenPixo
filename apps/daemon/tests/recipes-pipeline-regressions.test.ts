import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { discoverRecipes, recipeSummaries, gameRecipePromptEntries } from '../src/recipes/catalog.js';
import { recipeVariables, renderRecipeParams, renderRecipeTemplate } from '../src/recipes/template.js';
import { recipeManifest } from './fixtures/recipes.js';

const bundled = path.resolve(import.meta.dirname, '../../../plugins/_official');

it('keeps every selectable grid divisible with the square cells promised by its prompt', () => {
  const recipes = discoverRecipes(bundled).filter(detail => detail.manifest.pixo!.recipe!.postprocess?.some(step => step.op === 'slice'));
  expect(recipes.map(recipe => recipe.id).sort()).toEqual(['item-icon-set', 'sprite-walk-8dir', 'vfx-sequence']);
  for (const detail of recipes) {
    const recipe = detail.manifest.pixo!.recipe!;
    let variants: Record<string, unknown>[] = [{}];
    for (const input of recipe.inputs) {
      const values = input.options ?? [input.default ?? 'fixture'];
      variants = variants.flatMap(variant => values.map(value => ({ ...variant, [input.name]: value })));
    }
    for (const inputs of variants) {
      const variables = { ...recipeVariables(inputs), 'character.name': 'Hero', 'character.description': 'A test hero' };
      let width = 0, height = 0;
      for (const step of recipe.postprocess!) {
        const params = renderRecipeParams(step.params, variables);
        if (step.op === 'resize') { width = Number(params.width); height = Number(params.height); }
        if (step.op !== 'slice') continue;
        const [columns, rows] = String(params.grid).split('x').map(Number) as [number, number];
        const label = `${detail.id} ${JSON.stringify(inputs)}`;
        expect(width % columns, label).toBe(0);
        expect(height % rows, label).toBe(0);
        expect(width / columns, label).toBe(height / rows);
        const prompt = renderRecipeTemplate(recipe.prompt!, variables);
        expect(prompt, label).toMatch(/square cells/);
        const [aspectWidth, aspectHeight] = renderRecipeTemplate(recipe.generation!.aspect!, variables).split(':').map(Number) as [number, number];
        expect(aspectWidth / aspectHeight, label).toBe(columns / rows);
      }
    }
  }
});

it('derives verified from an explicit passing evaluation status, defaulting to false', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'recipe-verification-'));
  try {
    const folder = path.join(root, 'recipes/test-sprite');
    await mkdir(path.join(folder, 'evals'), { recursive: true });
    await writeFile(path.join(folder, 'pixo.json'), JSON.stringify(recipeManifest()));
    for (const [status, expected] of [[null, false], ['pending', false], ['failed', false], ['passed', true], ['verified', true], ['pending\nA test passed locally.', false]] as const) {
      if (status === null) await rm(path.join(folder, 'evals/README.md'), { force: true });
      else await writeFile(path.join(folder, 'evals/README.md'), `# Evaluation\n\nStatus: ${status}\n`);
      const details = discoverRecipes(root);
      expect(details[0]?.verified, String(status)).toBe(expected);
      expect(recipeSummaries(details)[0]?.verified, String(status)).toBe(expected);
      expect(gameRecipePromptEntries(root, 'phaser')[0]?.verified, String(status)).toBe(expected);
    }
    const { verified: _verified, ...legacy } = discoverRecipes(root)[0]!;
    expect(recipeSummaries([legacy])[0]?.verified).toBe(false);
  } finally {
    if (!path.resolve(root).startsWith(path.join(tmpdir(), 'recipe-verification-'))) throw new Error('Unsafe cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});

// Accepted only after real-provider runs recorded in the recipe's evals/README.md.
const ACCEPTED_RECIPES = ['sprite-walk-8dir'];

it('publishes honest acceptance status for the bundled catalogue and meaningful code categories', async () => {
  const recipes = discoverRecipes(bundled);
  expect(recipes).toHaveLength(33);
  for (const recipe of recipes) {
    const evaluation = await readFile(path.join(bundled, 'recipes', recipe.id, 'evals/README.md'), 'utf8');
    if (ACCEPTED_RECIPES.includes(recipe.id)) {
      expect(evaluation).toMatch(/^Status: passed/m);
      // The record names the real provider and model it was accepted on.
      expect(evaluation).toMatch(/`codex-cli` \/ `codex-image`/);
      expect(recipe.verified).toBe(true);
    } else {
      expect(evaluation).toMatch(/Status: pending/);
      expect(recipe.verified).toBe(false);
    }
    if (recipe.surface === 'code') expect(recipe.category).toBe(recipe.id.startsWith('starter-') ? 'starter' : 'feature');
  }
});
