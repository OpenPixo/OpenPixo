import { describe, expect, it } from 'vitest';
import { RUNTIME_CAPABILITY_MATRIX, type RuntimeCapabilityMatrix } from '@openpixo/contracts';
import { overlayRuntimeCapabilityVersions } from '../../src/runtimes/capability-matrix.js';

function fixture(): Record<'codex', RuntimeCapabilityMatrix[string]> {
  return {
    codex: {
      ...RUNTIME_CAPABILITY_MATRIX.codex,
      approvals: { state: 'verified', testedVersion: 'codex 0.160.0', evidence: 'acceptance-1', note: 'Approved and denied.' },
    },
  };
}

describe('capability version overlay', () => {
  it('downgrades only verified cells on a newer CLI without mutating evidence', () => {
    const source = fixture();
    const result = overlayRuntimeCapabilityVersions(source, { codex: 'codex-cli 0.161.0' });
    expect(result.runtimes.codex?.installedVersion).toBe('codex-cli 0.161.0');
    expect(result.matrix.codex!.approvals).toEqual({
      ...source.codex.approvals, state: 'implemented', note: 'Approved and denied.; newer CLI version not verified',
    });
    expect(source.codex.approvals.state).toBe('verified');
    expect(result.matrix.codex!.steer).toEqual(source.codex.steer);
    expect(result.matrix.codex!['project-skills']).toEqual(source.codex['project-skills']);
  });

  it.each(['0.160.0', '0.159.10', '0.160.0-beta.1', 'unparseable', undefined])(
    'preserves verification for equal, older, or unknown version %s', (version) => {
      const source = fixture();
      expect(overlayRuntimeCapabilityVersions(source, { codex: version }).matrix).toEqual(source);
    },
  );

  it.each([
    ['1.9.0', '1.10.0'], ['1.2.3-beta.2', '1.2.3-beta.10'], ['1.2.3-rc.1', '1.2.3'],
  ])('compares numeric and prerelease versions %s → %s', (testedVersion, installedVersion) => {
    const source = fixture();
    source.codex.approvals.testedVersion = testedVersion;
    expect(overlayRuntimeCapabilityVersions(source, { codex: installedVersion }).matrix.codex!.approvals.state).toBe('implemented');
  });
});
