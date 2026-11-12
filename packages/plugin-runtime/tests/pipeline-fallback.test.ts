// Spec §23.3.3 — bundled-scenario pipeline fallback.

import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '@openpixo/contracts';
import { resolveAppliedPipeline, type ScenarioRegistryEntry } from '../src/index.js';

const baseManifest = (od: NonNullable<PluginManifest['pixo']> | undefined): PluginManifest => ({
  $schema: 'urn:openpixo:plugin:v1',
  name: 'fixture',
  version: '0.0.1',
  ...(od ? { pixo: od } : {}),
}) as PluginManifest;

const scenarios: ScenarioRegistryEntry[] = [
  {
    id: 'pixo-new-generation',
    taskKind: 'new-generation',
    pipeline: { stages: [{ id: 'discovery', atoms: ['discovery-question-form'] }] },
  },
  {
    id: 'pixo-code-migration',
    taskKind: 'code-migration',
    pipeline: { stages: [{ id: 'import', atoms: ['code-import'] }] },
  },
];

describe('resolveAppliedPipeline', () => {
  it('returns the declared pipeline when the manifest carries one', () => {
    const manifest = baseManifest({
      taskKind: 'new-generation',
      pipeline: { stages: [{ id: 'custom', atoms: ['todo-write'] }] },
    });
    const out = resolveAppliedPipeline({ manifest, scenarios });
    expect(out.source).toBe('declared');
    expect(out.pipeline?.stages?.[0]?.id).toBe('custom');
    expect(out.scenarioId).toBeUndefined();
  });

  it('falls back to the bundled scenario matching taskKind', () => {
    const manifest = baseManifest({ taskKind: 'code-migration' });
    const out = resolveAppliedPipeline({ manifest, scenarios });
    expect(out.source).toBe('scenario');
    expect(out.scenarioId).toBe('pixo-code-migration');
    expect(out.pipeline?.stages?.[0]?.id).toBe('import');
  });

  it("defaults taskKind to 'new-generation' when the manifest omits it", () => {
    const manifest = baseManifest({});
    const out = resolveAppliedPipeline({ manifest, scenarios });
    expect(out.source).toBe('scenario');
    expect(out.scenarioId).toBe('pixo-new-generation');
  });

  it("returns source='none' when the manifest is itself a scenario", () => {
    const manifest = baseManifest({
      kind: 'scenario',
      taskKind: 'new-generation',
    });
    const out = resolveAppliedPipeline({ manifest, scenarios });
    expect(out.source).toBe('none');
    expect(out.pipeline).toBeUndefined();
  });

  it("returns source='none' when no scenario list is supplied", () => {
    const manifest = baseManifest({ taskKind: 'code-migration' });
    const out = resolveAppliedPipeline({ manifest });
    expect(out.source).toBe('none');
  });

  it("returns source='none' when no scenario matches the taskKind", () => {
    const manifest = baseManifest({ taskKind: 'tune-collab' });
    const out = resolveAppliedPipeline({ manifest, scenarios });
    expect(out.source).toBe('none');
  });

  it('treats an empty stages[] declared pipeline as missing and falls back', () => {
    const manifest = baseManifest({
      taskKind: 'new-generation',
      pipeline: { stages: [] },
    });
    const out = resolveAppliedPipeline({ manifest, scenarios });
    expect(out.source).toBe('scenario');
    expect(out.scenarioId).toBe('pixo-new-generation');
  });
});
