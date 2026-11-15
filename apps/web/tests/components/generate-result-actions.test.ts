import { describe, expect, it } from 'vitest';
import type { RecipeCandidate, RecipeSummary } from '@openpixo/contracts';
import { resultActions } from '../../src/components/generate/ResultDetail';
import { parseSpriteSheetLayout, spriteSheetFiles } from '../../src/components/generate/SpriteSheetPreview';
import { generatePresets } from '../../src/components/generate/PresetCards';

const recipe = (id: string, extra: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id, title: id, description: '', version: '1.0.0', surface: 'image', category: 'character', engines: ['any'], requires: [], ...extra,
});
const walk = recipe('sprite-walk-8dir', { surface: 'video', acts: { on: ['image'], recipes: ['openpixo/sprite-walk-sheet-8dir'] } });
const variations = recipe('image-variations', { acts: { on: ['image'] } });
const picture: Pick<RecipeCandidate, 'stagedFiles'> = { stagedFiles: [{ role: 'primary', ref: '/runs/a/primary.png', mime: 'image/png' }] };

describe('walk actions on a result', () => {
  it('offers the walk only on a walk sheet, and a general image action on any picture', () => {
    const recipes = [walk, variations, recipe('sprite-walk-sheet-8dir')];
    expect(resultActions(recipes, { recipeId: 'sprite-walk-sheet-8dir' }, picture).map(entry => entry.id)).toEqual(['sprite-walk-8dir', 'image-variations']);
    expect(resultActions(recipes, { recipeId: 'image' }, picture).map(entry => entry.id)).toEqual(['image-variations']);
    // The idle animates only an idle sheet, and the walk does not show there.
    const idle = recipe('sprite-idle-8dir', { surface: 'video', acts: { on: ['image'], recipes: ['openpixo/sprite-idle-sheet-8dir'] } });
    expect(resultActions([walk, idle], { recipeId: 'sprite-idle-sheet-8dir' }, picture).map(entry => entry.id)).toEqual(['sprite-idle-8dir']);
    expect(resultActions([walk, idle], { recipeId: 'sprite-walk-sheet-8dir' }, picture).map(entry => entry.id)).toEqual(['sprite-walk-8dir']);
    // A sound takes no picture action.
    expect(resultActions(recipes, { recipeId: 'sprite-walk-sheet-8dir' }, { stagedFiles: [{ role: 'primary', ref: 'a.mp3', mime: 'audio/mpeg' }] })).toEqual([]);
  });

  it('keeps action recipes out of the presets', () => {
    expect(generatePresets([walk, variations, recipe('item-icon-set')], null).map(entry => entry.id)).toEqual(['item-icon-set']);
  });

  it('finds a result\'s sheet and reads only a well-formed layout', () => {
    const staged: Pick<RecipeCandidate, 'stagedFiles'> = { stagedFiles: [
      { role: 'primary', ref: 'C:\\runs\\a\\primary.mp4', mime: 'video/mp4' },
      { role: 'derived', ref: 'C:\\runs\\a\\derived\\4-export-spritesheet\\walk.png', mime: 'image/png' },
      { role: 'derived', ref: 'C:\\runs\\a\\derived\\4-export-spritesheet\\walk.aseprite.json', mime: 'application/json' },
      { role: 'derived', ref: 'C:\\runs\\a\\derived\\4-export-spritesheet\\walk.sheet.json', mime: 'application/json' },
    ] };
    expect(spriteSheetFiles(staged)).toEqual({ layout: 3, image: 1 });
    expect(spriteSheetFiles(picture)).toBeNull();
    const layout = { image: 'walk.png', cell: { width: 336, height: 384 }, columns: 21, rows: 8, fps: 24, loop: true,
      animations: ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left'] };
    expect(parseSpriteSheetLayout(layout)).toEqual(layout);
    expect(parseSpriteSheetLayout({ ...layout, rows: 7 })).toBeNull();
    expect(parseSpriteSheetLayout({ ...layout, fps: 0 })).toBeNull();
    expect(parseSpriteSheetLayout(null)).toBeNull();
  });
});
