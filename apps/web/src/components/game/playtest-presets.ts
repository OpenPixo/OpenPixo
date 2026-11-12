import { GAME_PLAYTEST_PRESETS, type GamePlaytestPresetId, type GamePlaytestPresetInput } from '@openpixo/contracts';

/** Presets are the shared pure functions in `@openpixo/contracts` — the same ones `pixo game playtest
 * --preset` expands — so the UI, CLI and JSON editor always describe the same bounded script. */
export { GAME_PLAYTEST_PRESETS, gamePlaytestPreset, gamePlaytestPresetInfo, randomGamePlaytestSeed } from '@openpixo/contracts';
export type PlaytestPreset = GamePlaytestPresetId;

/** Localized copy for each preset: a short name and a plain-language purpose for beginners. */
export const PLAYTEST_PRESET_COPY = {
  observe: { name: 'gamePlaytest.preset.observe', purpose: 'gamePlaytest.presetPurpose.observe' },
  runJump: { name: 'gamePlaytest.preset.runJump', purpose: 'gamePlaytest.presetPurpose.runJump' },
  wasd: { name: 'gamePlaytest.preset.wasd', purpose: 'gamePlaytest.presetPurpose.wasd' },
  clickGrid: { name: 'gamePlaytest.preset.clickGrid', purpose: 'gamePlaytest.presetPurpose.clickGrid' },
  drag: { name: 'gamePlaytest.preset.drag', purpose: 'gamePlaytest.presetPurpose.drag' },
  random: { name: 'gamePlaytest.preset.random', purpose: 'gamePlaytest.presetPurpose.random' },
  monkey: { name: 'gamePlaytest.preset.monkey', purpose: 'gamePlaytest.presetPurpose.monkey' },
} as const satisfies Record<GamePlaytestPresetId, { name: string; purpose: string }>;

export const PLAYTEST_INPUT_COPY = {
  none: 'gamePlaytest.input.none', keyboard: 'gamePlaytest.input.keyboard',
  mouse: 'gamePlaytest.input.mouse', mixed: 'gamePlaytest.input.mixed',
} as const satisfies Record<GamePlaytestPresetInput, string>;

export const PLAYTEST_PRESET_IDS: readonly GamePlaytestPresetId[] = GAME_PLAYTEST_PRESETS.map(preset => preset.id);
