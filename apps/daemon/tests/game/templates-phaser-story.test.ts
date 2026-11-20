import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { copyGameTemplate, listGameTemplates } from '../../src/game/templates.js';

const templatesRoot = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
const KIT = 'phaser3-story';
const exec = promisify(execFile);
const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

function read(id: string, file: string) {
  return readFile(path.join(templatesRoot, id, 'files', file), 'utf8');
}

async function files(id: string, folder = ''): Promise<string[]> {
  const root = path.join(templatesRoot, id, 'files', folder);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/')).sort();
}

it('is listed as a Phaser kit for visual novels, with both languages and a cover', async () => {
  const kit = (await listGameTemplates(templatesRoot)).find(template => template.id === KIT);
  expect(kit).toMatchObject({ engine: 'phaser', genres: ['visual-novel'], coverUrl: `/api/game-templates/${KIT}/cover` });
  expect(kit?.nameZhCN && kit.descriptionZhCN).toBeTruthy();
});

it('ships the same story, in the same format, as the Godot story kit', async () => {
  const story = await files(KIT, 'story');
  expect(story).toEqual(await files('godot4-story', 'story'));
  for (const file of story) expect(await read(KIT, `story/${file}`), file).toBe(await read('godot4-story', `story/${file}`));
});

it('pins the plain Phaser starter\'s versions and runs the story check with every check and build', async () => {
  const kit = JSON.parse(await read(KIT, 'package.json'));
  const base = JSON.parse(await read('phaser3-vite', 'package.json'));
  expect(kit.dependencies).toEqual(base.dependencies);
  expect(kit.devDependencies).toEqual(base.devDependencies);
  expect(kit.packageManager).toBe(base.packageManager);
  expect(kit.scripts.check).toBe('tsc --noEmit && node scripts/check-story.ts');
  expect(kit.scripts.build).toContain('node scripts/check-story.ts');
});

it('has every menu string in both languages, and no Steamworks code', async () => {
  const strings = await read(KIT, 'src/strings.ts');
  const rows = [...strings.matchAll(/^\s+([A-Z_]+): \{ (.*) \},$/gm)];
  expect(rows.length).toBeGreaterThan(20);
  for (const [, key, cells] of rows) expect(cells, key).toMatch(/^en: '[^']+', zh_CN: '[^']+'$/);
  for (const file of await files(KIT)) expect(await read(KIT, file), file).not.toMatch(/steam|app_?id/i);
});

it('gives both story kits short project notes that agents load on their own', async () => {
  for (const id of [KIT, 'godot4-story']) {
    const notes = await read(id, 'AGENTS.md');
    // The game prompt asks agents to keep project notes under about 60 lines.
    expect(notes.split(/\r?\n/).length, id).toBeLessThanOrEqual(60);
    expect(notes, id).toMatch(/^# Project notes/);
    expect(notes, id).toContain('story/<language>/*.story');
  }
});

it('checks its story with Node alone, naming the file and line of a broken translation', async () => {
  const parentDir = await mkdtemp(path.join(tmpdir(), 'openpixo-phaser-story-'));
  scratch.push(parentDir);
  const project = await copyGameTemplate(templatesRoot, { parentDir, name: 'story', templateId: KIT });
  // Node 24 runs the TypeScript check as it is: no install is needed.
  const run = () => exec(process.execPath, ['scripts/check-story.ts'], { cwd: project, timeout: 60_000, windowsHide: true });
  const passed = await run();
  expect(passed.stdout).toContain('STORY CHECK passed: 2 language(s) en, zh_CN, 10 label(s), 3 ending(s), 27 playthrough state(s) tried');
  expect(passed.stdout).toContain('note: no picture for the background "station_night": add assets/backgrounds/station_night.png');

  const zh = path.join(project, 'story/zh_CN/main.story');
  const story = await readFile(zh, 'utf8');
  await writeFile(zh, story.replace('-> quiet', '-> quite').replace('@show iko smile', '@show iko happy'));
  const broken = await run().then(() => null, (error: { stderr?: string; code?: number }) => error);
  expect(broken?.code).toBe(1);
  expect(broken?.stderr).toContain('story/zh_CN/main.story:30: there is no label "quite"');
  expect(broken?.stderr).toContain('story/zh_CN/main.story:37: "@show iko happy", but story/en/main.story:38 has "@show iko smile"; only the text may differ between languages');
});
