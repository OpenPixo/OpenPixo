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
  expect(recipes.map(recipe => recipe.id).sort()).toEqual(['item-icon-set', 'sprite-idle-8dir', 'sprite-walk-8dir', 'vfx-sequence']);
  // A video recipe's cells come from its clip, not a square grid it asks a picture model for.
  for (const detail of recipes.filter(detail => detail.manifest.pixo!.recipe!.surface !== 'video')) {
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

it('cuts the walk clip into the 4x2 grid its sheet is drawn on, one animation per cell', () => {
  const recipes = discoverRecipes(bundled);
  const sheet = recipes.find(recipe => recipe.id === 'sprite-walk-sheet-8dir')!.manifest.pixo!.recipe!;
  const walk = recipes.find(recipe => recipe.id === 'sprite-walk-8dir')!.manifest.pixo!.recipe!;
  expect(sheet.generation?.aspect).toBe('16:9');
  expect(sheet.postprocess?.[0]).toMatchObject({ op: 'resize', params: { width: 1344, height: 768 } });
  expect(sheet.prompt).toMatch(/4 columns by 2 rows/);
  expect(walk.acts).toEqual({ on: ['image'], recipes: ['openpixo/sprite-walk-sheet-8dir'] });
  expect(walk.generation?.video).toEqual({ duration: 0.92, resolution: '768p', loop: true });
  expect(walk.models?.requires).toEqual(['i2v-loop']);
  const steps = walk.postprocess!;
  expect(steps.map(step => step.op)).toEqual(['video-frames', 'resize', 'remove-bg', 'slice', 'export-spritesheet']);
  // Intermediate frames feed the next step; only the engine sheet is staged and saved.
  expect(steps.slice(0, -1).every(step => step.keep === false)).toBe(true);
  const resize = steps[1]!.params!, grid = String(steps[3]!.params!.grid).split('x').map(Number) as [number, number];
  expect(Number(resize.width) % grid[0]).toBe(0);
  expect(Number(resize.height) % grid[1]).toBe(0);
  const exported = steps[4]!.params!;
  expect(exported.order).toBe('by-cell');
  expect((exported.animations as string[]).length).toBe(grid[0] * grid[1]);
  // The sheet's reading order, top row then bottom row, is the animation order.
  expect(exported.animations).toEqual(['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left']);
  expect(sheet.prompt).toMatch(/Top row, left to right: facing the viewer, facing down-right, facing right in side profile, facing up-right seen from behind\. Bottom row, left to right: back to the viewer, facing up-left seen from behind, facing left in side profile, facing down-left\./);
});

it('animates the idle sheet the way the walk does, at half speed', () => {
  const recipes = discoverRecipes(bundled);
  const recipe = (id: string) => recipes.find(entry => entry.id === id)!.manifest.pixo!.recipe!;
  const walkSheet = recipe('sprite-walk-sheet-8dir'), walk = recipe('sprite-walk-8dir');
  const sheet = recipe('sprite-idle-sheet-8dir'), idle = recipe('sprite-idle-8dir');
  // Same canvas, grid and order as the walk sheet, so a character's states line up.
  expect(sheet.generation?.aspect).toBe(walkSheet.generation?.aspect);
  expect(sheet.postprocess).toEqual(walkSheet.postprocess);
  expect(sheet.prompt).toMatch(/Top row, left to right: facing the viewer, facing down-right, facing right in side profile, facing up-right seen from behind\. Bottom row, left to right: back to the viewer, facing up-left seen from behind, facing left in side profile, facing down-left\./);
  expect(sheet.prompt).not.toMatch(/mid-stride/);
  expect(idle.acts).toEqual({ on: ['image'], recipes: ['openpixo/sprite-idle-sheet-8dir'] });
  // One hosted clip for both: same length, size and loop.
  expect(idle.generation?.video).toEqual(walk.generation?.video);
  expect(idle.models?.requires).toEqual(walk.models?.requires);
  const steps = idle.postprocess!, walkSteps = walk.postprocess!;
  expect(steps.slice(0, -1)).toEqual(walkSteps.slice(0, -1));
  const exported = steps.at(-1)!.params!;
  expect(exported).toMatchObject({ name: 'idle', order: 'by-cell', animations: walkSteps.at(-1)!.params!.animations });
  // A breath at the clip's own speed looks rushed; 21 frames play at 12 fps.
  expect(exported.loopSeconds).toBe(2 * Number(walkSteps.at(-1)!.params!.loopSeconds));
});

// Accepted only after real-provider runs recorded in the recipe's evals/README.md.
// Each names the real provider and model it was accepted on.
const ACCEPTED_RECIPES: Record<string, RegExp> = {
  'sprite-walk-sheet-8dir': /`codex-image`/,
  'sprite-walk-8dir': /`h3-max-turbo-gateway`/,
};

it('publishes honest acceptance status for the bundled catalogue and meaningful code categories', async () => {
  const recipes = discoverRecipes(bundled);
  expect(recipes).toHaveLength(36);
  for (const recipe of recipes) {
    const evaluation = await readFile(path.join(bundled, 'recipes', recipe.id, 'evals/README.md'), 'utf8');
    if (ACCEPTED_RECIPES[recipe.id]) {
      expect(evaluation).toMatch(/^Status: passed/m);
      expect(evaluation).toMatch(ACCEPTED_RECIPES[recipe.id]!);
      expect(recipe.verified).toBe(true);
    } else {
      expect(evaluation).toMatch(/Status: pending/);
      expect(recipe.verified).toBe(false);
    }
    if (recipe.surface === 'code') expect(recipe.category).toBe(recipe.id.startsWith('starter-') ? 'starter' : 'feature');
  }
});
