import { copyFile, lstat, mkdir, readdir, rmdir, stat, symlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Godot's own folders during `pixo game verify` and `pixo game playtest`: a folder of
 * the game's verification artifacts instead of the user profile.
 *
 * Godot writes its editor settings, logs, caches and the game's `user://` folder under
 * the profile (`%APPDATA%\Godot` on Windows, the XDG folders on Linux). An agent's
 * checks run in the agent's own CLI process, inside its sandbox, and Codex's
 * workspace-write sandbox cannot write the profile, so every Godot check asked the user
 * for approval (C20, 2026-11-21: about 45 in one session). `chatToolOutputDirs` grants
 * the verification artifact folder to every agent run of the project, so the sandbox can
 * write this one. Godot reads these locations from the environment, nothing else.
 *
 * Exports still find the export templates the user installed (linked, not copied), and
 * the user's editor settings (Android SDK, rcedit and other export paths) are copied in
 * whenever the user's own file is newer than the one Godot last saved here.
 *
 * macOS keeps Godot's defaults: Godot derives them from HOME there, which every other
 * tool the game runs reads too.
 */
export const GODOT_HOME_DIRNAME = 'godot-home';

interface GodotLayout {
  /** Environment variable → folder under the Godot home. */
  vars: Record<string, string>;
  /** Godot's folder name inside the data and config folders. */
  name: string;
  /** Variables, with their default under HOME, that hold export templates and editor settings. */
  data: [variable: string, fallback: string[]];
  config: [variable: string, fallback: string[]];
}

function godotLayout(platform: NodeJS.Platform): GodotLayout | null {
  if (platform === 'win32') return { vars: { APPDATA: 'Roaming', LOCALAPPDATA: 'Local' }, name: 'Godot', data: ['APPDATA', []], config: ['APPDATA', []] };
  if (platform === 'darwin') return null;
  return { vars: { XDG_DATA_HOME: 'data', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache' }, name: 'godot',
    data: ['XDG_DATA_HOME', ['.local', 'share']], config: ['XDG_CONFIG_HOME', ['.config']] };
}

/** Windows names are case-insensitive: `Appdata` and `APPDATA` are one variable. */
function envLookup(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(candidate => candidate.toUpperCase() === name.toUpperCase());
  const value = key === undefined ? undefined : env[key]?.trim();
  return value ? value : undefined;
}

function userFolder(env: NodeJS.ProcessEnv, [variable, fallback]: [string, string[]]): string | null {
  const configured = envLookup(env, variable);
  if (configured) return configured;
  const home = envLookup(env, 'HOME');
  return fallback.length && home ? path.join(home, ...fallback) : null;
}

async function isDirectory(file: string): Promise<boolean> {
  try { return (await stat(file)).isDirectory(); } catch { return false; }
}

/** Point the home's templates folder at the user's, replacing the empty one Godot makes on a first run. */
async function linkExportTemplates(source: string, target: string): Promise<void> {
  if (path.resolve(source) === path.resolve(target) || !await isDirectory(source)) return;
  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink() || !existing.isDirectory() || (await readdir(target)).length) return;
    await rmdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  // A junction needs no privilege on Windows; reads go to the user's own folder.
  await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
}

async function copyNewerEditorSettings(source: string, target: string): Promise<void> {
  if (path.resolve(source) === path.resolve(target)) return;
  let names: string[];
  try { names = (await readdir(source)).filter(name => /^editor_settings-[\d.]+\.tres$/i.test(name)); } catch { return; }
  for (const name of names) {
    const from = path.join(source, name), to = path.join(target, name);
    const theirs = await stat(from);
    if (!theirs.isFile()) continue;
    const ours = await stat(to).catch(() => null);
    if (ours && ours.mtimeMs >= theirs.mtimeMs) continue;
    await mkdir(target, { recursive: true });
    await copyFile(from, to);
  }
}

/**
 * Environment additions that give a Godot process its own folders under `artifactDir`.
 * Empty when the platform keeps Godot's defaults or the folder cannot be made; Godot
 * then writes where it always does and the check still runs.
 */
export async function godotHomeEnv(artifactDir: string,
  { platform = process.platform, env = process.env }: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}): Promise<Record<string, string>> {
  const layout = godotLayout(platform);
  if (!layout) return {};
  const home = path.join(artifactDir, GODOT_HOME_DIRNAME);
  const additions = Object.fromEntries(Object.entries(layout.vars).map(([name, folder]) => [name, path.join(home, folder)]));
  try {
    for (const folder of Object.values(additions)) await mkdir(folder, { recursive: true });
  } catch { return {}; }
  const ours = (variable: string) => path.join(additions[variable]!, layout.name);
  const userData = userFolder(env, layout.data), userConfig = userFolder(env, layout.config);
  // Best effort: without them a check still runs, and only an export may miss its templates or settings.
  if (userData) await linkExportTemplates(path.join(userData, layout.name, 'export_templates'), path.join(ours(layout.data[0]), 'export_templates')).catch(() => {});
  if (userConfig) await copyNewerEditorSettings(path.join(userConfig, layout.name), ours(layout.config[0])).catch(() => {});
  return additions;
}
