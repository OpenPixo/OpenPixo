import { describe, expect, it } from 'vitest';
import {
  GAME_PLAYTEST_PRESETS, GAME_PLAYTEST_PRESET_IDS, GAME_PLAYTEST_SEEDED_PRESETS, gamePlaytestPreset, gamePlaytestRng,
  parseGamePlaytestRequest, randomGamePlaytestSeed,
} from '../src/api/game-project.js';

describe('game playtest presets', () => {
  it('catalogues every preset id once, in a stable order, with seeded flags matching the contract', () => {
    expect(GAME_PLAYTEST_PRESETS.map(preset => preset.id)).toEqual([...GAME_PLAYTEST_PRESET_IDS]);
    expect(GAME_PLAYTEST_PRESETS.filter(preset => preset.seeded).map(preset => preset.id)).toEqual([...GAME_PLAYTEST_SEEDED_PRESETS]);
  });

  it.each(GAME_PLAYTEST_PRESETS.map(preset => [preset.id, preset] as const))('%s expands into a request the shared validator accepts unchanged', (_id, info) => {
    const request = gamePlaytestPreset(info.id, info.seeded ? { seed: 1234 } : {});
    expect(request.durationMs).toBe(info.durationMs);
    const parsed = parseGamePlaytestRequest(request);
    // Presets emit already-normalized steps, so the daemon's provenance comparison is byte-for-byte.
    expect(JSON.stringify(parsed.script)).toBe(JSON.stringify(request.script));
    expect(parsed).toMatchObject({ preset: info.id, ...(info.seeded ? { seed: 1234 } : {}) });
    if (info.input === 'none') expect(parsed.script).toEqual([]);
    if (info.input === 'mouse') expect(parsed.script.every(step => !('key' in step))).toBe(true);
    if (info.input === 'keyboard') expect(parsed.script.every(step => !('click' in step || 'drag' in step || 'move' in step))).toBe(true);
  });

  it('is deterministic: the same seed reproduces an identical script and different seeds diverge', () => {
    for (const id of GAME_PLAYTEST_SEEDED_PRESETS) {
      expect(gamePlaytestPreset(id, { seed: 42 })).toEqual(gamePlaytestPreset(id, { seed: 42 }));
      expect(gamePlaytestPreset(id, { seed: 42 }).script).not.toEqual(gamePlaytestPreset(id, { seed: 43 }).script);
      for (const seed of [0, 1, 0xffff_ffff, 2_654_435_761]) expect(() => parseGamePlaytestRequest(gamePlaytestPreset(id, { seed }))).not.toThrow();
    }
  });

  it('pins the PRNG sequence so a seed means the same script on every engine and release', () => {
    const rng = gamePlaytestRng(1);
    // Reference mulberry32 output for seed 1.
    expect(Array.from({ length: 3 }, () => Math.round(rng() * 1e9))).toEqual([627073941, 2735721, 527447040]);
    expect(gamePlaytestPreset('random', { seed: 7 }).script.slice(0, 6)).toEqual([
      { key: 'Space', press: true, holdMs: 120 }, { wait: 330 }, { key: 'ArrowLeft', press: true, holdMs: 120 }, { wait: 330 },
      { key: 'ArrowLeft', press: true, holdMs: 120 }, { wait: 330 },
    ]);
  });

  it('mixes keys, clicks and drags in the monkey preset', () => {
    const kinds = new Set(gamePlaytestPreset('monkey', { seed: 99 }).script.map(step => Object.keys(step)[0]));
    expect([...kinds]).toEqual(expect.arrayContaining(['key', 'click', 'drag', 'wait', 'capture']));
  });

  it('requires a valid seed for seeded presets instead of drawing one silently', () => {
    expect(() => gamePlaytestPreset('monkey')).toThrow(/seed/);
    expect(() => gamePlaytestPreset('random', { seed: -1 })).toThrow(/seed/);
    expect(() => gamePlaytestPreset('random', { seed: 1.5 })).toThrow(/seed/);
    expect(gamePlaytestPreset('observe', { seed: 5 })).not.toHaveProperty('seed');
  });

  it('draws fresh seeds inside the unsigned 32-bit range', () => {
    expect(randomGamePlaytestSeed(() => 0)).toBe(0);
    expect(randomGamePlaytestSeed(() => 0.999999999999)).toBe(0xffff_ffff);
    expect(Number.isInteger(randomGamePlaytestSeed())).toBe(true);
  });
});
