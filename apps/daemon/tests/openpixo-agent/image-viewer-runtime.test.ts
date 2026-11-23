import { describe, expect, it } from 'vitest';
import { OPENPIXO_AGENT_IMAGE_VIEWER_MODEL } from '@openpixo/contracts';
import { agentModels } from '../../src/account/agent-gateway.js';
import { buildOpenPixoAgentOpenCodeConfig, fetchOpenPixoAgentModels, openpixoAgentUsesImageViewer, setOpenPixoAgentCatalogReader } from '../../src/openpixo-agent/runtime.js';

const row = (id: string, inputModalities: string[]) => ({ id, label: id, priceVersion: 1, contextTokens: 500000, maxOutputTokens: 32000,
  creditsPerMillionTokens: { inputCacheMiss: 60, inputCacheHit: 1.2, output: 240 }, inputModalities });
const catalogue = (...models: ReturnType<typeof row>[]) => agentModels({
  models, limits: { maxConcurrent: 4, requestsPerMinute: 60, maxRequestBytes: 2000000 }, agentPaused: false });
const input = (model: string, imageLook?: boolean) => ((buildOpenPixoAgentOpenCodeConfig('http://127.0.0.1:1', model,
  imageLook === undefined ? undefined : { imageLook }).provider as Record<string, any>).openpixo.models[model].modalities.input);

describe('hosted agent image viewer', () => {
  it('looks through the viewer only when the cloud offers it reading pictures, and never for the viewer itself', async () => {
    setOpenPixoAgentCatalogReader(async () => catalogue(row('openpixo-agent-flash', ['text', 'image']),
      row(OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, ['text', 'image']), row('openpixo-agent-hy4', ['text']), row('openpixo-agent-hy4-flash', ['text'])));
    await fetchOpenPixoAgentModels();
    expect(openpixoAgentUsesImageViewer('openpixo-agent-flash')).toBe(true);
    expect(openpixoAgentUsesImageViewer('openpixo/openpixo-agent-hy4')).toBe(true);
    expect(openpixoAgentUsesImageViewer('openpixo/openpixo-agent-hy4-flash')).toBe(true);
    expect(openpixoAgentUsesImageViewer(OPENPIXO_AGENT_IMAGE_VIEWER_MODEL)).toBe(false);
    // Looking, OpenCode is told the model reads text only, so no picture enters the conversation.
    expect(input('openpixo-agent-flash', true)).toEqual(['text']);
    expect(input('openpixo-agent-hy4-flash', true)).toEqual(['text']);
    // Not looking, a model that reads pictures is sent them as before.
    expect(input('openpixo-agent-flash', false)).toEqual(['text', 'image']);
    expect(input('openpixo-agent-flash')).toEqual(['text', 'image']);
    expect(input(OPENPIXO_AGENT_IMAGE_VIEWER_MODEL)).toEqual(['text', 'image']);
  });

  it('keeps today’s behaviour while the cloud lists the viewer as text only, or not at all', async () => {
    setOpenPixoAgentCatalogReader(async () => catalogue(row('openpixo-agent-flash', ['text', 'image']), row(OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, ['text'])));
    await fetchOpenPixoAgentModels();
    expect(openpixoAgentUsesImageViewer('openpixo-agent-flash')).toBe(false);
    expect(input('openpixo-agent-flash')).toEqual(['text', 'image']);

    setOpenPixoAgentCatalogReader(async () => catalogue(row('openpixo-agent-flash', ['text', 'image'])));
    await fetchOpenPixoAgentModels();
    expect(openpixoAgentUsesImageViewer('openpixo-agent-flash')).toBe(false);
  });
});
