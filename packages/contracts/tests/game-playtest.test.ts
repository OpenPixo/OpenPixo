import { describe, expect, it } from 'vitest';
import { parseGamePlaytestRequest, gamePlaytestFps } from '../src/api/game-project.js';

describe('bounded game playtest input', () => {
  it('accepts the documented script and normalizes defaults', () => {
    expect(parseGamePlaytestRequest({ script: [{ wait: 500 }, { key: 'ArrowRight', down: true },
      { key: 'Space', press: true, holdMs: 120 }, { click: [20, 40] }, { capture: 'after-jump' }] }))
      .toMatchObject({ durationMs: 5000, captureIntervalMs: 1000, script: expect.any(Array) });
  });
  // A 30-second playtest used to take a periodic frame every second, up to the 24-frame cap.
  it('spreads about six periodic frames over a longer playtest unless an interval is given', () => {
    expect(parseGamePlaytestRequest({ durationMs: 30_000 }).captureIntervalMs).toBe(5000);
    expect(parseGamePlaytestRequest({ durationMs: 8000 }).captureIntervalMs).toBe(1334);
    expect(parseGamePlaytestRequest({ durationMs: 2000 }).captureIntervalMs).toBe(1000);
    expect(parseGamePlaytestRequest({ durationMs: 30_000, captureIntervalMs: 500 }).captureIntervalMs).toBe(500);
  });
  it.each([
    { durationMs: 30_001 }, { durationMs: -1 }, { durationMs: Infinity },
    { captureIntervalMs: 0 }, { script: [{ wait: 5001 }], durationMs: 5000 },
    { script: [{ key: 'Space', down: true, press: true }] },
    { script: [{ key: 'Space', press: true, holdMs: -1 }] },
    { script: [{ click: [-1, 20] }] }, { script: [{ click: [1280, 20] }] },
    { script: [{ wait: 1, capture: 'mixed' }] }, { script: [{ capture: '../outside' }] },
    { script: Array.from({ length: 129 }, () => ({ wait: 0 })) }, { script: [{ key: 'unknown', down: true }] },
  ])('rejects unsafe or ambiguous input %j', input => {
    expect(() => parseGamePlaytestRequest(input)).toThrow();
  });
  it('accepts mouse move, hold and drag steps and normalizes the drag duration', () => {
    const parsed = parseGamePlaytestRequest({ script: [{ move: [10, 20] }, { mouseDown: [10, 20] }, { move: [30, 40] }, { mouseUp: [30, 40] },
      { drag: { from: [0, 0], to: [1279, 719] } }, { drag: { from: [5, 5], to: [6, 6], durationMs: 0 } }] });
    expect(parsed.script).toEqual([{ move: [10, 20] }, { mouseDown: [10, 20] }, { move: [30, 40] }, { mouseUp: [30, 40] },
      { drag: { from: [0, 0], to: [1279, 719], durationMs: 300 } }, { drag: { from: [5, 5], to: [6, 6], durationMs: 0 } }]);
  });
  it('counts drag durations against the playtest duration', () => {
    expect(() => parseGamePlaytestRequest({ durationMs: 1000, script: [{ drag: { from: [0, 0], to: [9, 9], durationMs: 600 } }, { wait: 400 }] })).not.toThrow();
    expect(() => parseGamePlaytestRequest({ durationMs: 1000, script: [{ drag: { from: [0, 0], to: [9, 9], durationMs: 600 } }, { wait: 401 }] })).toThrow();
  });
  it.each([
    { script: [{ move: [1280, 0] }] }, { script: [{ move: [0, 720] }] }, { script: [{ move: [Number.NaN, 0] }] }, { script: [{ move: [1] }] },
    { script: [{ mouseUp: [1, 1] }] }, { script: [{ mouseDown: [1, 1] }, { mouseDown: [2, 2] }] },
    { script: [{ mouseDown: [1, 1] }, { click: [2, 2] }] }, { script: [{ mouseDown: [1, 1] }, { drag: { from: [1, 1], to: [2, 2] } }] },
    { script: [{ drag: { from: [0, 0] } }] }, { script: [{ drag: { from: [0, 0], to: [-1, 0] } }] },
    { script: [{ drag: { from: [0, 0], to: [1, 1], durationMs: 5001 } }] }, { script: [{ drag: { from: [0, 0], to: [1, 1], durationMs: 1.5 } }] },
    { script: [{ drag: { from: [0, 0], to: [1, 1], button: 'right' } }] }, { script: [{ drag: [[0, 0], [1, 1]] }] },
    { script: [{ move: [1, 1], click: [1, 1] }] },
  ])('rejects malformed or ambiguous pointer input %j', input => {
    expect(() => parseGamePlaytestRequest(input)).toThrow();
  });
  it('carries preset provenance and requires a seed exactly for seeded presets', () => {
    expect(parseGamePlaytestRequest({ preset: 'monkey', seed: 7 })).toMatchObject({ preset: 'monkey', seed: 7 });
    expect(parseGamePlaytestRequest({ preset: 'observe' })).toEqual({ durationMs: 5000, captureIntervalMs: 1000, script: [], preset: 'observe' });
    for (const input of [{ preset: 'monkey' }, { preset: 'random', seed: -1 }, { preset: 'random', seed: 2 ** 32 }, { preset: 'random', seed: '7' },
      { preset: 'observe', seed: 1 }, { seed: 1 }, { preset: 'nope' }]) expect(() => parseGamePlaytestRequest(input)).toThrow();
  });
  it('computes measured fps and refuses invented or empty samples', () => {
    expect(gamePlaytestFps([0, 10, 30, 50])).toEqual({ min: 50, avg: 60, samples: 3 });
    expect(gamePlaytestFps([])).toBeNull();
    expect(gamePlaytestFps([0, NaN, -2])).toBeNull();
  });
});
