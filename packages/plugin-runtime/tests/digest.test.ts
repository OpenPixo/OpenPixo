import { describe, expect, it } from 'vitest';
import { manifestSourceDigest } from '../src/digest';
import type { PluginManifest } from '@openpixo/contracts';

const baseManifest: PluginManifest = {
  name: 'sample-plugin',
  title: 'Sample Plugin',
  version: '1.0.0',
  description: 'Fixture for digest tests.',
  pixo: {
    kind: 'skill',
    taskKind: 'new-generation',
    useCase: { query: 'Make a {{topic}} brief.' },
    inputs: [{ name: 'topic', type: 'string', required: true }],
  },
};

describe('manifestSourceDigest', () => {
  // Pinned hex values guard against accidental drift in the canonical
  // serializer. If a Phase 1+ refactor changes them, update the fixtures
  // *and* document the migration impact in the plan.
  it('digests the empty-input case to a stable hex', () => {
    const digest = manifestSourceDigest({
      manifest: baseManifest,
      inputs: {},
      resolvedContextRefs: [],
    });
    expect(digest).toBe('645f958753e7782f146bb0470131a5359bc15896fc9f6a8a501517acd627ea49');
  });

  it('digests the topic-input case to a stable hex', () => {
    const digest = manifestSourceDigest({
      manifest: baseManifest,
      inputs: { topic: 'agentic design' },
      resolvedContextRefs: [
        { kind: 'skill', ref: 'sample-plugin' },
        { kind: 'design-system', ref: 'linear-clone' },
      ],
    });
    expect(digest).toBe('359302c2d60f8385442dd44234b5ae04f0d30226524c5aff1dfcb406cbda6b60');
  });

  it('produces the same digest regardless of object key order', () => {
    const a = manifestSourceDigest({
      manifest: baseManifest,
      inputs: { audience: 'VC', topic: 'design' },
      resolvedContextRefs: [
        { kind: 'skill', ref: 'sample-plugin' },
        { kind: 'craft', ref: 'typography' },
      ],
    });
    const b = manifestSourceDigest({
      manifest: { ...baseManifest, description: baseManifest.description },
      inputs: { topic: 'design', audience: 'VC' },
      resolvedContextRefs: [
        { kind: 'skill', ref: 'sample-plugin' },
        { kind: 'craft', ref: 'typography' },
      ],
    });
    expect(a).toBe(b);
  });

  it('changes when an input value changes', () => {
    const a = manifestSourceDigest({
      manifest: baseManifest,
      inputs: { topic: 'design' },
      resolvedContextRefs: [],
    });
    const b = manifestSourceDigest({
      manifest: baseManifest,
      inputs: { topic: 'engineering' },
      resolvedContextRefs: [],
    });
    expect(a).not.toBe(b);
  });
});
