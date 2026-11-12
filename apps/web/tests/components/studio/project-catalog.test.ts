import { expect, it } from 'vitest';
import type { ArtStyle, ProjectAsset } from '@openpixo/contracts';
import { recipeGroup, suggestedArtStyle } from '../../../src/components/studio/project-catalog';

it.each([
  [{ id: 'walk-cycle', surface: 'image', category: 'character' }, 'art'],
  [{ id: 'trailer', surface: 'video', category: 'vfx' }, 'art'],
  [{ id: 'jump-sound', surface: 'audio', category: 'sfx' }, 'audio'],
  [{ id: 'prop-model', surface: 'model3d', category: 'model3d' }, 'model3d'],
  [{ id: 'save-system', surface: 'code', category: 'feature' }, 'features'],
  [{ id: 'phaser-starter', surface: 'code', category: 'code' }, 'starters'],
  [{ id: 'blank-game', surface: 'code', category: 'starter' }, 'starters'],
  [{ id: 'platformer-godot', surface: 'code', category: 'code' }, 'starters'],
  // A code recipe with any other category is still something you add to a game.
  [{ id: 'dialogue', surface: 'code', category: 'code' }, 'features'],
  // "Starter" is a kind of code project: an image recipe named after one is still art.
  [{ id: 'starter-icons', surface: 'image', category: 'icon' }, 'art'],
] as const)('sorts %o by what it makes', (recipe, group) => {
  expect(recipeGroup(recipe)).toBe(group);
});

const styles = ['pixel-8-bit', 'pixel-16-bit'].map(id => ({
  id, title: id, description: id, prompt: id, negativePrompt: '', previews: [], license: 'CC0-1.0', dimension: ['2d'], medium: ['pixel'],
}) as ArtStyle);
const asset: ProjectAsset = { projectId: 'game', relPath: 'player.png', kind: 'image', size: 100, mtime: 1,
  width: 192, height: 32, semantics: [], tags: [], indexedAt: 1, origin: 'imported' };

it.each([[undefined, 'pixel-16-bit'], [24, 'pixel-16-bit'], [4, 'pixel-8-bit'], [2, 'pixel-8-bit'], [0, undefined], [300, undefined]] as const)(
  'suggests a pixel style for %s visible colors without depending on catalogue order', (colors, expected) => {
    expect(suggestedArtStyle(styles, [asset], '2d', colors)).toBe(expected);
    expect(suggestedArtStyle([...styles].reverse(), [asset], '2d', colors)).toBe(expected);
  });

it('does not suggest a 2D pixel style for a 3D project or a large painting', () => {
  expect(suggestedArtStyle(styles, [asset], '3d')).toBeUndefined();
  expect(suggestedArtStyle(styles, [{ ...asset, width: 1024, height: 1024 }], '2d')).toBeUndefined();
});
