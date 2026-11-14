import { describe, expect, it } from 'vitest';
import type { OpenPixoGenerationService, RecipeRun } from '@openpixo/contracts';
import {
  fileNameFrom, formFromRun, generateEstimate, generateFormReady, generateRequest, initialGenerateForm, ownToolMakes, presetEstimate, presetFitsBox,
  presetKind, presetReady, presetRequest, sizeOffer, withKind, withPreset, withStyle, type PresetRecipe,
} from '../../src/components/generate/generate-request';

const pricing = { longPromptTokens: 2000, longPromptCredits: 1, maxPromptTokens: 3000, extraReferenceCredits: 1 };
const service = (id: string, credits: number, surface: OpenPixoGenerationService['surface'] = 'image') =>
  ({ id, surface, label: id, credits, priceVersion: 1, maxPromptChars: 12000, aspects: [], styles: [], references: { min: 0, max: 4 }, pricing }) as OpenPixoGenerationService;

describe('the 生成 request', () => {
  it('names the file from the description, and falls back when it has no Latin letters', () => {
    expect(fileNameFrom('A wooden Treasure-Chest!', 'image')).toBe('a_wooden_treasure_chest');
    expect(fileNameFrom('一个木箱', 'image')).toBe('image');
    expect(fileNameFrom('x'.repeat(80), 'image')).toHaveLength(40);
  });

  it('asks each kind of its plain recipe, with the inputs that recipe takes', () => {
    const image = { ...initialGenerateForm('image'), text: 'a chest', references: ['art/a.png', 'art/b.png'], transparent: true, count: 3 };
    expect(generateRequest(image, { ownTool: false })).toEqual({ recipeId: 'image', count: 3,
      inputs: { prompt: 'a chest', aspect: '1:1', resolution: '1k', transparent: true, name: 'a_chest', reference: 'art/a.png', reference2: 'art/b.png' } });
    expect(generateRequest({ ...initialGenerateForm('sfx'), text: 'jump', seconds: 2 }, { ownTool: false }))
      .toEqual({ recipeId: 'sound-effect', count: 3, inputs: { prompt: 'jump', duration: 2, name: 'jump' } });
    expect(generateRequest({ ...initialGenerateForm('voice'), text: 'Welcome back', voice: 'Aria' }, { ownTool: false }))
      .toEqual({ recipeId: 'npc-voice-lines', count: 1, inputs: { line: 'Welcome back', voice: 'Aria', name: 'welcome_back' } });
    expect(generateRequest({ ...initialGenerateForm('music'), text: 'calm village' }, { ownTool: false }))
      .toEqual({ recipeId: 'music', count: 1, inputs: { prompt: 'calm village', name: 'calm_village' } });
  });

  it('names the 3D tier only when credits pay for it', () => {
    const form = { ...initialGenerateForm('model3d'), references: ['props/crate.png'], quality: 'high' as const };
    expect(generateRequest(form, { ownTool: false })).toEqual({ recipeId: 'model-from-image', count: 1,
      inputs: { image: 'props/crate.png', name: 'crate' }, model: 'openpixo-model3d-high' });
    expect(generateRequest(form, { ownTool: true })).not.toHaveProperty('model');
  });

  it('is ready only with what the kind needs', () => {
    expect(generateFormReady(initialGenerateForm('image'))).toBe(false);
    expect(generateFormReady({ ...initialGenerateForm('voice'), text: 'Hi' })).toBe(false);
    expect(generateFormReady({ ...initialGenerateForm('voice'), text: 'Hi', voice: 'Aria' })).toBe(true);
    expect(generateFormReady({ ...initialGenerateForm('model3d'), references: ['a.png'] })).toBe(true);
  });

  it('keeps the description across kinds and drops references that no longer fit', () => {
    const image = { ...initialGenerateForm('image'), text: 'slime', references: ['a.png', 'b.png'] };
    expect(withKind(image, 'sfx')).toMatchObject({ kind: 'sfx', text: 'slime', references: [], count: 3 });
    expect(withKind(image, 'model3d').references).toEqual(['a.png']);
  });

  it('knows when an own tool makes it', () => {
    const media = { capabilities: { t2i: { configured: true, providers: ['codex'] }, i2i: { configured: false, providers: [] } } };
    expect(ownToolMakes({ ...initialGenerateForm('image'), text: 'x' }, media)).toBe(true);
    expect(ownToolMakes({ ...initialGenerateForm('image'), text: 'x', references: ['a.png'] }, media)).toBe(false);
    expect(ownToolMakes(initialGenerateForm('sfx'), media)).toBe(false);
    expect(ownToolMakes(initialGenerateForm('image'), null)).toBe(false);
  });

  it('estimates every candidate on the service it will be priced on', () => {
    const services = [service('openpixo-image', 4), service('openpixo-image-edit', 7)];
    expect(generateEstimate({ ...initialGenerateForm('image'), text: 'x', count: 2 }, services)).toBe(8);
    expect(generateEstimate({ ...initialGenerateForm('image'), text: 'x', count: 1, references: ['a.png', 'b.png'] }, services)).toBe(8);
    // A larger size adds what the service charges for it, per image; one it does not sell is priced as 1K.
    const sized = services.map(entry => entry.id === 'openpixo-image'
      ? { ...entry, resolutions: ['1k', '2k', '4k'] as OpenPixoGenerationService['resolutions'], pricing: { ...entry.pricing, resolutionCredits: { '2k': 2, '4k': 5 } } } : entry);
    expect(generateEstimate({ ...initialGenerateForm('image'), text: 'x', count: 2, resolution: '4k' }, sized)).toBe(18);
    expect(generateEstimate({ ...initialGenerateForm('image'), text: 'x', count: 2, resolution: '4k' }, services)).toBe(8);
    expect(sizeOffer({ aspect: '16:9', resolution: '2k' }, undefined)).toMatchObject({ resolution: '2k', resolutions: ['1k', '2k', '4k'] });
    expect(sizeOffer({ aspect: '16:9', resolution: '2k' }, { aspects: ['1:1', '3:2'], resolutions: undefined }))
      .toEqual({ aspects: ['1:1', '3:2'], resolutions: ['1k'], resolution: '1k' });
    expect(generateEstimate(initialGenerateForm('music'), services)).toBeNull();
  });

  it('puts a plain run back in the box, and leaves a preset alone', () => {
    const run = { recipeId: 'sound-effect', inputs: { prompt: 'coin', duration: 2, name: 'coin' }, model: { provider: 'openpixo', id: 'openpixo-sfx' },
      candidates: [{}, {}] } as unknown as RecipeRun;
    expect(formFromRun(run)).toMatchObject({ kind: 'sfx', text: 'coin', seconds: 2, count: 2 });
    expect(formFromRun({ ...run, recipeId: 'item-icon-set' })).toBeNull();
    const model = { recipeId: 'model-from-image', inputs: { image: 'a.png', name: 'a' }, model: { provider: 'openpixo', id: 'openpixo-model3d-draft' }, candidates: [{}] } as unknown as RecipeRun;
    expect(formFromRun(model)).toMatchObject({ kind: 'model3d', references: ['a.png'], quality: 'draft' });
  });

  it('runs a preset from the box: defaults, picked settings, the description and a file name from it', () => {
    const vfx: PresetRecipe = { id: 'vfx-sequence', surface: 'image', count: { default: 1, max: 2 }, fields: [
      { name: 'effect', type: 'string', required: true },
      { name: 'palette', type: 'string', required: true },
      { name: 'grid', type: 'select', options: ['3x3', '4x4'], default: '4x4' },
      { name: 'name', type: 'string', required: true },
    ] };
    const form = { ...withPreset({ ...initialGenerateForm('image', ['a.png']), text: 'fireball' }, vfx), count: 5 };
    expect(form).toMatchObject({ kind: 'image', references: [], preset: { id: 'vfx-sequence', inputs: {} } });
    // Its other required text is a setting the user still has to fill.
    expect(presetReady(form, vfx)).toBe(false);
    const filled = { ...form, preset: { id: 'vfx-sequence', inputs: { palette: 'orange' } } };
    expect(presetReady(filled, vfx)).toBe(true);
    expect(presetRequest({ ...filled, styleId: 'pixel' }, vfx)).toEqual({ recipeId: 'vfx-sequence', count: 2, styleId: 'pixel',
      inputs: { effect: 'fireball', palette: 'orange', grid: '4x4', name: 'fireball' } });
    expect(presetRequest({ ...filled, text: '火球' }, vfx).inputs.name).toBe('vfx_sequence');
    // Switching kind takes the tag off and keeps the words.
    expect(withKind(filled, 'image')).not.toHaveProperty('preset');
    expect(withKind(filled, 'image').text).toBe('fireball');
  });

  it('做同款 brings an example’s settings, and its words only into an empty box', () => {
    const recipe = { id: 'item-icon-set', surface: 'image' };
    const sample = { prompt: 'potions', inputs: { grid: '2x2' } };
    expect(withPreset(initialGenerateForm('image'), recipe, sample)).toMatchObject({ text: 'potions', preset: { id: 'item-icon-set', inputs: { grid: '2x2' } } });
    expect(withPreset({ ...initialGenerateForm('image'), text: 'swords' }, recipe, sample).text).toBe('swords');
    expect(withStyle(initialGenerateForm('sfx'), 'pixel')).toMatchObject({ kind: 'image', styleId: 'pixel' });
  });

  it('opens a preset that needs a picture or a character in its own form', () => {
    expect(presetFitsBox([{ name: 'character', type: 'character-ref', required: true }, { name: 'style', type: 'select' }])).toBe(false);
    expect(presetFitsBox([{ name: 'scene', type: 'string', required: true }, { name: 'name', type: 'string', required: true }])).toBe(true);
    expect(presetKind({ surface: 'audio', requires: ['music'] })).toBe('music');
    expect(presetKind({ surface: 'audio', requires: ['sfx'] })).toBe('sfx');
  });

  it('prices a preset on the service of the first capability it needs', () => {
    const form = { ...initialGenerateForm('image'), text: 'potions', count: 2 };
    expect(presetEstimate(form, ['t2i'], [service('openpixo-image', 4)])).toBe(8);
    expect(presetEstimate(form, ['something-else'], [service('openpixo-image', 4)])).toBeNull();
  });
});
