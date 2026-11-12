import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PluginManifestSchema, resolveLocalizedText } from '@openpixo/contracts';
import { discoverRecipes, findRecipe, recipeSummaries } from '../../../apps/daemon/src/recipes/catalog.js';
import { detectEngineProfile } from '../../../apps/daemon/src/game/engine-detect.js';
import { recipeVariables, renderRecipeTemplate, validateRecipeInputs } from '../../../apps/daemon/src/recipes/template.js';

const repo = path.resolve(import.meta.dirname, '../../..');
const bundled = path.join(repo, 'plugins/_official');
const starterIds = [
  'starter-card-battler', 'starter-cozy-farm', 'starter-deckbuilder-roguelite',
  'starter-idle-incremental', 'starter-match3', 'starter-platformer',
  'starter-roguelike-dungeon', 'starter-survivors', 'starter-topdown-shooter', 'starter-tower-defense',
];
const templates = [
  ['godot', 'godot4-2d'],
  ['phaser', 'phaser3-vite'],
] as const;

describe('bundled genre starters', () => {
  it.each(templates)('[P1] lists every starter for the %s template', (engine) => {
    const summaries = recipeSummaries(discoverRecipes(bundled), { surface: 'code', category: 'starter', engine });
    expect(summaries.map(recipe => recipe.id).sort()).toEqual(starterIds);
    for (const recipe of summaries) {
      expect(recipe.engines).toEqual(['godot', 'phaser']);
      expect(recipe.title_i18n?.['zh-CN']).toBeTruthy();
      expect(recipe.description_i18n?.['zh-CN']).toBeTruthy();
      expect(recipe.verified).toBe(false);
    }
    expect(recipeSummaries(discoverRecipes(bundled), { category: 'starter', engine: 'threejs' })).toEqual([]);
  });

  it.each(starterIds)('[P1] loads %s and renders all input choices for either engine', (id) => {
    // Parse each file independently as well: discovery deliberately skips invalid manifests.
    const manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(path.join(bundled, 'recipes', id, 'pixo.json'), 'utf8')));
    const detail = findRecipe(discoverRecipes(bundled), manifest.name);
    expect(detail.id).toBe(id);
    expect(manifest.tags).toEqual(expect.arrayContaining(['template:godot4-2d', 'template:phaser3-vite']));
    expect(manifest.pixo!.context!.skills!.map(skill => skill.ref)).toEqual(['godot-gdscript', 'phaser-game-dev']);
    const recipe = manifest.pixo!.recipe!;
    let variants: Record<string, unknown>[] = [{}];
    for (const input of recipe.inputs) {
      variants = variants.flatMap(variant => (input.options ?? [input.default]).map(value => ({ ...variant, [input.name]: value })));
    }
    for (const [engine, template] of templates) {
      const profile = detectEngineProfile(path.join(repo, 'game-templates', template, 'files'), { resolveOnPath: () => null });
      expect(profile.engine).toBe(engine);
      for (const supplied of variants) {
        const inputs = validateRecipeInputs(recipe, supplied);
        const query = renderRecipeTemplate(resolveLocalizedText(manifest.pixo!.useCase!.query, 'en'), recipeVariables(inputs, profile));
        expect(query).toContain(`Project engine: ${engine}`);
        expect(query).not.toContain('{{');
        for (const value of Object.values(inputs)) expect(query).toContain(String(value));
        expect(query).toContain('pixo game verify --steps check,build,run --screenshot --json');
      }
    }
  });
});
