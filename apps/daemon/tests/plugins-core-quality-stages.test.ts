// Red spec for the core quality-stage floor (tom 问题排查).
//
// Bug: template / community plugins commonly declare a generate-only
// pipeline (`stages: [{ id: 'generate', atoms: ['file-write','live-artifact'] }]`)
// to reuse a locked reference seed. resolveAppliedPipeline returns that
// verbatim (`source: 'declared'`), so the `plan` (TodoWrite) and
// `critique` (5-dimension quality / anti-slop) stages never run. The
// colleague's symptom: using a plugin/template skipped the five-stage
// main flow — no todolist, no real anti-slop critique loop.
//
// Invariant under test: when a plugin produces a code/document design
// artifact (a `generate` stage whose atoms include `file-write` or
// `live-artifact`), the applied pipeline always carries `plan` and
// `critique` — whether the artifact came from a free-form prompt or a
// template. Pure media generation (image/video/audio) stays
// generate-only.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlugin } from '../src/plugins/apply.js';
import type { InstalledPluginRecord, PluginManifest, PluginPipeline } from '@openpixo/contracts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const REGISTRY = {
  skills: [],
  atoms: [
    { id: 'file-write', label: 'File write' },
    { id: 'live-artifact', label: 'Live artifact' },
    { id: 'todo-write', label: 'Todo write' },
    { id: 'critique-theater', label: 'Critique theater' },
    { id: 'image-generate', label: 'Image generate' },
  ],
};

function templateFixture(pipeline: PluginPipeline, taskKind = 'new-generation'): InstalledPluginRecord {
  return {
    id: 'sample-template',
    title: 'Sample Template',
    version: '1.0.0',
    sourceKind: 'local',
    source: '/tmp/sample-template',
    sourceMarketplaceId: undefined,
    pinnedRef: undefined,
    sourceDigest: undefined,
    trust: 'trusted',
    capabilitiesGranted: ['prompt:inject', 'fs:write'],
    fsPath: '/tmp/sample-template',
    installedAt: 0,
    updatedAt: 0,
    manifest: {
      name: 'sample-template',
      title: 'Sample Template',
      version: '1.0.0',
      description: 'Fixture mirroring a generate-only HTML template.',
      pixo: {
        kind: 'scenario',
        taskKind: taskKind as 'new-generation',
        useCase: { query: 'Build a landing page.' },
        capabilities: ['prompt:inject', 'fs:write'],
        pipeline,
      },
    },
  } as InstalledPluginRecord;
}

function stageIds(pipeline: PluginPipeline | undefined): string[] {
  return (pipeline?.stages ?? []).map((s) => s.id);
}

describe('core quality-stage floor', () => {

  it('leaves a pure media (image) generate-only pipeline untouched', () => {
    const plugin = templateFixture({
      stages: [{ id: 'generate', atoms: ['image-generate'] }],
    });
    const { result } = applyPlugin({ plugin, inputs: {}, registry: REGISTRY });
    expect(stageIds(result.pipeline)).toEqual(['generate']);
  });

  // Control: a NON-media manifest that omits od.pipeline keeps the full
  // scenario fallback untouched (plan + critique already present → no-op).
  it('leaves a non-media scenario-fallback pipeline intact', () => {
    const plugin: InstalledPluginRecord = {
      ...templateFixture({ stages: [] }),
      manifest: {
        name: 'web-no-pipeline',
        title: 'Web No Pipeline',
        version: '1.0.0',
        description: 'A web plugin that omits pixo.pipeline.',
        pixo: {
          kind: 'skill',
          taskKind: 'new-generation',
          mode: 'web',
          useCase: { query: 'Build a landing page.' },
          capabilities: ['prompt:inject', 'fs:write'],
        },
      },
    } as InstalledPluginRecord;

    const registryWithScenario = {
      ...REGISTRY,
      scenarios: [
        {
          id: 'pixo-new-generation',
          taskKind: 'new-generation' as const,
          pipeline: {
            stages: [
              { id: 'discovery', atoms: ['question-form'] },
              { id: 'plan', atoms: ['todo-write'] },
              { id: 'generate', atoms: ['file-write', 'live-artifact'] },
              { id: 'critique', atoms: ['critique-theater'], repeat: true, until: 'critique.score>=4 || iterations>=3' },
            ],
          },
        },
      ],
    };

    const { result } = applyPlugin({ plugin, inputs: {}, registry: registryWithScenario });
    expect(stageIds(result.pipeline)).toEqual(['discovery', 'plan', 'generate', 'critique']);
  });

  it('does not duplicate stages a template already declares', () => {
    const plugin = templateFixture({
      stages: [
        { id: 'plan', atoms: ['todo-write'] },
        { id: 'generate', atoms: ['file-write', 'live-artifact'] },
        { id: 'critique', atoms: ['critique-theater'], repeat: true, until: 'critique.score>=4 || iterations>=3' },
      ],
    });
    const { result } = applyPlugin({ plugin, inputs: {}, registry: REGISTRY });
    const ids = stageIds(result.pipeline);
    expect(ids.filter((id) => id === 'plan')).toHaveLength(1);
    expect(ids.filter((id) => id === 'critique')).toHaveLength(1);
  });
});
