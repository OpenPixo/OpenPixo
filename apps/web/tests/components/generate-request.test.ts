import { describe, expect, it } from 'vitest';
import type { OpenPixoGenerationService, RecipeRun } from '@openpixo/contracts';
import {
  fileNameFrom, formFromRun, generateEstimate, generateFormReady, generateRequest, initialGenerateForm, ownToolMakes, withKind,
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
      inputs: { prompt: 'a chest', aspect: '1:1', transparent: true, name: 'a_chest', reference: 'art/a.png', reference2: 'art/b.png' } });
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
});
