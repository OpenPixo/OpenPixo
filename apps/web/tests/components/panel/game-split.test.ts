// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clampGameSplit,
  GAME_SPLIT_DEFAULT,
  GAME_SPLIT_KEYBOARD_STEP,
  GAME_SPLIT_PANEL_MIN,
  GAME_SPLIT_STAGE_MIN,
  GAME_SPLIT_STORAGE_KEY,
  gameSplitBounds,
  gameSplitForDrag,
  gameSplitForKey,
  readGameSplit,
  writeGameSplit,
} from '../../../src/components/panel/game-split';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('game split bounds', () => {
  it('keeps the stage its minimum and the bottom area at least its own', () => {
    expect(gameSplitBounds(800)).toEqual({ min: GAME_SPLIT_PANEL_MIN, max: 800 - GAME_SPLIT_STAGE_MIN });
    expect(clampGameSplit(10, 800)).toBe(GAME_SPLIT_PANEL_MIN);
    expect(clampGameSplit(9000, 800)).toBe(800 - GAME_SPLIT_STAGE_MIN);
    expect(clampGameSplit(Number.NaN, 800)).toBe(GAME_SPLIT_DEFAULT);
  });

  it('shares a body too short for both minimums instead of overflowing it', () => {
    const { min, max } = gameSplitBounds(200);
    expect(min).toBe(max);
    expect(min).toBeLessThan(200);
    expect(200 - min).toBeLessThan(GAME_SPLIT_STAGE_MIN);
    expect(clampGameSplit(GAME_SPLIT_DEFAULT, 200)).toBe(min);
  });

  it('has no upper limit before the body has been measured', () => {
    expect(gameSplitBounds(0).max).toBe(Infinity);
    expect(clampGameSplit(500, 0)).toBe(500);
    expect(clampGameSplit(50, 0)).toBe(GAME_SPLIT_PANEL_MIN);
  });

  it('re-clamps a remembered height when the window gets smaller', () => {
    expect(clampGameSplit(600, 1000)).toBe(600);
    expect(clampGameSplit(600, 500)).toBe(500 - GAME_SPLIT_STAGE_MIN);
  });
});

describe('game split keys and drag', () => {
  it('moves the divider with the arrows, pages, Home, End and Enter', () => {
    expect(gameSplitForKey('ArrowUp', 280, 800)).toBe(280 + GAME_SPLIT_KEYBOARD_STEP);
    expect(gameSplitForKey('ArrowDown', 280, 800)).toBe(280 - GAME_SPLIT_KEYBOARD_STEP);
    expect(gameSplitForKey('PageUp', 280, 800)).toBeGreaterThan(280 + GAME_SPLIT_KEYBOARD_STEP);
    expect(gameSplitForKey('Home', 280, 800)).toBe(GAME_SPLIT_PANEL_MIN);
    expect(gameSplitForKey('End', 280, 800)).toBe(800 - GAME_SPLIT_STAGE_MIN);
    expect(gameSplitForKey('Enter', 400, 800)).toBe(GAME_SPLIT_DEFAULT);
    expect(gameSplitForKey('ArrowDown', GAME_SPLIT_PANEL_MIN, 800)).toBe(GAME_SPLIT_PANEL_MIN);
    expect(gameSplitForKey('a', 280, 800)).toBeNull();
    expect(gameSplitForKey('End', 280, 0)).toBeNull();
  });

  it('grows the bottom area as the pointer moves up, within the bounds', () => {
    expect(gameSplitForDrag(280, 500, 400, 800)).toBe(380);
    expect(gameSplitForDrag(280, 500, 600, 800)).toBe(180);
    expect(gameSplitForDrag(280, 500, 0, 800)).toBe(800 - GAME_SPLIT_STAGE_MIN);
  });
});

describe('game split storage', () => {
  it('remembers a height and forgets the default', () => {
    expect(readGameSplit()).toBeNull();
    writeGameSplit(360);
    expect(window.localStorage.getItem(GAME_SPLIT_STORAGE_KEY)).toBe('360');
    expect(readGameSplit()).toBe(360);
    writeGameSplit(GAME_SPLIT_DEFAULT);
    expect(window.localStorage.getItem(GAME_SPLIT_STORAGE_KEY)).toBeNull();
    window.localStorage.setItem(GAME_SPLIT_STORAGE_KEY, 'tall');
    expect(readGameSplit()).toBeNull();
  });

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readGameSplit()).toBeNull();
    expect(() => writeGameSplit(360)).not.toThrow();
  });
});
