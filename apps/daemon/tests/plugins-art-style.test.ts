import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePluginFolder } from '../src/plugins/registry.js';
import { requiredCapabilities } from '../src/plugins/trust.js';
import { applyPlugin } from '../src/plugins/apply.js';
import { validatePluginFolder } from '../src/plugins/validate.js';

describe('data-only art style plugins', () => {
  it.each(['local', 'bundled'] as const)('resolves a %s manifest without a portable skill or execution grants', async (sourceKind) => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'pixo-style-plugin-'));
    const examples = [{
      title: 'Make a knight sprite',
      title_i18n: { 'zh-CN': '生成骑士精灵' },
      prompt: 'Generate a 32x32 knight sprite in this style.',
      prompt_i18n: { 'zh-CN': '按此风格生成一个 32x32 骑士精灵。' },
    }];
    try {
      await writeFile(path.join(folder, 'pixo.json'), JSON.stringify({
        name: 'pixel-knight-style',
        version: '1.0.0',
        title: 'Pixel knight style',
        description: 'Crisp sprite silhouettes and a compact palette.',
        license: 'Apache-2.0',
        examples,
        pixo: {
          kind: 'style',
          style: {
            id: 'pixel-knight-style',
            dimension: ['2d'],
            medium: ['pixel'],
            prompt: 'Crisp pixel art with a compact palette.',
            negativePrompt: 'Blur, smooth gradients.',
            previews: [],
          },
        },
      }));

      const resolved = await resolvePluginFolder({ folder, folderId: 'pixel-knight-style', sourceKind });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) throw new Error(resolved.errors.join('\n'));
      expect(resolved.record.manifest.pixo?.kind).toBe('style');
      expect(resolved.record.manifest.examples).toEqual(examples);
      expect(resolved.record.manifest.compat).toBeUndefined();
      expect(resolved.record.capabilitiesGranted).toEqual([]);
      expect(requiredCapabilities(resolved.record.manifest)).toEqual([]);
      expect((await validatePluginFolder({ folder })).ok).toBe(true);
      expect(() => applyPlugin({
        plugin: resolved.record,
        inputs: {},
        registry: { skills: [], atoms: [] },
      })).toThrow('Select a project style with pixo style set.');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
