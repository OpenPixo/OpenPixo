/**
 * The split between the 游戏 stage and the bottom area (上次验证 / 上次试玩,
 * 调参, 日志). The value is the bottom area's height in CSS pixels; the stage
 * takes the rest. Pure, so the clamp and the keys are tested without layout.
 */

export const GAME_SPLIT_STORAGE_KEY = 'pixo.game.bottomPanelHeight';
/** Height the bottom area opens at, and returns to on double-click or Enter. */
export const GAME_SPLIT_DEFAULT = 280;
/** The bottom area never gets smaller than this while a section is open. */
export const GAME_SPLIT_PANEL_MIN = 120;
/** The stage, with any notices above it, keeps at least this much. */
export const GAME_SPLIT_STAGE_MIN = 160;
export const GAME_SPLIT_KEYBOARD_STEP = 16;
export const GAME_SPLIT_PAGE_STEP = 64;

export interface GameSplitBounds {
  min: number;
  /** Infinity while the container has not been measured (no layout yet). */
  max: number;
}

/**
 * The heights the bottom area may take in a body `available` pixels tall.
 * When the body cannot fit both minimums, the two share it in proportion to
 * their minimums, so neither collapses to nothing and the page never scrolls.
 */
export function gameSplitBounds(available: number): GameSplitBounds {
  if (!Number.isFinite(available) || available <= 0) return { min: GAME_SPLIT_PANEL_MIN, max: Infinity };
  const max = Math.floor(available - GAME_SPLIT_STAGE_MIN);
  if (max >= GAME_SPLIT_PANEL_MIN) return { min: GAME_SPLIT_PANEL_MIN, max };
  const shared = Math.round(available * GAME_SPLIT_PANEL_MIN / (GAME_SPLIT_PANEL_MIN + GAME_SPLIT_STAGE_MIN));
  return { min: shared, max: shared };
}

/** A requested bottom-area height, held inside the bounds of the current body. */
export function clampGameSplit(height: number, available: number): number {
  const { min, max } = gameSplitBounds(available);
  const wanted = Number.isFinite(height) ? height : GAME_SPLIT_DEFAULT;
  return Math.round(Math.min(max, Math.max(min, wanted)));
}

/**
 * The height a key on the focused divider asks for, or null when the key does
 * not move it. Up grows the bottom area (the divider moves up), Down shrinks
 * it; Home and End go to the smallest and largest bottom area; Enter resets.
 */
export function gameSplitForKey(key: string, current: number, available: number): number | null {
  const { min, max } = gameSplitBounds(available);
  const next = key === 'ArrowUp' ? current + GAME_SPLIT_KEYBOARD_STEP
    : key === 'ArrowDown' ? current - GAME_SPLIT_KEYBOARD_STEP
      : key === 'PageUp' ? current + GAME_SPLIT_PAGE_STEP
        : key === 'PageDown' ? current - GAME_SPLIT_PAGE_STEP
          : key === 'Home' ? min
            : key === 'End' && Number.isFinite(max) ? max
              : key === 'Enter' ? GAME_SPLIT_DEFAULT
                : null;
  return next === null ? null : clampGameSplit(next, available);
}

/** The bottom-area height a drag asks for: dragging up (smaller clientY) grows it. */
export function gameSplitForDrag(startHeight: number, startY: number, currentY: number, available: number): number {
  return clampGameSplit(startHeight + startY - currentY, available);
}

/** The remembered height, or null for the default. Storage may be missing or throw. */
export function readGameSplit(): number | null {
  try {
    const raw = window.localStorage.getItem(GAME_SPLIT_STORAGE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= GAME_SPLIT_PANEL_MIN ? Math.round(value) : null;
  } catch {
    return null;
  }
}

/** Remembers a height for this viewer; null (or the default) forgets it. */
export function writeGameSplit(height: number | null): void {
  try {
    if (height === null || height === GAME_SPLIT_DEFAULT) window.localStorage.removeItem(GAME_SPLIT_STORAGE_KEY);
    else window.localStorage.setItem(GAME_SPLIT_STORAGE_KEY, String(Math.round(height)));
  } catch {
    /* Private mode / disabled storage: the split still applies, it just forgets. */
  }
}
