import { describe, expect, it } from 'vitest';
import {
  estimateSkillContextCost,
  renderProjectSkillIndex,
  renderProjectSkillIndexEntry,
} from '../src/prompts/skill-index.js';

const entry = {
  id: 'pixel-art', name: 'Pixel art', description: 'Keep sprites\nconsistent.',
  triggers: ['pixel art', '像素画'], skillPath: '.pixo-skills/pixel-art-123/SKILL.md',
};

describe('project skill index', () => {
  it('omits an empty index', () => {
    expect(renderProjectSkillIndex([])).toBe('');
  });

  it('lists metadata and the staged file without inlining workflows', () => {
    const index = renderProjectSkillIndex([entry]);
    expect(index).toContain('## Project skills');
    expect(index).toContain('Keep sprites consistent.');
    for (const value of [entry.id, entry.name, ...entry.triggers, entry.skillPath]) expect(index).toContain(value);
    expect(index).toMatch(/read.*SKILL\.md/i);
    expect(index).toContain('side files');
    expect(index).toMatch(/say which skill/i);
    expect(renderProjectSkillIndexEntry(entry).split('\n')).toHaveLength(1);
  });

  it('reports the actual UTF-8 index bytes and a clearly approximate token cost', () => {
    const body = '像素工作流 🎮'.repeat(100);
    const cost = estimateSkillContextCost(entry, body);
    expect(cost.indexBytes).toBe(Buffer.byteLength(renderProjectSkillIndexEntry(entry), 'utf8'));
    expect(cost.onDemandBytes).toBe(Buffer.byteLength(body, 'utf8'));
    expect(cost.indexTokens).toBe(Math.ceil(cost.indexBytes / 4));
    expect(cost.onDemandTokens).toBe(Math.ceil(cost.onDemandBytes / 4));
    expect(cost.indexTokens).toBeLessThan(cost.onDemandTokens);
  });
});
