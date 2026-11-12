import { describe, expect, it } from 'vitest';
import { MEDIA_MODEL_SUCCESSORS } from '@openpixo/contracts';
import { AUDIO_MODELS_BY_KIND, DEFAULT_AUDIO_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, MEDIA_PROVIDERS, MODEL3D_MODELS, VIDEO_MODELS,
  canonicalMediaModelId, findMediaModel, imageModelIdForPromptTemplate, modelIdsBySurface } from '../../src/media/models';

const catalogue = [...IMAGE_MODELS, ...VIDEO_MODELS, ...Object.values(AUDIO_MODELS_BY_KIND).flat()];

describe('the catalogue the web app ships', () => {
  const FAL_NAME = /\bfal\b|fal\.(?:ai|run|media)|fal-ai|-fal\b/i;

  it('shows the fal name only on the entry where a user sets their own key', () => {
    const others = MEDIA_PROVIDERS.filter((provider) => provider.id !== 'media-gateway');
    expect(JSON.stringify({ others, IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS_BY_KIND })).not.toMatch(FAL_NAME);
    const entry = MEDIA_PROVIDERS.find((provider) => provider.id === 'media-gateway');
    expect(entry?.label).toBe('fal.ai');
    expect(entry?.settingsVisible).not.toBe(false);
    expect(entry?.hint).not.toMatch(/openpixo/i);
  });

  it('does not say whose model runs hosted 3D, while a user\'s own key still names the model it buys', () => {
    expect(MODEL3D_MODELS.find(model => model.id === 'openpixo-model3d')).toMatchObject({ label: 'OpenPixo 3D model', hint: 'OpenPixo cloud · credits · medium quality, the default' });
    expect(MODEL3D_MODELS.filter(model => model.provider === 'openpixo').map(model => model.label)).toEqual(['OpenPixo 3D model', 'OpenPixo 3D model (draft)', 'OpenPixo 3D model (high)']);
    expect(JSON.stringify(MODEL3D_MODELS.filter(model => model.provider === 'openpixo'))).not.toMatch(/tripo|rodin|hyper3d|fal/iu);
    expect(MODEL3D_MODELS.find(model => model.id === 'tripo-v2.5-gateway')?.label).toBe('Tripo v2.5');
    expect(MODEL3D_MODELS.find(model => model.id === 'meshy-6-gateway')?.label).toBe('Meshy 6');
  });
});

describe('media catalogue successor compatibility', () => {
  it.each(Object.entries(MEDIA_MODEL_SUCCESSORS))('hides %s from options and resolves saved selections to %s', (id, successor) => {
    expect(catalogue.some(model => model.id === id)).toBe(false);
    expect(canonicalMediaModelId(id)).toBe(successor);
    expect(findMediaModel(id)?.id).toBe(successor);
    expect(catalogue.some(model => model.id === successor)).toBe(true);
  });

  it('resolves old prompt-template recommendations and preserves custom models', () => {
    expect(imageModelIdForPromptTemplate(' gpt-image-1 ')).toBe('gpt-image-2');
    expect(canonicalMediaModelId('custom-deployment')).toBe('custom-deployment');
    expect(canonicalMediaModelId('constructor')).toBe('constructor');
  });

  it('keeps every default selectable and discloses only current ids', () => {
    const ids = modelIdsBySurface();
    expect(ids.image).toContain(DEFAULT_IMAGE_MODEL);
    expect(ids.video).toContain(DEFAULT_VIDEO_MODEL);
    for (const kind of ['music', 'speech', 'sfx'] as const) expect(ids.audio[kind]).toContain(DEFAULT_AUDIO_MODEL[kind]);
    for (const id of Object.keys(MEDIA_MODEL_SUCCESSORS)) expect([...ids.image, ...ids.video, ...Object.values(ids.audio).flat()]).not.toContain(id);
  });
});
