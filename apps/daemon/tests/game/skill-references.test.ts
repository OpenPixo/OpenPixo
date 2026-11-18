import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { renderProjectSkillIndex } from '@openpixo/contracts';
import { skillCwdAliasSegment, stageActiveSkill } from '../../src/cwd-aliases.js';
import { selectDefaultProjectSkills } from '../../src/game/default-skills.js';
import { composeProjectSkillContext, listSkills, type SkillInfo } from '../../src/skills.js';

const SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills');
const REFERENCE_LINK = /\]\((references\/[A-Za-z0-9._-]+\.md)\)/g;

function skillFolders(): string[] {
  return readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(SKILLS_ROOT, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
}

function linkedReferences(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(REFERENCE_LINK)].map((match) => match[1]!))];
}

/** The rows of a parent's "Focused design jobs" table: its sub-skills. */
function routedReferences(markdown: string): string[] {
  const section = markdown.split(/^## /m).find((part) => part.startsWith('Focused design jobs'));
  return section ? linkedReferences(section) : [];
}

function frontmatterField(markdown: string, field: string): string | undefined {
  const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  return block.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))?.[1]?.trim();
}

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('shipped skill references', () => {
  it('links only files that exist and leaves no reference unlinked', () => {
    for (const folder of skillFolders()) {
      const dir = path.join(SKILLS_ROOT, folder);
      const linked = linkedReferences(readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
      for (const file of linked) expect(existsSync(path.join(dir, file)), `${folder}: ${file}`).toBe(true);
      const referencesDir = path.join(dir, 'references');
      if (!existsSync(referencesDir)) continue;
      for (const file of readdirSync(referencesDir).filter((name) => name.endsWith('.md'))) {
        expect(linked, `${folder}/references/${file} is never linked from its SKILL.md`).toContain(`references/${file}`);
      }
    }
  });

  it('names every routed sub-skill in both UI languages', () => {
    const routed = skillFolders().flatMap((folder) => {
      const parent = readFileSync(path.join(SKILLS_ROOT, folder, 'SKILL.md'), 'utf8');
      return routedReferences(parent).map((file) => path.join(folder, file));
    });
    expect(routed.length).toBeGreaterThanOrEqual(8);
    for (const file of routed) {
      const text = readFileSync(path.join(SKILLS_ROOT, file), 'utf8');
      expect(frontmatterField(text, 'en_name'), file).toBeTruthy();
      expect(frontmatterField(text, 'zh_name'), file).toMatch(/\p{Script=Han}/u);
    }
  });

  it('resolves each routed sub-skill from the SKILL.md path the prompt index advertises', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'pixo-skill-refs-'));
    scratch.push(cwd);
    const catalog = await listSkills(['', SKILLS_ROOT]);
    const defaultSkills = selectDefaultProjectSkills({ catalog, engine: 'phaser' });
    const parents = defaultSkills.filter((skill) =>
      routedReferences(readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf8')).length > 0);
    expect(parents.map((skill) => skill.id)).toEqual(expect.arrayContaining(['game-ui-hud', 'enemy-ai-state-machines']));

    // Mirrors server.ts: stage each default skill, then index it by its cwd-relative copy.
    const stagedSkillDirs = new Map<string, string>();
    for (const skill of parents) {
      const result = await stageActiveSkill(cwd, skillCwdAliasSegment(skill.dir), skill.dir);
      expect(result.staged, result.reason).toBe(true);
      stagedSkillDirs.set(skill.dir, path.relative(cwd, result.stagedPath!).replaceAll('\\', '/'));
    }
    const { stablePrompt } = composeProjectSkillContext({
      skills: [], defaultSkills: parents, stagedSkillDirs, streamFormat: 'claude-stream-json',
    });

    for (const skill of parents) {
      const line = stablePrompt.split('\n').find((entry) => entry.startsWith(`- ${JSON.stringify(skill.id)} |`));
      const advertised = line?.match(/SKILL\.md: "([^"]+)"$/)?.[1];
      expect(advertised, skill.id).toMatch(/^\.pixo-skills\//);
      const stagedSkill = path.join(cwd, advertised!);
      for (const file of routedReferences(readFileSync(stagedSkill, 'utf8'))) {
        expect(existsSync(path.join(path.dirname(stagedSkill), file)), `${skill.id}: ${file}`).toBe(true);
      }
    }
  });
});

