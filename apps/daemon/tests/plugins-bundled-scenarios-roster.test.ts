import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const scenariosRoot = path.resolve(import.meta.dirname, '../../../plugins/_official/scenarios');
const EXPECTED_SCENARIOS = ['pixo-media-generation', 'pixo-plugin-authoring'];

describe('bundled media and plugin authoring scenarios', () => {
  it('contains the retained scenario folders', async () => {
    const entries = await readdir(scenariosRoot, { withFileTypes: true });
    expect(entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort())
      .toEqual(EXPECTED_SCENARIOS);
  });

  for (const id of EXPECTED_SCENARIOS) {
    it(`${id} loads its local prompt and declares an executable pipeline`, async () => {
      const folder = path.join(scenariosRoot, id);
      const manifest = JSON.parse(await readFile(path.join(folder, 'pixo.json'), 'utf8'));
      expect(manifest.name).toBe(id);
      expect(manifest.pixo.kind).toBe('scenario');
      expect(manifest.pixo.taskKind).toBe('new-generation');
      const localSkills = manifest.pixo.context?.skills ?? manifest.compat?.agentSkills;
      expect(localSkills).toContainEqual({ path: './SKILL.md' });
      expect((await stat(path.join(folder, 'SKILL.md'))).isFile()).toBe(true);
      expect(manifest.pixo.pipeline.stages.length).toBeGreaterThan(0);
      for (const stage of manifest.pixo.pipeline.stages) {
        for (const retired of ['discovery-question-form', 'direction-picker', 'critique-theater', 'token-map', 'design-extract']) {
          expect(stage.atoms).not.toContain(retired);
        }
      }
    });
  }
});
