import type { PluginManifest, PluginPipeline } from '@openpixo/contracts';
import { describe, expect, it } from 'vitest';
import { resolveAppliedPipeline } from '../src/pipeline-fallback';

describe('art style pipeline isolation', () => {
  it.each([false, true])('ignores executable pipelines for a data-only style (declared=%s)', (declared) => {
    const pipeline: PluginPipeline = { stages: [{ id: 'create', atoms: ['generate-assets'] }] };
    const manifest: PluginManifest = {
      name: 'pixel-style',
      version: '1.0.0',
      pixo: {
        kind: 'style',
        style: {
          id: 'pixel-style',
          dimension: ['2d'],
          medium: ['pixel'],
          prompt: 'Crisp pixels.',
          negativePrompt: 'Blur.',
          previews: [],
        },
        pipeline: declared ? pipeline : undefined,
      },
    };

    expect(resolveAppliedPipeline({
      manifest,
      scenarios: [{ id: 'default-scenario', taskKind: 'new-generation', pipeline }],
    })).toEqual({ pipeline: undefined, source: 'none' });
  });
});