describe('sub-skill names', () => {
  it('serves each routed sub-skill of a shipped skill with its names', async () => {
    const catalog = await listSkills(['', SKILLS_ROOT]);
    const hud = catalog.find((skill) => skill.id === 'game-ui-hud');
    expect(hud?.subSkills).toContainEqual({
      id: 'health-bars', file: 'references/health-bars.md', displayName: { en: 'Health bars', 'zh-CN': '血条设计' },
    });
    for (const skill of catalog) {
      const routed = routedReferences(readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf8'));
      expect((skill.subSkills ?? []).map((sub) => sub.file).sort(), skill.id).toEqual(expect.arrayContaining(routed));
    }
  });

  it('leaves out side files without names and skills without references', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pixo-sub-skills-'));
    scratch.push(root);
    writeFixtureSkill(root);
    writeFileSync(path.join(root, 'demo', 'references', 'notes.md'), '# Notes\n');
    mkdirSync(path.join(root, 'plain'));
    writeFileSync(path.join(root, 'plain', 'SKILL.md'), '---\nname: plain\ndescription: Plain.\n---\n\n# Plain\n');
    const catalog = await listSkills([root]);
    expect(catalog.find((skill) => skill.id === 'demo')?.subSkills).toEqual([
      { id: 'child', file: 'references/child.md', displayName: { en: 'Fixture child name', 'zh-CN': '夹具子技能名' } },
    ]);
    expect(catalog.find((skill) => skill.id === 'plain')).not.toHaveProperty('subSkills');
  });
});

describe('the composed prompt with sub-skill names', () => {
  it('is byte-for-byte the prompt without them', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pixo-sub-skills-prompt-'));
    scratch.push(root);
    writeFixtureSkill(root);
    const [demo] = await listSkills([root]);
    expect(demo?.subSkills).toHaveLength(1);
    const staged = new Map([[demo!.dir, '.pixo-skills/demo-0123456789']]);
    const withoutNames = ({ subSkills: _subSkills, ...rest }: SkillInfo): SkillInfo => rest;

    const index = composeProjectSkillContext({ skills: [], defaultSkills: [demo!], stagedSkillDirs: staged, streamFormat: 'claude-stream-json' });
    expect(index.stablePrompt).toBe(renderProjectSkillIndex([{
      id: 'demo', name: 'Demo skill', description: 'Does a demo.', triggers: ['demo'],
      skillPath: '.pixo-skills/demo-0123456789/SKILL.md',
    }]));
    for (const streamFormat of ['claude-stream-json', 'plain']) {
      const enabled = (skill: SkillInfo) => composeProjectSkillContext({ skills: [skill], stagedSkillDirs: staged, streamFormat });
      expect(enabled(demo!), streamFormat).toEqual(enabled(withoutNames(demo!)));
      expect(enabled(demo!).stablePrompt, streamFormat).not.toMatch(/Fixture child name|夹具子技能名/);
    }
    expect(demo!.body).not.toMatch(/Fixture child name|夹具子技能名/);

    const catalog = await listSkills(['', SKILLS_ROOT]);
    const defaults = selectDefaultProjectSkills({ catalog, engine: 'phaser' });
    const real = (skills: SkillInfo[]) => composeProjectSkillContext({
      skills: [], defaultSkills: skills, stagedSkillDirs: new Map(skills.map((skill) => [skill.dir, `.pixo-skills/${skill.id}`])),
      streamFormat: 'claude-stream-json',
    }).stablePrompt;
    expect(defaults.some((skill) => skill.subSkills?.length)).toBe(true);
    expect(real(defaults)).toBe(real(defaults.map(withoutNames)));
  });
});

function writeFixtureSkill(root: string): void {
  const dir = path.join(root, 'demo');
  mkdirSync(path.join(dir, 'references'), { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), [
    '---', 'name: demo', 'en_name: Demo skill', 'description: Does a demo.', 'triggers:', '  - demo',
    'pixo:', '  mode: utility', '---', '', '# Demo', '',
    '## Focused design jobs', '', '| Job | Read |', '| --- | --- |', '| Child | [references/child.md](references/child.md) |', '',
  ].join('\n'));
  writeFileSync(path.join(dir, 'references', 'child.md'),
    '---\nen_name: Fixture child name\nzh_name: 夹具子技能名\n---\n\n# Child\n');
}
