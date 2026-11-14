import { describe, expect, it } from 'vitest';
import { composeProjectSkillContext, type SkillInfo } from '../../src/skills.js';

function skill(id: string, triggers: string[] = [], body = `PRIVATE WORKFLOW ${id}`): SkillInfo {
  return {
    id, name: id, description: `Use ${id} for game assets.`, triggers, body,
    dir: `/catalog/${id}`, mode: 'utility', source: 'user', surface: 'web',
    platform: null, scenario: '', category: null, previewType: 'html', defaultFor: [],
    upstream: null, featured: null, fidelity: null, speakerNotes: null, animations: null,
    examplePrompt: '', aggregatesExamples: false,
  };
}

function compose(skills: SkillInfo[], options: Partial<Parameters<typeof composeProjectSkillContext>[0]> = {}) {
  return composeProjectSkillContext({
    skills, streamFormat: 'codex-jsonl',
    stagedSkillDirs: new Map(skills.map(entry => [entry.dir, `/game/.pixo-skills/${entry.id}-staged`])),
    ...options,
  });
}

describe('default project skills', () => {
  const staged = (...entries: SkillInfo[]) => new Map(entries.map(entry => [entry.dir, `.pixo-skills/${entry.id}-staged`]));

  it('adds index lines only, after the project\'s own skills', () => {
    const own = skill('own');
    const fallback = skill('fallback');
    const { stablePrompt, loadedSkillIds } = composeProjectSkillContext({
      skills: [own], defaultSkills: [fallback], stagedSkillDirs: staged(own, fallback),
      streamFormat: 'claude-jsonl',
    });
    expect(stablePrompt.indexOf('.pixo-skills/own-staged/SKILL.md')).toBeLessThan(stablePrompt.indexOf('.pixo-skills/fallback-staged/SKILL.md'));
    expect(stablePrompt).not.toContain('PRIVATE WORKFLOW');
    expect(loadedSkillIds).toEqual([]);
  });

  it('leaves out a default skill that could not be copied, since the agent could not read it', () => {
    const missing = skill('missing');
    const result = composeProjectSkillContext({
      skills: [], defaultSkills: [missing], stagedSkillDirs: new Map(),
      streamFormat: 'claude-jsonl',
    });
    expect(result.stablePrompt).toBe('');
  });

  it('leaves out a default skill whose full text is already in the prompt', () => {
    const picked = skill('picked');
    const result = composeProjectSkillContext({
      skills: [], defaultSkills: [picked], stagedSkillDirs: staged(picked), selectedSkillIds: ['picked'],
      streamFormat: 'claude-jsonl',
    });
    expect(result.stablePrompt).toBe('');
  });

  it('gives text-only providers nothing, because they cannot read files', () => {
    const fallback = skill('fallback');
    const result = composeProjectSkillContext({
      skills: [], defaultSkills: [fallback], stagedSkillDirs: staged(fallback),
      streamFormat: 'plain',
    });
    expect(result.stablePrompt).toBe('');
  });
});

describe('the agent picks skills from the index', () => {
  it('lists trigger phrases in either language as hints, never a workflow', () => {
    const entries = [skill('prototype-spike', ['spike']), skill('saves', ['存档'])];
    const result = compose(entries);
    expect(result.stablePrompt).toContain('"spike"');
    expect(result.stablePrompt).toContain('"存档"');
    expect(result.stablePrompt).not.toContain('PRIVATE WORKFLOW');
    expect(result.loadedSkillIds).toEqual([]);
  });

  it('reports what a text-only provider really got when its budget cuts the list', () => {
    const entries = [skill('first', [], 'FIRST WORKFLOW'), skill('huge', [], 'x'.repeat(4000)), skill('cut', [], 'CUT WORKFLOW')];
    const result = compose(entries, { streamFormat: 'plain', plainByteBudget: 1000 });
    expect(result.loadedSkillIds).toContain('first');
    expect(result.loadedSkillIds).not.toContain('cut');
  });
});

describe('project skill progressive disclosure', () => {
  it('recognizes an explicitly selected skill even when the enabled copy is a different immutable snapshot', () => {
    const snapshot = { ...skill('sprites', ['sprites']), dir: '/snapshots/old/sprites' };
    for (const streamFormat of ['claude-jsonl', 'plain']) {
      const result = composeProjectSkillContext({
        skills: [snapshot], stagedSkillDirs: new Map(), selectedSkillDirs: ['/catalog/sprites'],
        selectedSkillIds: ['sprites'], streamFormat,
      });
      expect(result.stablePrompt).not.toContain('PRIVATE WORKFLOW');
      expect(result.loadedSkillIds).toEqual([]);
    }
  });

  it.each(['codex-jsonl', 'claude-jsonl', 'opencode-json', 'opencode-jsonl'])('%s sends an index with real staged paths instead of every body', (streamFormat) => {
    const entries = [skill('sprites'), skill('sound')];
    const result = compose(entries, { streamFormat });
    expect(result.stablePrompt).toContain('/game/.pixo-skills/sprites-staged/SKILL.md');
    expect(result.stablePrompt).not.toContain('PRIVATE WORKFLOW');
  });

  it('does not duplicate explicitly selected skill bodies in automatic context', () => {
    const selected = skill('sprites', ['sprites']);
    const result = compose([selected], { selectedSkillDirs: [selected.dir] });
    expect(result.stablePrompt).toContain('sprites');
    expect(result.stablePrompt).not.toContain('PRIVATE WORKFLOW');
    expect(result.loadedSkillIds).toEqual([]);
  });

  it('keeps plain providers self-contained and bounds their fallback without splitting Unicode', () => {
    const entries = [skill('first', [], 'FIRST WORKFLOW'), skill('huge', [], '界🎮'.repeat(1000))];
    const result = compose(entries, { streamFormat: 'plain', plainByteBudget: 256 });
    expect(result.stablePrompt).toContain('FIRST WORKFLOW');
    expect(result.stablePrompt).toContain('truncated');
    expect(result.stablePrompt).not.toContain('Read the matching');
    expect(result.stablePrompt).not.toContain('�');
    expect(Buffer.byteLength(result.stablePrompt, 'utf8')).toBeLessThanOrEqual(256);
    expect(compose(entries, { streamFormat: 'plain', selectedSkillDirs: entries.map(entry => entry.dir) }).stablePrompt).toBe('');
  });
});
