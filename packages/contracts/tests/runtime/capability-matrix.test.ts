import { describe, expect, it } from 'vitest';
import { CAPABILITY_CELLS, RUNTIME_CAPABILITY_MATRIX } from '../../src/runtime/capability-matrix.js';

describe('runtime capability matrix', () => {
  it('fills every capability for every productized runtime with implementation evidence', () => {
    expect(Object.keys(RUNTIME_CAPABILITY_MATRIX)).toEqual(['codex', 'claude', 'opencode']);
    expect(CAPABILITY_CELLS).toHaveLength(12);
    for (const cells of Object.values(RUNTIME_CAPABILITY_MATRIX)) {
      expect(Object.keys(cells).sort()).toEqual([...CAPABILITY_CELLS].sort());
      for (const cell of Object.values(cells)) {
        expect(['implemented', 'unsupported', 'unknown']).toContain(cell.state);
        if (cell.state === 'implemented') expect(cell.evidence).toBeTruthy();
      }
    }
  });
});
