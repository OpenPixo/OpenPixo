import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { copyGameTemplate, listGameTemplates } from '../../src/game/templates.js';

const templatesRoot = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
const smokeDriver = fileURLToPath(new URL('./fixtures/godot-story-smoke.gd', import.meta.url));
const KIT = 'godot4-story';
const BASE = 'godot4-2d';
/**
 * What the story kit owns. Everything else is the plain 2D starter's file,
 * byte for byte, so a fix to the shared menus, settings and saves lands in both.
 * Its settings script differs only in the rebindable actions, and its string
 * table only drops the 2D game's rows and adds the story's.
 */
const OWN_FILES = /^(project\.godot|README\.md|AGENTS\.md|game\/.+|story\/.+|checks\/.+|addons\/.+|autoload\/settings\.gd|i18n\/strings\.csv)$/;
const exec = promisify(execFile);
const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

function dir(id: string) {
  return path.join(templatesRoot, id, 'files');
}

async function files(id: string): Promise<string[]> {
  const entries = await readdir(dir(id), { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(dir(id), path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/'))
    .sort();
}

function read(id: string, file: string) {
  return readFile(path.join(dir(id), file), 'utf8');
}

/** Rows of a string table by key; no cell in either table holds a comma inside quotes. */
async function rows(id: string): Promise<Map<string, string>> {
  const lines = (await read(id, 'i18n/strings.csv')).split(/\r?\n/).filter(Boolean).slice(1);
  return new Map(lines.map(line => [line.split(',')[0]!, line]));
}

function inputActions(project: string) {
  const section = project.split('[input]')[1]!.split(/^\[/m)[0]!;
  return new Map([...section.matchAll(/^(\w+)=\{[^}]*"events": \[(.*)\]\s*\}/gm)].map(match => [match[1]!, match[2]!]));
}

it('is listed as a Godot kit for visual novels, with both languages and a cover', async () => {
  const kit = (await listGameTemplates(templatesRoot)).find(template => template.id === KIT);
  expect(kit).toMatchObject({ engine: 'godot', genres: ['visual-novel'], coverUrl: `/api/game-templates/${KIT}/cover` });
  expect(kit?.nameZhCN && kit.descriptionZhCN).toBeTruthy();
});

it('shares every menu, setting and save file with the plain 2D starter', async () => {
  const [kit, base] = await Promise.all([files(KIT), files(BASE)]);
  const shared = base.filter(file => !OWN_FILES.test(file) && !file.startsWith('game/'));
  expect(kit.filter(file => !OWN_FILES.test(file))).toEqual(shared);
  for (const file of shared) expect(await read(KIT, file), file).toBe(await read(BASE, file));
  const withoutRebindable = (source: string) => source.replace(/^const REBINDABLE.*$/m, '');
  expect(withoutRebindable(await read(KIT, 'autoload/settings.gd'))).toBe(withoutRebindable(await read(BASE, 'autoload/settings.gd')));
  // The project differs only in its name, its input actions and the export plugin.
  const outside = (project: string) => project.replace(/^config\/name=.*$/m, '')
    .replace(/\[input\][\s\S]*?(?=^\[)/m, '').replace(/\[editor_plugins\][\s\S]*?(?=^\[)/m, '');
  expect(outside(await read(KIT, 'project.godot'))).toBe(outside(await read(BASE, 'project.godot')));
  const [kitRows, baseRows] = await Promise.all([rows(KIT), rows(BASE)]);
  for (const [key, row] of baseRows) {
    if (key.startsWith('ACTION_MOVE_') || key === 'GAME_HINT') expect(kitRows.has(key), key).toBe(false);
    else expect(kitRows.get(key), key).toBe(row);
  }
});

it('binds every story action on keyboard and gamepad, and lets the player rebind them', async () => {
  const actions = inputActions(await read(KIT, 'project.godot'));
  expect([...actions.keys()]).toEqual(['ui_accept', 'ui_cancel', 'advance', 'story_log', 'story_auto', 'story_skip', 'pause']);
  for (const [action, events] of actions) {
    expect(events, action).toContain('InputEventKey');
    expect(events, action).toContain('InputEventJoypadButton');
    expect(events.match(/Object\(/g)!.length, action).toBe(events.match(/"device":-1/g)!.length);
  }
  const settings = await read(KIT, 'autoload/settings.gd');
  const rebindable = [...settings.match(/const REBINDABLE[^=]*= \[(.*)\]/)![1]!.matchAll(/&"(\w+)"/g)].map(match => match[1]!);
  expect(rebindable).toEqual(['advance', 'story_log', 'story_auto', 'story_skip']);
  const keys = await rows(KIT);
  for (const action of rebindable) expect(keys.has(`ACTION_${action.toUpperCase()}`), action).toBe(true);
});

it('keeps every scene string in the table, in both languages', async () => {
  const table = await rows(KIT);
  for (const [key, row] of table) expect(row.split(',').slice(1).every(cell => cell.trim()), key).toBe(true);
  for (const scene of (await files(KIT)).filter(file => file.endsWith('.tscn'))) {
    for (const [, text] of (await read(KIT, scene)).matchAll(/^text = "(.*)"$/gm)) {
      expect(table.has(text!), `${scene}: ${text}`).toBe(true);
    }
  }
  for (const [, key] of (await read(KIT, 'game/game.gd')).matchAll(/tr\("([A-Z_]+)"\)/g)) expect(table.has(key!), key).toBe(true);
});

it('ships the same story files in every language, and packs them into exports', async () => {
  const all = await files(KIT);
  const byLanguage = (language: string) => all.filter(file => file.startsWith(`story/${language}/`)).map(file => file.split('/').at(-1));
  expect(byLanguage('en')).toEqual(['main.story']);
  expect(byLanguage('zh_CN')).toEqual(byLanguage('en'));
  expect(await read(KIT, 'project.godot')).toContain('enabled=PackedStringArray("res://addons/story_files/plugin.cfg")');
  expect(await read(KIT, 'addons/story_files/plugin.gd')).toContain('add_file(path, FileAccess.get_file_as_bytes(path), false)');
});

it('has no Steamworks code, and writes nothing under res://', async () => {
  for (const file of await files(KIT)) {
    const source = await read(KIT, file);
    expect(source, file).not.toMatch(/steam|app_?id/i);
    if (file.endsWith('.gd')) {
      expect(source, file).not.toMatch(/FileAccess\.open\(\s*"res:\/\/[^)]*WRITE/);
      expect(source, file).not.toMatch(/\.save\(\s*"res:\/\//);
    }
  }
  expect(await read(KIT, 'game/game.gd')).toContain('const ENDINGS_PATH := "user://endings.json"');
});

/**
 * Plays the kit in a real engine with real input events: `PIXO_TEST_GODOT`
 * names the Godot executable. Off by default because CI has no Godot. It starts
 * no agent and no generation, and user:// goes to a temporary folder.
 */
const godot = process.env.PIXO_TEST_GODOT;

describe.skipIf(!godot)('the story kit in a real Godot', () => {
  it('passes its own story check and plays through choices, skip, log, languages, saves and an ending', { timeout: 300_000 }, async () => {
    const parentDir = await mkdtemp(path.join(tmpdir(), 'openpixo-story-run-'));
    scratch.push(parentDir);
    const project = await copyGameTemplate(templatesRoot, { parentDir, name: 'story', templateId: KIT });
    const data = path.join(parentDir, 'user-data');
    const env = { ...process.env, APPDATA: data, XDG_DATA_HOME: data };
    const run = (args: string[], extra: NodeJS.ProcessEnv = {}) =>
      exec(godot!, ['--headless', '--path', project, ...args], { env: { ...env, ...extra }, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });

    await run(['--import', '--quit']);
    const check = await run(['--script', 'checks/story_check.gd']);
    expect(check.stdout).toMatch(/STORY CHECK passed: 2 language\(s\) en, zh_CN, 10 label\(s\), 3 ending\(s\)/);

    // A broken translation is caught with its file and line.
    const zh = path.join(project, 'story/zh_CN/main.story');
    const story = await readFile(zh, 'utf8');
    await writeFile(zh, story.replace('-> quiet', '-> quite'));
    const broken = await run(['--script', 'checks/story_check.gd']).then(() => null, (error: { stderr?: string; code?: number }) => error);
    expect(broken?.code).toBe(1);
    expect(broken?.stderr).toContain('res://story/zh_CN/main.story:30: there is no label "quite"');
    await writeFile(zh, story);

    await copyFile(smokeDriver, path.join(project, 'smoke.gd'));
    await writeFile(path.join(project, 'override.cfg'), '[autoload]\nSmoke="*res://smoke.gd"\n');
    for (const pass of ['first', 'second']) {
      const { stdout, stderr } = await run([], { SMOKE_PASS: pass });
      expect(stdout, `${pass} pass:\n${stdout}\n${stderr}`).toContain('SMOKE passed');
      expect(`${stdout}\n${stderr}`).not.toMatch(/SMOKE failed|SCRIPT ERROR/);
    }
  });
});
