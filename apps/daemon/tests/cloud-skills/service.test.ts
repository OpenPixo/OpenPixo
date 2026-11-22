import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudSkillCatalogEntry, CloudToolInfo } from '@openpixo/contracts';
import { CloudSkillsService } from '../../src/cloud-skills/service.js';
import { cloudSkillCatalog, cloudToolList } from '../../src/cloud-skills/wire.js';

const BASE = 'https://play.example.test/__skill';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

interface FakeSkill { entry: CloudSkillCatalogEntry; files: Record<string, string>; corrupt?: boolean }

let dir: string;
let signedIn: boolean;
let published: FakeSkill[];
let tools: CloudToolInfo[];
let fetched: string[];

function skill(name: string, version: string, body = `Use ${name} when it fits.`): FakeSkill {
  return {
    entry: { name, version, title: `Title ${name}`, description: `Does ${name}.` },
    files: {
      'SKILL.md': `---\nname: ${name}\ndescription: Does ${name}.\n---\n\n${body}\n`,
      'references/detail.md': `More about ${name}.\n`,
    },
  };
}

const fakeFetch = async (url: string, init: { headers: Record<string, string> }) => {
  fetched.push(url);
  expect(init.headers.authorization).toBe('Bearer grant-token');
  const [name, version, ...rest] = url.slice(BASE.length + 1).split('/');
  const item = published.find((candidate) => candidate.entry.name === name && candidate.entry.version === decodeURIComponent(version!));
  if (!item) return new Response('missing', { status: 404 });
  const file = rest.map(decodeURIComponent).join('/');
  if (file === 'skill.json') {
    return new Response(JSON.stringify({ schema: 1, ...item.entry, triggers: ['when it fits'],
      files: Object.entries(item.files).map(([filePath, text]) => ({ path: filePath, size: Buffer.byteLength(text), sha256: sha(text) })) }));
  }
  const text = item.files[file];
  if (text === undefined) return new Response('missing', { status: 404 });
  return new Response(item.corrupt ? `X${text.slice(1)}` : text);
};

function service(localIds: string[] = []) {
  return new CloudSkillsService({
    dir,
    account: {
      hasSession: async () => signedIn,
      skillCatalog: async () => cloudSkillCatalog({ skills: published.map((item) => item.entry), baseUrl: BASE, token: 'grant-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      agentTools: async () => tools,
    },
    localSkillIds: async () => localIds,
    fetch: fakeFetch as never,
  });
}

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), 'op-cloud-skills-')), 'cloud-skills');
  signedIn = true;
  published = [skill('level-pacing', 'aaaaaaaaaaaa')];
  tools = [{ id: 'look', description: 'Answers one question about one image.', input: 'image' }];
  fetched = [];
});

afterEach(async () => { await rm(path.dirname(dir), { recursive: true, force: true }); });

describe('cloud skills', () => {
  it('downloads every listed skill once, checks each file, and offers it to hosted runs only by its folder id', async () => {
    const cloud = service();
    const status = await cloud.sync();
    expect(status).toMatchObject({ signedIn: true, error: null, tools,
      skills: [{ name: 'level-pacing', version: 'aaaaaaaaaaaa', title: 'Title level-pacing', active: true }] });
    expect(await readFile(path.join(dir, 'level-pacing', 'references', 'detail.md'), 'utf8')).toBe('More about level-pacing.\n');
    const skills = await cloud.skillsForHostedRun();
    expect(skills.map((item) => item.id)).toEqual(['level-pacing']);

    fetched = [];
    await cloud.sync();
    expect(fetched).toEqual([]);
  });

  it('replaces a changed skill, removes one no longer listed, and keeps an old copy when a download fails', async () => {
    const cloud = service();
    published.push(skill('boss-fights', 'bbbbbbbbbbbb'));
    await cloud.sync();
    published = [{ ...skill('level-pacing', 'cccccccccccc', 'New text.'), corrupt: true }];
    const status = await cloud.sync();
    expect(status.error).toContain('did not match');
    expect(status.skills).toEqual([expect.objectContaining({ name: 'level-pacing', version: 'aaaaaaaaaaaa' })]);
    expect(await readFile(path.join(dir, 'level-pacing', 'SKILL.md'), 'utf8')).toContain('Use level-pacing');
    expect((await readdir(dir)).filter((name) => !name.startsWith('.'))).toEqual(['level-pacing', 'state.json']);

    published = [skill('level-pacing', 'cccccccccccc', 'New text.')];
    expect((await cloud.sync()).skills[0]!.version).toBe('cccccccccccc');
    expect(await readFile(path.join(dir, 'level-pacing', 'SKILL.md'), 'utf8')).toContain('New text.');
  });

  it('lets a local skill with the same id win', async () => {
    const cloud = service(['level-pacing']);
    expect((await cloud.sync()).skills[0]!.active).toBe(false);
    expect(await cloud.skillsForHostedRun()).toEqual([]);
  });

  it('keeps what it has when signed out and remembers the last sync across restarts', async () => {
    await service().sync();
    signedIn = false;
    const later = service();
    const status = await later.sync();
    expect(status.signedIn).toBe(false);
    expect(status.skills.map((item) => item.name)).toEqual(['level-pacing']);
    expect(status.syncedAt).not.toBeNull();
  });

  it('refuses a manifest that writes outside the skill folder or carries other file types', async () => {
    await mkdir(dir, { recursive: true });
    const bad = skill('level-pacing', 'dddddddddddd');
    bad.files = { 'SKILL.md': bad.files['SKILL.md']!, '../escape.md': 'x' };
    published = [bad];
    const status = await service().sync();
    expect(status.error).toContain('not valid');
    expect(status.skills).toEqual([]);
    published = [{ ...skill('level-pacing', 'eeeeeeeeeeee'), files: { 'SKILL.md': 'x', 'run.sh': 'echo' } }];
    expect((await service().sync()).error).toContain('not valid');
  });
});

describe('cloud wire', () => {
  it('only accepts a download base on the cloud’s own __skill path', () => {
    const body = { skills: [], token: 't', expiresAt: new Date().toISOString() };
    expect(cloudSkillCatalog({ ...body, baseUrl: BASE }).baseUrl).toBe(BASE);
    expect(() => cloudSkillCatalog({ ...body, baseUrl: 'https://evil.example/__pack/x/1.0.0' })).toThrow();
    expect(() => cloudSkillCatalog({ ...body, baseUrl: 'http://evil.example/__skill' })).toThrow();
  });

  it('drops tools with bad ids, long descriptions or unknown inputs, and sorts the rest', () => {
    expect(cloudToolList({ tools: [
      { id: 'zeta', description: 'Z.', input: 'text' },
      { id: 'Bad Id', description: 'x', input: 'text' },
      { id: 'long', description: 'x'.repeat(161), input: 'text' },
      { id: 'audio', description: 'Listens.', input: 'audio' },
      { id: 'alpha', description: 'A.', input: 'image' },
    ] })).toEqual([{ id: 'alpha', description: 'A.', input: 'image' }, { id: 'zeta', description: 'Z.', input: 'text' }]);
  });
});
