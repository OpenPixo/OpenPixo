import { useSyncExternalStore } from 'react';

/**
 * Home's own ways to start, offered to other entry views (the empty My Games
 * list). Home stays mounted behind every entry view and owns the sample and
 * open-folder flows (their busy state, their failure dialog, the project they
 * open), so other views run the same flow through here instead of a copy.
 * Each handler is present only while Home can run it; an absent one means the
 * view must not offer it.
 */
export interface HomeStartActions {
  startSample?: () => void;
  sampleBusy: boolean;
  openFolder?: () => void;
  folderBusy: boolean;
  /** The last open-folder failure, shown next to the button that caused it. */
  folderError: string | null;
}

const NONE: HomeStartActions = { sampleBusy: false, folderBusy: false, folderError: null };
let current: HomeStartActions = NONE;
const listeners = new Set<() => void>();

export function publishHomeStartActions(next: HomeStartActions | null): void {
  current = next ?? NONE;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const read = () => current;

export function useHomeStartActions(): HomeStartActions {
  return useSyncExternalStore(subscribe, read, read);
}
