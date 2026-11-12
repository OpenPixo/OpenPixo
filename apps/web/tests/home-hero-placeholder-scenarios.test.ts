import { describe, expect, it } from 'vitest';
import {
  advanceTypewriter,
  DEFAULT_TYPEWRITER_TIMING,
  initialTypewriterState,
  type TypewriterState,
} from '../src/components/home-hero/placeholderScenarios';

const TIMING = DEFAULT_TYPEWRITER_TIMING;

describe('advanceTypewriter', () => {
  // Run the machine to the next state that satisfies `done`, capping steps so a
  // logic regression fails fast instead of looping forever.
  function runUntil(
    start: TypewriterState,
    length: number,
    count: number,
    done: (s: TypewriterState) => boolean,
  ): TypewriterState {
    let state = start;
    for (let i = 0; i < 10_000; i += 1) {
      ({ state } = advanceTypewriter(state, length, count, TIMING, false));
      if (done(state)) return state;
    }
    throw new Error('advanceTypewriter did not reach the target state');
  }

  it('types one character at a time at the typing cadence', () => {
    const { state, delayMs } = advanceTypewriter(
      { index: 0, charCount: 0, phase: 'typing' },
      10,
      3,
      TIMING,
      false,
    );
    expect(state).toEqual({ index: 0, charCount: 1, phase: 'typing' });
    expect(delayMs).toBe(TIMING.typeMs);
  });

  it('holds once the full line is typed', () => {
    const { state, delayMs } = advanceTypewriter(
      { index: 0, charCount: 10, phase: 'typing' },
      10,
      3,
      TIMING,
      false,
    );
    expect(state.phase).toBe('holding');
    expect(delayMs).toBe(TIMING.holdMs);
  });

  it('cycles type → hold → delete → pause → next index with wraparound', () => {
    const length = 5;
    const count = 2;
    // From a fully typed last scenario, the next typing state must wrap to 0.
    const typed: TypewriterState = { index: 1, charCount: length, phase: 'typing' };
    const next = runUntil(typed, length, count, (s) => s.phase === 'typing' && s.charCount === 0);
    expect(next.index).toBe(0);
    expect(next.phase).toBe('typing');
    expect(next.charCount).toBe(0);
  });

  it('reduced motion advances whole lines and keeps full charCount', () => {
    const { state, delayMs } = advanceTypewriter(
      { index: 0, charCount: 0, phase: 'typing' },
      12,
      3,
      TIMING,
      true,
    );
    expect(state.index).toBe(1);
    expect(state.charCount).toBe(12);
    expect(delayMs).toBe(TIMING.holdMs);
  });

  it('starts empty on the first scenario', () => {
    expect(initialTypewriterState()).toEqual({ index: 0, charCount: 0, phase: 'typing' });
  });
});
