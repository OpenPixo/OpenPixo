import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { copyGameTemplate } from '../../src/game/templates.js';

const templatesRoot = fileURLToPath(new URL('../../../../game-templates/', import.meta.url));
const smokeDriver = fileURLToPath(new URL('./fixtures/godot-starter-smoke.gd', import.meta.url));
const STARTERS = ['godot4-2d', 'godot4-3d'] as const;
/** The one part of a Godot starter that differs by design; everything else is shared. */
const OWN_FILES = /^(project\.godot|game\/.+)$/;
const exec = promisify(execFile);
const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

function starterDir(id: string) {
  return path.join(templatesRoot, id, 'files');
}

async function starterFiles(id: string): Promise<string[]> {
  const entries = await readdir(starterDir(id), { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(starterDir(id), path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/'))
    .sort();
}

function read(id: string, file: string) {
  return readFile(path.join(starterDir(id), file), 'utf8');
}

async function stringTable(id: string) {
  const [header, ...rows] = (await read(id, 'i18n/strings.csv')).split(/\r?\n/).filter(Boolean);
  const locales = header!.split(',').slice(1);
  // Only GAME_HINT quotes a cell, so a plain split is exact for every other row.
  return { locales, rows: rows.map(row => {
    const cells = [...row.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].slice(0, locales.length + 1).map(cell => cell[2] ?? cell[1]!);
    return { key: cells[0]!, translations: cells.slice(1) };
  }) };
}

/** The `[input]` section of project.godot as action name to raw event list. */
function inputActions(project: string) {
  const section = project.split('[input]')[1]!.split(/^\[/m)[0]!;
  return new Map([...section.matchAll(/^(\w+)=\{[^}]*"events": \[(.*)\]\s*\}/gm)].map(match => [match[1]!, match[2]!]));
}

describe.each(STARTERS)('%s starter', id => {
  it('ships the basics a sold game needs and opens on the title screen', async () => {
    const files = await starterFiles(id);
    expect(files).toEqual(expect.arrayContaining([
      'autoload/save_game.gd', 'autoload/settings.gd', 'autoload/strings.gd', 'default_bus_layout.tres',
      'game/game.gd', 'game/game.tscn', 'game/player.gd', 'i18n/strings.csv', 'i18n/strings.csv.import',
      'ui/pause_menu.tscn', 'ui/settings_screen.tscn', 'ui/theme.tres', 'ui/title_screen.tscn',
    ]));
    const project = await read(id, 'project.godot');
    expect(project).toContain('run/main_scene="res://ui/title_screen.tscn"');
    expect(project).toContain('Settings="*res://autoload/settings.gd"');
    // Without this, a fullscreen game draws its menus at window size in one corner.
    expect(project).toContain('window/stretch/mode="canvas_items"');
    expect(await read(id, 'game/game.tscn')).toContain('name="PauseMenu"');
    expect(await read(id, 'ui/title_screen.tscn')).toContain('MENU_QUIT_DESKTOP');
  });

  it('has no Steamworks code and no App ID', async () => {
    for (const file of await starterFiles(id)) {
      expect(await read(id, file), file).not.toMatch(/steam|app_?id/i);
    }
  });

  it('binds every action on both keyboard and gamepad, including menu confirm and cancel', async () => {
    const actions = inputActions(await read(id, 'project.godot'));
    expect([...actions.keys()]).toEqual(['ui_accept', 'ui_cancel', 'move_up', 'move_down', 'move_left', 'move_right', 'pause']);
    for (const [action, events] of actions) {
      expect(events, action).toContain('InputEventKey');
      expect(events, action).toContain('InputEventJoypadButton');
      // Device -1 means any gamepad; a binding without it answers only the first one.
      expect(events.match(/Object\(/g)!.length, action).toBe(events.match(/"device":-1/g)!.length);
    }
    for (const axis of ['move_up', 'move_down', 'move_left', 'move_right']) {
      expect(actions.get(axis), axis).toContain('InputEventJoypadMotion');
    }
  });

  it('keeps settings and saves under user://, and writes nothing under res://', async () => {
    expect(await read(id, 'autoload/settings.gd')).toContain('const PATH := "user://settings.cfg"');
    expect(await read(id, 'autoload/save_game.gd')).toContain('const PATH := "user://save.json"');
    for (const file of (await starterFiles(id)).filter(name => name.endsWith('.gd'))) {
      const source = await read(id, file);
      expect(source, file).not.toMatch(/FileAccess\.open\(\s*"res:\/\/[^)]*WRITE/);
      expect(source, file).not.toMatch(/\.save\(\s*"res:\/\//);
    }
  });

  it('keeps player-facing text in a complete string table', async () => {
    const { locales, rows } = await stringTable(id);
    expect(locales).toEqual(['en', 'zh_CN']);
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.translations.map(text => text.trim()).filter(Boolean), row.key).toHaveLength(locales.length);
    }
    const keys = new Set(rows.map(row => row.key));
    const files = await starterFiles(id);
    for (const scene of files.filter(file => file.endsWith('.tscn'))) {
      for (const [, text] of (await read(id, scene)).matchAll(/^text = "(.*)"$/gm)) {
        expect(text, `${scene} sets text that is not a string key`).toMatch(/^[A-Z][A-Z0-9_]*$/);
        expect(keys.has(text!), `${scene}: ${text}`).toBe(true);
      }
    }
    const settings = await read(id, 'autoload/settings.gd');
    const rebindable = settings.match(/const REBINDABLE[^=]*= \[(.*)\]/)![1]!;
    for (const [, action] of rebindable.matchAll(/&"(\w+)"/g)) expect(keys.has(`ACTION_${action!.toUpperCase()}`), action).toBe(true);
    const buses = settings.match(/const VOLUME_BUSES[^=]*= \[(.*)\]/)![1]!;
    for (const [, bus] of buses.matchAll(/"(\w+)"/g)) expect(keys.has(`SETTINGS_VOLUME_${bus!.toUpperCase()}`), bus).toBe(true);
    const screen = await read(id, 'ui/settings_screen.gd');
    for (const [, key] of screen.matchAll(/"(SETTINGS_[A-Z_]+)"/g)) expect(keys.has(key!), key).toBe(true);
  });

  it('exports the string table as it is, so no import step can leave it stale or missing', async () => {
    expect(await read(id, 'i18n/strings.csv.import')).toContain('importer="keep"');
    expect(await read(id, 'project.godot')).not.toContain('.translation');
  });

  it('copies nested folders and hidden files into a new project', async () => {
    const parentDir = await mkdtemp(path.join(tmpdir(), 'openpixo-godot-template-'));
    scratch.push(parentDir);
    const target = await copyGameTemplate(templatesRoot, { parentDir, name: 'game', templateId: id });
    for (const file of [...await starterFiles(id)]) {
      expect(await readFile(path.join(target, file), 'utf8'), file).toBe(await read(id, file));
    }
  });
});

it('shares every file between the 2D and 3D Godot starters except the game itself', async () => {
  const [flat, spatial] = await Promise.all(STARTERS.map(starterFiles));
  const shared = flat!.filter(file => !OWN_FILES.test(file));
  expect(spatial!.filter(file => !OWN_FILES.test(file))).toEqual(shared);
  for (const file of shared) expect(await read('godot4-3d', file), file).toBe(await read('godot4-2d', file));
  const withoutName = (project: string) => project.replace(/^config\/name=.*$/m, '');
  expect(withoutName(await read('godot4-3d', 'project.godot'))).toBe(withoutName(await read('godot4-2d', 'project.godot')));
});

/**
 * Plays each starter in a real engine with real input events: `PIXO_TEST_GODOT`
 * names the Godot executable. Off by default because CI has no Godot. It starts
 * no agent and no generation, and user:// goes to a temporary folder.
 */
const godot = process.env.PIXO_TEST_GODOT;

describe.skipIf(!godot).each(STARTERS)('%s in a real Godot', id => {
  it('plays through title, settings, game, pause and a restart', { timeout: 300_000 }, async () => {
    const parentDir = await mkdtemp(path.join(tmpdir(), 'openpixo-godot-run-'));
    scratch.push(parentDir);
    const project = await copyGameTemplate(templatesRoot, { parentDir, name: 'game', templateId: id });
    await copyFile(smokeDriver, path.join(project, 'smoke.gd'));
    await writeFile(path.join(project, 'override.cfg'), '[autoload]\nSmoke="*res://smoke.gd"\n');
    const data = path.join(parentDir, 'user-data');
    const env = { ...process.env, APPDATA: data, XDG_DATA_HOME: data };
    const run = (args: string[], extra: NodeJS.ProcessEnv = {}) =>
      exec(godot!, ['--headless', '--path', project, ...args], { env: { ...env, ...extra }, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });

    await run(['--import', '--quit']);
    for (const pass of ['first', 'second', 'quit-game', 'quit-title']) {
      const { stdout, stderr } = await run([], { SMOKE_PASS: pass });
      expect(stdout, `${pass} pass:\n${stdout}\n${stderr}`).toContain('SMOKE passed');
      expect(`${stdout}\n${stderr}`).not.toMatch(/SMOKE failed|SCRIPT ERROR/);
    }
  });
});
