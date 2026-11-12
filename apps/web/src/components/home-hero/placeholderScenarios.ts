import type { ChatSessionMode } from '@openpixo/contracts';

export interface PlaceholderScenario {
  // Stable key (React list key + test selector).
  id: string;
  // The localized text typed into the placeholder AND sent as the project query.
  text: string;
  // Caller-owned starter id forwarded when the user submits the scenario.
  chipId: string;
  // Optional per-turn mode for in-project follow-up scenarios.
  sessionMode?: ChatSessionMode;
}

// ---- Typewriter state machine (pure, so it is unit-testable) --------------

export type TypewriterPhase = 'typing' | 'holding' | 'deleting' | 'pausing';

export interface TypewriterState {
  // Index into the scenario list.
  index: number;
  // Number of visible characters of the current scenario's text.
  charCount: number;
  phase: TypewriterPhase;
}

export interface TypewriterTiming {
  // Per-character delay while typing.
  typeMs: number;
  // Per-character delay while deleting (faster than typing reads as decisive).
  deleteMs: number;
  // Dwell once a line is fully typed.
  holdMs: number;
  // Gap after a line is fully deleted, before the next line starts.
  pauseMs: number;
}

export const DEFAULT_TYPEWRITER_TIMING: TypewriterTiming = {
  typeMs: 42,
  deleteMs: 22,
  holdMs: 1900,
  pauseMs: 320,
};

export function initialTypewriterState(): TypewriterState {
  return { index: 0, charCount: 0, phase: 'typing' };
}

// Advance the machine one step and report how long to wait before applying it.
// `length` is the current scenario's text length; `count` is the scenario
// count (for wraparound). With `reducedMotion`, the per-character animation
// collapses to whole-line swaps held for `holdMs` (the caller renders the full
// text rather than a `slice`).
export function advanceTypewriter(
  state: TypewriterState,
  length: number,
  count: number,
  timing: TypewriterTiming,
  reducedMotion: boolean,
): { state: TypewriterState; delayMs: number } {
  if (count <= 0) return { state, delayMs: timing.holdMs };
  if (reducedMotion) {
    // Hold the current line, then jump straight to the next one.
    return {
      state: { index: (state.index + 1) % count, charCount: length, phase: 'holding' },
      delayMs: timing.holdMs,
    };
  }
  switch (state.phase) {
    case 'typing':
      if (state.charCount < length) {
        return { state: { ...state, charCount: state.charCount + 1 }, delayMs: timing.typeMs };
      }
      return { state: { ...state, phase: 'holding' }, delayMs: timing.holdMs };
    case 'holding':
      return { state: { ...state, phase: 'deleting' }, delayMs: timing.deleteMs };
    case 'deleting':
      if (state.charCount > 0) {
        return { state: { ...state, charCount: state.charCount - 1 }, delayMs: timing.deleteMs };
      }
      return { state: { ...state, phase: 'pausing' }, delayMs: timing.pauseMs };
    case 'pausing':
    default:
      return {
        state: { index: (state.index + 1) % count, charCount: 0, phase: 'typing' },
        delayMs: timing.typeMs,
      };
  }
}
