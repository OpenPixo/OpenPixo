import { useSyncExternalStore, type CSSProperties } from 'react';

export const RAIL_WIDTH_STORAGE_KEY = 'pixo.entry.railWidth';
export const RAIL_WIDTH_DEFAULT = 244;
export const RAIL_WIDTH_MIN = 200;
export const RAIL_WIDTH_MAX = 400;
export const RAIL_WIDTH_KEYBOARD_STEP = 16;

export function clampRailWidth(width: number): number {
  if (!Number.isFinite(width)) return RAIL_WIDTH_DEFAULT;
  return Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, Math.round(width)));
}

function readStored(): number {
  if (typeof window === 'undefined') return RAIL_WIDTH_DEFAULT;
  try {
    const raw = window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY);
    return raw === null ? RAIL_WIDTH_DEFAULT : clampRailWidth(Number(raw));
  } catch {
    return RAIL_WIDTH_DEFAULT;
  }
}

// One width for both shells: Home and the project page show the same rail, and
// moving between them must not make it jump.
let current: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getRailWidth(): number {
  current ??= readStored();
  return current;
}

/** Commits a width: clamps, remembers it across launches, re-renders the shells. */
export function setRailWidth(width: number): number {
  const next = clampRailWidth(width);
  current = next;
  try {
    if (next === RAIL_WIDTH_DEFAULT) window.localStorage.removeItem(RAIL_WIDTH_STORAGE_KEY);
    else window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(next));
  } catch {
    /* Private mode / disabled storage: the width still applies, it just forgets. */
  }
  for (const listener of listeners) listener();
  return next;
}

export function useRailWidth(): number {
  return useSyncExternalStore(subscribe, getRailWidth, () => RAIL_WIDTH_DEFAULT);
}

/** The custom properties a shell's layout reads to size the rail's grid track. */
export function railWidthProperties(width: number): CSSProperties {
  const value = `${width}px`;
  return { ['--entry-rail-width' as string]: value, ['--shell-sidebar-width' as string]: value };
}

/** Test seam: forget the module's copy so the next read comes from storage. */
export function resetRailWidthForTests(): void {
  current = null;
}
