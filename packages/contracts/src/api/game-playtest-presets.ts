// Type-only imports keep this module free of a runtime cycle with game-project.ts, which re-exports it.
import type { GamePlaytestPoint, GamePlaytestPresetId, GamePlaytestStep } from './game-project.js';

/** A preset expanded into the same bounded request the JSON editor and CLI `--script` send. */
export interface GamePlaytestPresetRequest {
  preset: GamePlaytestPresetId; seed?: number; durationMs: number; script: GamePlaytestStep[];
}
export type GamePlaytestPresetInput = 'none' | 'keyboard' | 'mouse' | 'mixed';
export interface GamePlaytestPresetInfo {
  id: GamePlaytestPresetId; seeded: boolean; input: GamePlaytestPresetInput; durationMs: number;
  /** Plain English for the CLI catalogue; the web UI uses its own localized copy. */
  summary: string;
}

/** Catalogue order is the order the UI and `--list-presets` show. */
export const GAME_PLAYTEST_PRESETS: readonly GamePlaytestPresetInfo[] = [
  { id: 'observe', seeded: false, input: 'none', durationMs: 5000, summary: 'Watch the game for 5 seconds without pressing anything. Works for every engine.' },
  { id: 'runJump', seeded: false, input: 'keyboard', durationMs: 5000, summary: 'Hold the right arrow and jump with Space. For side-scrolling platformers.' },
  { id: 'wasd', seeded: false, input: 'keyboard', durationMs: 6000, summary: 'Walk in every direction with W, A, S and D. For top-down and WASD action games.' },
  { id: 'clickGrid', seeded: false, input: 'mouse', durationMs: 8000, summary: 'Click every cell of an 8x6 grid across the middle of the screen. For match-3, puzzle and tower-defense games.' },
  { id: 'drag', seeded: false, input: 'mouse', durationMs: 9000, summary: 'Drag neighbouring board cells and drag cards from the bottom edge to the centre. For swap puzzles and card games.' },
  { id: 'random', seeded: true, input: 'keyboard', durationMs: 10_000, summary: 'Press arrow keys and Space in a seeded random order for 10 seconds.' },
  { id: 'monkey', seeded: true, input: 'mixed', durationMs: 15_000, summary: 'Mash keys, clicks and drags in a seeded random mix for 15 seconds to shake out crashes.' },
];

export function gamePlaytestPresetInfo(id: GamePlaytestPresetId): GamePlaytestPresetInfo {
  return GAME_PLAYTEST_PRESETS.find(info => info.id === id)!;
}

/** mulberry32: a tiny, fast, well-distributed 32-bit PRNG. Same seed, same sequence, on every JS engine. */
export function gamePlaytestRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A fresh seed for a new run. Only seed choice is random; the script it produces is not. */
export function randomGamePlaytestSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 4_294_967_296) >>> 0;
}

// Board geometry shared by clickGrid and drag: 8x6 cells of 80px centred in the 1280x720 viewport.
const CELL = 80, BOARD_COLS = 8, BOARD_ROWS = 6, BOARD_X = 360, BOARD_Y = 160;
const cell = (col: number, row: number): GamePlaytestPoint => [BOARD_X + col * CELL, BOARD_Y + row * CELL];

