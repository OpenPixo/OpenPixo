import { describe, expect, it } from 'vitest';
import { PluginManifestSchema } from '@openpixo/contracts';
import { recipeManifest } from './fixtures/recipes.js';
import { selectRecipeModel } from '../src/recipes/models.js';
import { parseRecipeInputs } from '../src/recipes/cli-common.js';
import { codeRecipeWaitExitCode, recipeWaitExitCode } from '../src/recipes/recipe-cli.js';
import { renderRecipeParams, renderRecipeTemplate } from '../src/recipes/template.js';

describe('recipe manifest and CLI contracts', () => {
  it('accepts recipe manifests and rejects unknown variables, unsafe directories, and input types', () => {
    expect(PluginManifestSchema.safeParse(recipeManifest()).success).toBe(true);
    for (const value of [
      { ...recipeManifest().pixo.recipe, prompt: '{{missing}}' },
      { ...recipeManifest().pixo.recipe, output: { dir: '../escape', name: 'hero' } },
      { ...recipeManifest().pixo.recipe, output: { dir: 'C:\\escape', name: 'hero' } },
      { ...recipeManifest().pixo.recipe, inputs: [{ name: 'x', type: 'expression' }] },
    ]) expect(PluginManifestSchema.safeParse({ ...recipeManifest(), pixo: { kind: 'recipe', recipe: value } }).success).toBe(false);
    expect(() => renderRecipeTemplate('{{style}}', {})).toThrow('Missing template variable');
    expect(renderRecipeParams({ width: '{{size}}', grid: '{{frames}}x8', lufs: '{{lufs}}' }, { size: '64', frames: 6, lufs: '-18' })).toEqual({ width: 64, grid: '6x8', lufs: -18 });
    const code = { name: 'save-system', version: '0.1.0', pixo: { kind: 'recipe', recipe: { surface: 'code', category: 'code', inputs: [{ name: 'slot', type: 'text' }] }, useCase: { query: 'Add {{slot}}' }, context: { skills: [{ ref: 'save-game' }] } } };
    expect(PluginManifestSchema.safeParse(code).success).toBe(true);
    expect(PluginManifestSchema.safeParse({ ...code, pixo: { ...code.pixo, useCase: { query: 'Add {{typo}}' } } }).success).toBe(false);
  });
  it.each([
    [['a', 'b'], ['t2i'], 'first'],
    [['b'], ['t2i'], 'fallback'],
    [['a', 'b'], ['i2i'], 'fallback'],
    [[], ['t2i'], null],
    [['a'], ['loop'], null],
  ] as const)('selects configured capable models (%j / %j)', (providers, requires, expected) => {
    const recipe = PluginManifestSchema.parse(recipeManifest()).pixo!.recipe!;
    recipe.models = { requires: [...requires], recommended: ['first'], fallback: ['fallback'] };
    const models = [
      { id: 'first', provider: 'a', label: '', hint: '', caps: ['t2i'] },
      { id: 'fallback', provider: 'b', label: '', hint: '', caps: ['t2i', 'i2i'] },
    ];
    if (expected) expect(selectRecipeModel(recipe, models, new Set(providers)).id).toBe(expected);
    else expect(() => selectRecipeModel(recipe, models, new Set(providers))).toThrow('No usable model');
  });
  it('parses stdin JSON inputs with repeatable overrides and maps wait exit codes', () => {
    expect(parseRecipeInputs('{"style":"ink","frames":6}', ['style=pixel', 'prompt=a=b'])).toEqual({ style: 'pixel', frames: 6, prompt: 'a=b' });
    expect(() => parseRecipeInputs('[]')).toThrow('JSON object');
    expect(['queued', 'generating', 'postprocessing', 'ready', 'failed', 'cancelled'].map(status => recipeWaitExitCode(status as Parameters<typeof recipeWaitExitCode>[0]))).toEqual([2, 2, 2, 0, 5, 5]);
    expect(['queued', 'running', 'succeeded', 'failed', 'canceled'].map(status => codeRecipeWaitExitCode(status as Parameters<typeof codeRecipeWaitExitCode>[0]))).toEqual([2, 2, 0, 5, 5]);
  });
});
