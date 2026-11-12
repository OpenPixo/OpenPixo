// Skill catalogue reads happen per request and per run start. They must be cheap
// without ever being stale: no clock is involved, an unchanged SKILL.md is simply
// not read again, and a read never shares a scan that began before it arrived.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSkillCatalog } from '../../src/services/skill-catalog.js';
import * as skills from '../../src/skills.js';

// skills.ts binds `node:fs/promises` by name, which a spy on the default export misses.
const readFiles = vi.hoisted(() => [] as string[]);

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readFile = ((...args: Parameters<typeof actual.readFile>) => {
    readFiles.push(String(args[0]));
    return actual.readFile(...args);
  }) as typeof actual.readFile;
  return { ...actual, readFile, default: { ...actual, readFile } };
});

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  readFiles.length = 0;
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixo-skill-cache-'));
  directories.push(root);
  const file = path.join(root, 'game', 'SKILL.md');
  fs.mkdirSync(path.dirname(file));
  const write = (description: string) => fs.writeFileSync(
    file,
    `---\nname: game\nen_name: Game\ndescription: ${description}\ntriggers: [game]\npixo:\n  default_for: [game]\n---\nBody ${description}\n`,
  );
  write('original');
  const listSkills = vi.fn(skills.listSkills);
  const roots = { skillRoots: [root], templateRoots: [], allRoots: [root] };
  const catalog = createSkillCatalog({ roots, skills: { listSkills, findSkillById: skills.findSkillById } as never });
  const reads = () => readFiles.filter((entry) => entry === file).length;
  return { root, file, write, listSkills, catalog, roots, reads };
}

describe('listSkills parse cache', () => {
  it('does not read an unchanged SKILL.md again', async () => {
    const f = fixture();
    await skills.listSkills([f.root]);
    await skills.listSkills([f.root]);
    await skills.listSkills([f.root]);
    expect(f.reads()).toBe(1);
  });

  it('does not let a caller corrupt what the next read returns', async () => {
    const f = fixture();
    const first = await skills.listSkills([f.root]);
    first[0]!.triggers.push({ nested: ['corrupted'] });
    first[0]!.displayName!.en = 'corrupted';
    first[0]!.defaultFor.push('corrupted');
    const second = await skills.listSkills([f.root]);
    expect(second[0]!.triggers).toEqual(['game']);
    expect(second[0]!.displayName!.en).toBe('Game');
    expect(second[0]!.defaultFor).toEqual(['game']);
    expect(f.reads()).toBe(1);
  });

  it('re-reads on a same-size edit that moved the mtime', async () => {
    const f = fixture();
    await skills.listSkills([f.root]);
    f.write('replaced');
    fs.utimesSync(f.file, new Date(1_000_000), new Date(1_000_000));
    expect((await skills.listSkills([f.root]))[0]!.description).toBe('replaced');
  });

  it('still notices the side files a parse cache must not pin', async () => {
    const f = fixture();
    const dir = path.dirname(f.file);
    const before = (await skills.listSkills([f.root]))[0]!;
    expect(before.body).toBe('Body original\n');
    fs.mkdirSync(path.join(dir, 'examples'));
    fs.writeFileSync(path.join(dir, 'examples', 'demo.html'), '<html></html>');
    const after = await skills.listSkills([f.root]);
    expect(after.map((entry) => entry.id).sort()).toEqual(['game', 'game:demo']);
    expect(after.find((entry) => entry.id === 'game')!.body).toContain('Skill root');
    expect(f.reads()).toBe(1);
  });

  it('keeps the first-root-wins source for one file listed under two root orders', async () => {
    const f = fixture();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pixo-skill-cache-other-'));
    directories.push(other);
    expect((await skills.listSkills([f.root]))[0]!.source).toBe('user');
    expect((await skills.listSkills([other, f.root]))[0]!.source).toBe('built-in');
  });
});

