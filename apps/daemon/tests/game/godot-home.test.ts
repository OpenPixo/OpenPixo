import { lstat, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GODOT_HOME_DIRNAME, godotHomeEnv } from '../../src/game/godot-home.js';

// Codex asked the user to approve nearly every Godot `game verify` and `game playtest`
// (C20, 2026-11-21, ~45 times in one session): Godot writes its editor settings, logs and
// user:// folder under the user profile, which the workspace-write sandbox cannot write.

let root: string, artifactDir: string, real: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pixo-godot-home-'));
  artifactDir = path.join(root, 'artifacts'); real = path.join(root, 'profile');
  await mkdir(artifactDir, { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const supported = process.platform === 'win32' || process.platform === 'linux';
/** The user's own Godot folders on this platform, and the environment that names them. */
function layout(base: string) {
  return process.platform === 'win32'
    ? { env: { APPDATA: path.join(base, 'Roaming'), LOCALAPPDATA: path.join(base, 'Local') },
      data: path.join(base, 'Roaming', 'Godot'), config: path.join(base, 'Roaming', 'Godot') }
    : { env: { XDG_DATA_HOME: path.join(base, 'data'), XDG_CONFIG_HOME: path.join(base, 'config'), XDG_CACHE_HOME: path.join(base, 'cache') },
      data: path.join(base, 'data', 'godot'), config: path.join(base, 'config', 'godot') };
}

it.runIf(supported)('points Godot at a folder of the game\'s verification data', async () => {
  const home = path.join(artifactDir, GODOT_HOME_DIRNAME);
  const env = await godotHomeEnv(artifactDir, { env: layout(real).env });
  expect(env).toEqual(layout(home).env);
  for (const dir of Object.values(env)) expect((await lstat(dir)).isDirectory()).toBe(true);
});

it.runIf(supported)('reads the installed export templates and the user\'s editor settings, newer copy wins', async () => {
  const user = layout(real), ours = layout(path.join(artifactDir, GODOT_HOME_DIRNAME));
  const template = path.join('export_templates', '4.7.1.stable', 'windows_debug_x86_64.exe');
  await mkdir(path.dirname(path.join(user.data, template)), { recursive: true });
  await writeFile(path.join(user.data, template), 'template');
  await mkdir(user.config, { recursive: true });
  await writeFile(path.join(user.config, 'editor_settings-4.7.tres'), 'user settings');
  // Godot made an empty templates folder on an earlier run, before any were linked.
  await mkdir(path.join(ours.data, 'export_templates'), { recursive: true });

  await godotHomeEnv(artifactDir, { env: user.env });
  // An export finds the templates the user installed; nothing is copied.
  expect(await readFile(path.join(ours.data, template), 'utf8')).toBe('template');
  expect(await readFile(path.join(ours.config, 'editor_settings-4.7.tres'), 'utf8')).toBe('user settings');

  // Godot saves its copy on every run; that copy is kept while the user's own is older.
  await writeFile(path.join(ours.config, 'editor_settings-4.7.tres'), 'godot saved');
  const past = new Date(Date.now() - 60_000);
  await utimes(path.join(user.config, 'editor_settings-4.7.tres'), past, past);
  await godotHomeEnv(artifactDir, { env: user.env });
  expect(await readFile(path.join(ours.config, 'editor_settings-4.7.tres'), 'utf8')).toBe('godot saved');

  // A change the user makes in their own editor later is picked up.
  await writeFile(path.join(user.config, 'editor_settings-4.7.tres'), 'user changed');
  const future = new Date(Date.now() + 60_000);
  await utimes(path.join(user.config, 'editor_settings-4.7.tres'), future, future);
  await godotHomeEnv(artifactDir, { env: user.env });
  expect(await readFile(path.join(ours.config, 'editor_settings-4.7.tres'), 'utf8')).toBe('user changed');
});

it('leaves Godot on its own folders where it cannot be redirected, or when the folder cannot be made', async () => {
  expect(await godotHomeEnv(artifactDir, { platform: 'darwin', env: {} })).toEqual({});
  const blocked = path.join(root, 'not-a-folder');
  await writeFile(blocked, 'x');
  expect(await godotHomeEnv(blocked, { env: layout(real).env })).toEqual({});
});
