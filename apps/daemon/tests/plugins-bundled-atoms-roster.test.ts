import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const atomsRoot = path.resolve(import.meta.dirname, '../../../plugins/_official/atoms');
const EXPECTED_ATOMS = [
  'build-test',
  'code-import',
  'diff-review',
  'handoff',
  'patch-edit',
  'rewrite-plan',
  'todo-write',
];

describe('bundled game development atoms', () => {
  it('contains the retained development workflow atoms', async () => {
    const entries = await readdir(atomsRoot, { withFileTypes: true });
    expect(entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort())
      .toEqual(EXPECTED_ATOMS);
  });

  it('ships a prompt and manifest for every retained atom', async () => {
    for (const id of EXPECTED_ATOMS) {
      expect((await stat(path.join(atomsRoot, id, 'SKILL.md'))).isFile()).toBe(true);
      expect((await stat(path.join(atomsRoot, id, 'pixo.json'))).isFile()).toBe(true);
    }
  });
});
