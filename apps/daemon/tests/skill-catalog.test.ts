import { describe, expect, it, vi } from 'vitest';
import { createSkillCatalog } from '../src/services/skill-catalog.js';

describe('local skill catalogue', () => {
  const roots = { skillRoots: ['local-skills', 'bundled-skills'], templateRoots: ['templates'], allRoots: ['local-skills', 'bundled-skills', 'templates'] };
  function catalog() {
    const listSkills = vi.fn(async (_roots: string[]) => [{ id: 'local:game', dir: 'local-skills/game' }]);
    return { listSkills, service: createSkillCatalog({ roots, skills: {
      listSkills, findSkillById: (entries, id) => entries.find(entry => entry.id === id || entry.id === `local:${id}`),
    } }) };
  }
  it('preserves the configured root order for functional, template, and combined reads', async () => {
    const { listSkills, service } = catalog();
    await service.listAllSkills(); await service.listAllTemplates(); await service.listAllSkillLikeEntries();
    expect(listSkills.mock.calls).toEqual([[roots.skillRoots], [roots.templateRoots], [roots.allRoots]]);
  });
  it('keeps optional selection, validation errors, and canonical skill IDs', async () => {
    const { listSkills, service } = catalog();
    for (const id of [undefined, null, '']) expect(await service.validateProjectSkillId(id)).toEqual({ ok: true, id: null });
    expect(await service.validateProjectSkillId(42)).toMatchObject({ ok: false, code: 'INVALID_SKILL_ID' });
    expect(listSkills).not.toHaveBeenCalled();
    expect(await service.validateProjectSkillId('missing')).toMatchObject({ ok: false, code: 'SKILL_NOT_FOUND' });
    expect(await service.validateProjectSkillId('game')).toEqual({ ok: true, id: 'local:game' });
  });
});
