import type { GameEngineId } from '@openpixo/contracts';

/** Display names for engine ids; `unknown` has none, and its caller supplies localized copy. */
export const ENGINE_NAMES: Record<GameEngineId, string> = {
  godot: 'Godot', unity: 'Unity', unreal: 'Unreal Engine', phaser: 'Phaser', threejs: 'Three.js',
  'cocos-creator': 'Cocos Creator', bevy: 'Bevy', 'rpg-maker': 'RPG Maker', 'web-generic': 'Web', unknown: '',
};

/** A catalogue engine id as people say it; ids this build does not know are shown as written. */
export function engineName(id: string): string {
  return (ENGINE_NAMES as Record<string, string | undefined>)[id] || id;
}
