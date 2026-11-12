// Bridge between EntryShell (the owner of the entry nav-rail open state) and
// chrome that lives in a sibling React tree — the pinned Home tab's sidebar
// toggle in WorkspaceTabsBar. Kept in a leaf module so the tabs bar can share
// this contract without importing the whole EntryShell module graph.

// Persisted entry nav-rail open/collapsed state. Only an explicit user toggle
// (the rail's header button, Ctrl/⌘+B, the tabs-bar toggle event) is written;
// outside chrome only reads it to seed the pinned toggle's `aria-expanded`
// before the first state event arrives.
//
// `.v2` on purpose: the previous key (`pixo.entry.railOpen`) was written on
// every mount, so every existing profile carries a 'false' that only records
// the old collapsed default, not a choice. A fresh key lets the rail open by
// default for everyone while still honouring a collapse made from now on.
export const RAIL_OPEN_STORAGE_KEY = 'pixo.entry.railOpen.v2';

// Window event dispatched by chrome outside the entry tree (the pinned Home
// tab's sidebar toggle in WorkspaceTabsBar) to expand/collapse the entry rail.
export const ENTRY_RAIL_TOGGLE_EVENT = 'pixo:entry-rail-toggle';

// Window event dispatched by chrome outside the entry tree (the search button
// that now sits in the chrome row beside the rail toggle) to open the ⌘K
// project search palette, which EntryShell owns.
export const ENTRY_SEARCH_OPEN_EVENT = 'pixo:entry-search-open';

// Window event dispatched by EntryShell whenever the rail open state changes,
// with `detail: { open: boolean }`, so outside chrome can mirror the state
// (the pinned toggle's `aria-expanded`).
export const ENTRY_RAIL_STATE_EVENT = 'pixo:entry-rail-state';

/** The rail is open unless the user has explicitly collapsed it. */
export function readStoredRailOpen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(RAIL_OPEN_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Record an explicit user toggle. Call it from the toggle handlers only —
 * never from an effect that also runs on mount, or a default would be written
 * back as if it were a choice (the bug the `.v2` key exists to undo).
 */
export function writeStoredRailOpen(open: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RAIL_OPEN_STORAGE_KEY, open ? 'true' : 'false');
  } catch {
    /* Private mode / disabled storage: the toggle still works, it just forgets. */
  }
}

// A New game request made outside the entry tree (the project sidebar's New
// game button). The dialog belongs to EntryShell, which is not mounted while a
// project is open, so the request is held here until the next EntryShell mount
// takes it; a mounted shell is also told through the window event.
export const ENTRY_NEW_GAME_EVENT = 'pixo:entry-new-game';

let pendingEntryNewGame = false;

export function requestEntryNewGame(): void {
  pendingEntryNewGame = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ENTRY_NEW_GAME_EVENT));
}

/** Read and clear a held New game request; true at most once per request. */
export function takeEntryNewGameRequest(): boolean {
  const pending = pendingEntryNewGame;
  pendingEntryNewGame = false;
  return pending;
}
