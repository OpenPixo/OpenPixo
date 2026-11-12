import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectDefaultProjectSkills } from '../../src/game/default-skills.js';
import { listSkills, type SkillInfo } from '../../src/skills.js';

const SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills');

function skill(id: string, overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    id, name: id, description: '', triggers: [], body: '', dir: `/catalog/${id}`,
    mode: 'utility', source: 'built-in', surface: 'web', platform: null, scenario: '', category: null,
    previewType: 'html', defaultFor: [], upstream: null, featured: null, fidelity: null,
    speakerNotes: null, animations: null, examplePrompt: '', aggregatesExamples: false,
    ...overrides,
  };
}

const ids = (skills: SkillInfo[]) => skills.map((entry) => entry.id);

describe('selectDefaultProjectSkills', () => {
  it('keeps a skill for its own engine and drops it elsewhere', () => {
    const catalog = [skill('godot-only', { engines: ['godot'] }), skill('any-engine')];
    expect(ids(selectDefaultProjectSkills({ catalog, engine: 'godot' }))).toEqual(['godot-only', 'any-engine']);
    expect(ids(selectDefaultProjectSkills({ catalog, engine: 'phaser' }))).toEqual(['any-engine']);
  });

  it.each([undefined, null, 'unknown'])('rules nothing out while the engine is %s', (engine) => {
    const catalog = [skill('godot-only', { engines: ['godot'] }), skill('any-engine')];
    expect(ids(selectDefaultProjectSkills({ catalog, engine }))).toEqual(['godot-only', 'any-engine']);
  });

  it('respects the Settings switch and what the project already decided', () => {
    const catalog = [skill('off'), skill('added'), skill('kept')];
    expect(ids(selectDefaultProjectSkills({ catalog, disabledSkills: ['off'], excludeIds: ['added'] }))).toEqual(['kept']);
  });

  it('skips built-in skills that are not plain workflows and example cards, but keeps the user\'s own', () => {
    const catalog = [
      skill('needs-a-cli', { mode: 'prototype' }),
      skill('parent:example'),
      skill('mine', { mode: 'prototype', source: 'user' }),
    ];
    expect(ids(selectDefaultProjectSkills({ catalog }))).toEqual(['mine']);
  });
});

describe('the shipped catalogue', () => {
  it('gives each engine its own craft skill and not another engine\'s', async () => {
    const catalog = await listSkills(['', SKILLS_ROOT]);
    const phaser = ids(selectDefaultProjectSkills({ catalog, engine: 'phaser' }));
    expect(phaser).toContain('phaser-game-dev');
    expect(phaser).toContain('publish-game');
    expect(phaser).toContain('multiplayer-networking');
    expect(phaser).not.toContain('godot-gdscript');
    expect(phaser).not.toContain('unity-csharp');
    expect(phaser).not.toContain('character-controller-3d');

    const godot = ids(selectDefaultProjectSkills({ catalog, engine: 'godot' }));
    expect(godot).toContain('godot-gdscript');
    expect(godot).not.toContain('phaser-game-dev');
    expect(godot).not.toContain('publish-game');

    const unity = ids(selectDefaultProjectSkills({ catalog, engine: 'unity' }));
    expect(unity).toContain('unity-csharp');
    expect(unity).toContain('player-controller-2d');
    expect(unity).toContain('game-feel-juice');
    expect(unity).toContain('game-design-doc');
    expect(unity).not.toContain('godot-gdscript');
    expect(unity).not.toContain('phaser-game-dev');
    expect(unity).not.toContain('publish-game');
    expect(unity).not.toContain('web-export-and-itch');
  });

  it('never offers the skill that depends on an external browser CLI', async () => {
    const catalog = await listSkills(['', SKILLS_ROOT]);
    expect(ids(selectDefaultProjectSkills({ catalog }))).not.toContain('agent-browser');
  });
});