describe('createSkillCatalog', () => {
  it('shares reads that arrive before a scan begins, and hands each its own copy', async () => {
    const f = fixture();
    const [first, second, combined] = await Promise.all([
      f.catalog.listAllSkills(),
      f.catalog.listAllSkills(),
      f.catalog.listAllSkillLikeEntries(),
    ]) as any[];
    expect(f.listSkills).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(combined[0]);
    first[0].triggers.push('corrupted');
    first[0].displayName.en = 'corrupted';
    expect(second[0].triggers).toEqual(['game']);
    expect(second[0].displayName.en).toBe('Game');
    await f.catalog.listAllSkills();
    expect(f.listSkills).toHaveBeenCalledTimes(2);
  });

  it('scans separately for different roots', async () => {
    const f = fixture();
    const [skillEntries, templates] = await Promise.all([f.catalog.listAllSkills(), f.catalog.listAllTemplates()]);
    expect(skillEntries.map((entry) => entry.id)).toEqual(['game']);
    expect(templates).toEqual([]);
    expect(f.listSkills).toHaveBeenCalledTimes(2);
  });

  it('runs at most one more scan for any number of reads arriving during a scan', async () => {
    const f = fixture();
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const captured = new Promise<void>((resolve) => { started = resolve; });
    f.listSkills.mockImplementationOnce(async (roots) => {
      const entries = await skills.listSkills(roots);
      started();
      await blocked;
      return entries;
    });
    const running = f.catalog.listAllSkills();
    await captured;
    const waiting = [f.catalog.listAllSkills(), f.catalog.listAllSkills(), f.catalog.listAllSkills()];
    release();
    await Promise.all([running, ...waiting]);
    expect(f.listSkills).toHaveBeenCalledTimes(2);
  });

  it('shows edits, additions and removals on the next read', async () => {
    const f = fixture();
    await f.catalog.listAllSkills();
    f.write('edited and longer');
    expect((await f.catalog.listAllSkills())[0]!.description).toBe('edited and longer');
    fs.mkdirSync(path.join(f.root, 'new'));
    fs.writeFileSync(path.join(f.root, 'new', 'SKILL.md'), '---\nname: new\n---\nNew');
    expect((await f.catalog.listAllSkills()).map((entry) => entry.id).sort()).toEqual(['game', 'new']);
    fs.rmSync(path.dirname(f.file), { recursive: true });
    expect((await f.catalog.listAllSkills()).map((entry) => entry.id)).toEqual(['new']);
  });

  it('does not let a read made after an edit join a scan that began before it', async () => {
    const f = fixture();
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const captured = new Promise<void>((resolve) => { started = resolve; });
    f.listSkills.mockImplementationOnce(async (roots) => {
      const entries = await skills.listSkills(roots);
      started();
      await blocked;
      return entries;
    });
    const beforeEdit = f.catalog.listAllSkills();
    await captured;
    f.write('edited after discovery began');
    const afterEdit = f.catalog.listAllSkills();
    // Release first: joining the old scan must fail a value assertion, not time out.
    release();
    expect((await afterEdit)[0]!.description).toBe('edited after discovery began');
    expect((await beforeEdit)[0]!.description).toBe('original');
    expect(f.listSkills).toHaveBeenCalledTimes(2);
  });

  it('isolates nested mutations from later reads', async () => {
    const f = fixture();
    const entry = { id: 'game', preview: { labels: ['original'] } };
    const catalog = createSkillCatalog({
      roots: f.roots,
      skills: {
        listSkills: async () => [entry],
        findSkillById: (entries, id) => entries.find((value) => value.id === id),
      },
    });
    const first = await catalog.listAllSkills();
    first[0]!.preview.labels[0] = 'corrupted';
    first.push({ id: 'extra', preview: { labels: [] } });
    expect(await catalog.listAllSkills()).toEqual([{ id: 'game', preview: { labels: ['original'] } }]);
  });

  it('recovers on the next read after a failed scan, and rejects only the reads that shared it', async () => {
    const f = fixture();
    f.listSkills.mockRejectedValueOnce(new Error('discovery failed'));
    const [first, second] = await Promise.allSettled([f.catalog.listAllSkills(), f.catalog.listAllSkills()]);
    expect(first.status).toBe('rejected');
    expect(second.status).toBe('rejected');
    expect(f.listSkills).toHaveBeenCalledTimes(1);
    expect((await f.catalog.listAllSkills())[0]!.id).toBe('game');
  });

  it('starts the waiting scan even when the one before it failed', async () => {
    const f = fixture();
    let fail!: (error: Error) => void;
    f.listSkills.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const failing = f.catalog.listAllSkills();
    await vi.waitFor(() => expect(f.listSkills).toHaveBeenCalledTimes(1));
    const waiting = f.catalog.listAllSkills();
    fail(new Error('discovery failed'));
    await expect(failing).rejects.toThrow('discovery failed');
    expect((await waiting)[0]!.id).toBe('game');
  });

  it('still validates a project skill id the same way', async () => {
    const f = fixture();
    await expect(f.catalog.validateProjectSkillId('game')).resolves.toEqual({ ok: true, id: 'game' });
    await expect(f.catalog.validateProjectSkillId('missing')).resolves.toMatchObject({ ok: false, code: 'SKILL_NOT_FOUND' });
    await expect(f.catalog.validateProjectSkillId(null)).resolves.toEqual({ ok: true, id: null });
  });
});
