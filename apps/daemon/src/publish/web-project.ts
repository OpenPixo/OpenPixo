import { statSync } from 'node:fs';
import path from 'node:path';
import type { EngineProfile } from '@openpixo/contracts';

const WEB_ENGINES = new Set<EngineProfile['engine']>(['phaser', 'threejs', 'web-generic']);

const ENGINE_NAMES: Partial<Record<EngineProfile['engine'], string>> = {
  godot: 'Godot', unity: 'Unity', unreal: 'Unreal Engine', 'cocos-creator': 'Cocos Creator', bevy: 'Bevy', 'rpg-maker': 'RPG Maker',
};

/** A plain folder with a root index.html is a web game even though no package.json names an engine. */
export function isWebProject(profile: EngineProfile, projectDir: string): boolean {
  if (WEB_ENGINES.has(profile.engine)) return true;
  if (profile.engine !== 'unknown') return false;
  try { return statSync(path.join(projectDir, 'index.html')).isFile(); }
  catch { return false; }
}

/** The plain refusal shared by publish and rooms; both are for web games only. */
export function unsupportedEngineMessage(profile: EngineProfile, action: string): string {
  const name = ENGINE_NAMES[profile.engine];
  const what = name ? `${name} games` : 'This project';
  return `${what} can't ${action} yet. It only works for web games (Phaser, Three.js or another Vite or static build).`
    + (name ? '' : ' No root index.html or web engine was found here.');
}

/** Folder of the web project relative to the root; nested when detection found it one level down. */
export function webProjectCwd(profile: EngineProfile): string {
  const command = profile.commands.build ?? profile.commands.run ?? profile.commands.check;
  if (command) return command.cwd;
  const manifest = profile.evidence.find(file => file === 'package.json' || file.endsWith('/package.json'));
  return manifest ? path.posix.dirname(manifest) : '.';
}
