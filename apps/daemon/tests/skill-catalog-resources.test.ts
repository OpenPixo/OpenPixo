import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSkills } from '../src/skills.js';

describe('bundled functional skill catalogue', () => {
  it('ships workflows rather than empty upstream-link catalogue shells', async () => {
    const entries = await listSkills(path.resolve(import.meta.dirname, '../../../skills'));
    expect(entries.map(entry => entry.id)).toEqual(expect.arrayContaining(['agent-browser', 'godot-gdscript', 'phaser-game-dev', 'game-assets-batch']));
    expect(entries.filter(entry => entry.body.includes('This catalogue entry advertises the skill')).map(entry => entry.id)).toEqual([]);
  });
});
