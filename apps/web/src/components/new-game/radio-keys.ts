import type { KeyboardEvent } from 'react';

const MOVES: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Arrow keys, Home and End move focus and selection inside a `role="radiogroup"`.
 * Radios folded away (inside an `inert` "More" section) are skipped.
 */
export function onRadioGroupKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const move = MOVES[event.key];
  if (!move && event.key !== 'Home' && event.key !== 'End') return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)'))
    .filter(radio => !radio.closest('[inert]'));
  if (radios.length === 0) return;
  const current = radios.indexOf(document.activeElement as HTMLElement);
  let next = 0;
  if (event.key === 'End') next = radios.length - 1;
  else if (move) next = current < 0 ? 0 : (current + move + radios.length) % radios.length;
  event.preventDefault();
  radios[next]!.focus();
  radios[next]!.click();
}

/** One tab stop per group: the checked radio, or the first when none is checked. */
export function radioTabIndex(checked: boolean, index: number, anyChecked: boolean): 0 | -1 {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
