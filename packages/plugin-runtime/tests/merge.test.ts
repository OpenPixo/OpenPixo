import { describe, expect, it } from 'vitest';
import { mergeManifests } from '../src/merge';
import type { PluginManifest } from '@openpixo/contracts';

const adapter: PluginManifest = {
  name: 'plugin',
  title: 'From Adapter',
  version: '0.0.0',
  description: 'adapter desc',
  compat: { agentSkills: [{ path: './SKILL.md' }] },
  pixo: {
    kind: 'skill',
    taskKind: 'new-generation',
    mode: 'prototype',
    inputs: [{ name: 'tone', type: 'string' }],
  },
};

const sidecar: PluginManifest = {
  name: 'plugin',
  title: 'From Sidecar',
  version: '1.0.0',
  description: 'sidecar desc',
  pixo: {
    taskKind: 'tune-collab',
    inputs: [{ name: 'audience', type: 'select', options: ['VC'] }],
  },
};

describe('mergeManifests', () => {
  it('lets the sidecar win for scalar fields', () => {
    const merged = mergeManifests({ sidecar, adapters: [adapter] });
    expect(merged.title).toBe('From Sidecar');
    expect(merged.version).toBe('1.0.0');
    expect(merged.description).toBe('sidecar desc');
    expect(merged.pixo?.taskKind).toBe('tune-collab');
  });

  it('falls back to adapter values when sidecar omits them', () => {
    const merged = mergeManifests({ sidecar, adapters: [adapter] });
    expect(merged.pixo?.mode).toBe('prototype');
    expect(merged.pixo?.kind).toBe('skill');
  });

  it('keeps the sidecar inputs array intact, not deep-merged', () => {
    const merged = mergeManifests({ sidecar, adapters: [adapter] });
    expect(merged.pixo?.inputs?.length).toBe(1);
    expect(merged.pixo?.inputs?.[0]?.name).toBe('audience');
  });

  it('keeps localized sidecar examples intact when merging a portable skill', () => {
    const examples = [{
      title: 'Inspect a sprite sheet',
      title_i18n: { 'zh-CN': '检查精灵图集' },
      prompt: 'Check the frame bounds of my sprite sheet.',
      prompt_i18n: { 'zh-CN': '检查我的精灵图集帧边界。' },
    }];
    const merged = mergeManifests({
      sidecar: { ...sidecar, examples },
      adapters: [{ ...adapter, examples: [{ title: 'Fallback', prompt: 'Fallback prompt.' }] }],
    });

    expect(merged.examples).toEqual(examples);
    expect(merged.examples).not.toBe(examples);
    expect(merged.compat?.agentSkills).toEqual([{ path: './SKILL.md' }]);
  });

  it('unions compat lists across layers', () => {
    const merged = mergeManifests({
      sidecar: { ...sidecar, compat: { claudePlugins: [{ path: './.claude-plugin/plugin.json' }] } },
      adapters: [adapter],
    });
    expect(merged.compat?.agentSkills?.length).toBe(1);
    expect(merged.compat?.claudePlugins?.length).toBe(1);
  });
});