/** Expand a preset. Pure: seeded presets require the seed instead of drawing one themselves. */
export function gamePlaytestPreset(id: GamePlaytestPresetId, options: { seed?: number } = {}): GamePlaytestPresetRequest {
  const info = gamePlaytestPresetInfo(id);
  if (!info) throw new Error('Unknown playtest preset');
  const seed = options.seed;
  if (info.seeded && (seed === undefined || !Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff)) throw new Error('Seeded playtest presets need a seed between 0 and 4294967295');
  const result = (script: GamePlaytestStep[]): GamePlaytestPresetRequest =>
    ({ preset: id, ...(info.seeded ? { seed: seed! } : {}), durationMs: info.durationMs, script });
  switch (id) {
    case 'observe': return result([]);
    case 'runJump': return result([
      { key: 'ArrowRight', down: true }, { wait: 600 }, { key: 'Space', press: true, holdMs: 80 },
      { wait: 900 }, { key: 'Space', press: true, holdMs: 80 }, { wait: 900 }, { key: 'ArrowRight', down: false },
    ]);
    case 'wasd': return result([
      { key: 'd', down: true }, { wait: 900 }, { key: 'd', down: false }, { key: 'Space', press: true, holdMs: 80 }, { wait: 300 },
      { key: 'a', down: true }, { wait: 900 }, { key: 'a', down: false }, { wait: 150 },
      { key: 'w', down: true }, { wait: 600 }, { key: 'w', down: false }, { wait: 150 },
      { key: 's', down: true }, { wait: 600 }, { key: 's', down: false }, { capture: 'wasd-moved' },
      { key: 'w', down: true }, { key: 'd', down: true }, { wait: 600 }, { key: 'w', down: false }, { key: 'd', down: false }, { wait: 400 },
    ]);
    case 'clickGrid': {
      const script: GamePlaytestStep[] = [];
      for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) script.push({ click: cell(col, row) }, { wait: 120 });
        if (row === BOARD_ROWS / 2 - 1) script.push({ capture: 'grid-half' });
      }
      script.push({ capture: 'grid-done' });
      return result(script);
    }
    case 'drag': {
      const swaps: Array<[number, number, number, number]> = [[2, 2, 3, 2], [4, 3, 4, 4], [1, 4, 2, 4], [5, 1, 5, 2], [3, 5, 4, 5], [6, 2, 6, 3]];
      const script: GamePlaytestStep[] = [];
      for (const [c1, r1, c2, r2] of swaps) script.push({ drag: { from: cell(c1, r1), to: cell(c2, r2), durationMs: 300 } }, { wait: 400 });
      script.push({ capture: 'swaps' });
      for (const x of [440, 560, 680, 800]) script.push({ drag: { from: [x, 660], to: [640, 320], durationMs: 300 } }, { wait: 400 });
      script.push({ capture: 'cards' });
      return result(script);
    }
    case 'random': {
      const rng = gamePlaytestRng(seed!), keys = ['ArrowLeft', 'ArrowRight', 'Space'] as const;
      const script: GamePlaytestStep[] = [];
      for (let i = 0; i < 20; i++) {
        script.push({ key: i % 5 === 0 ? 'Space' : keys[Math.floor(rng() * keys.length)]!, press: true, holdMs: 120 }, { wait: 330 });
      }
      return result(script);
    }
    case 'monkey': {
      const rng = gamePlaytestRng(seed!);
      const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
      const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
      // Stay clear of the extreme edges and of Escape/Tab, which commonly pause or leave the game.
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd', 'Space', 'Enter'] as const;
      const point = (): GamePlaytestPoint => [int(64, 1215), int(48, 671)];
      const budgetMs = info.durationMs - 1000, maxActions = 48;
      const script: GamePlaytestStep[] = [];
      let elapsed = 0;
      for (let actions = 0; actions < maxActions;) {
        const roll = rng();
        let step: GamePlaytestStep, cost = 0;
        if (roll < 0.4) { cost = int(60, 240); step = { key: keys[int(0, keys.length - 1)]!, press: true, holdMs: cost }; }
        else if (roll < 0.75) step = { click: point() };
        else if (roll < 0.9) {
          const from = point();
          cost = int(150, 450);
          step = { drag: { from, to: [clamp(from[0] + int(-160, 160), 64, 1215), clamp(from[1] + int(-160, 160), 48, 671)], durationMs: cost } };
        } else step = { move: point() };
        const wait = int(100, 300);
        if (elapsed + cost + wait > budgetMs) break;
        script.push(step, { wait });
        elapsed += cost + wait; actions++;
        if (actions % 12 === 0) script.push({ capture: 'monkey-' + actions });
      }
      return result(script);
    }
  }
}
