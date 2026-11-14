// Navigation model of the project side panel (specs/current/openpixo-game-panel.md §3).
//
// The panel shows one of three views (生成 is its own page beside 工坊). Each view keeps its own small stack of
// opened items — a file name, a `terminal:<id>` or a `chat:<id>` — and the top
// of the current view's stack replaces that view's body. An empty stack shows
// the view's own root. Switching views never touches a stack, so returning to
// a view returns to whatever it was showing.
//
// An item lives in at most one stack: opening it again from another place
// moves it, so a single viewer instance (one retained iframe, one terminal
// surface) is never claimed by two views at once.

export type PanelView = 'game' | 'changes' | 'library';

export const PANEL_VIEWS: readonly PanelView[] = ['game', 'changes', 'library'];
export const DEFAULT_PANEL_VIEW: PanelView = 'game';

export type PanelStacks = Readonly<Record<PanelView, readonly string[]>>;

export interface PanelNav {
  view: PanelView;
  stacks: PanelStacks;
}

const EMPTY_STACKS: PanelStacks = { game: [], changes: [], library: [] };

export function initialPanelNav(view: PanelView = DEFAULT_PANEL_VIEW): PanelNav {
  return { view, stacks: EMPTY_STACKS };
}

export function isPanelView(value: unknown): value is PanelView {
  return value === 'game' || value === 'changes' || value === 'library';
}

/** The item a view is showing, or null when it shows its own root. */
export function panelTop(nav: PanelNav, view: PanelView = nav.view): string | null {
  const stack = nav.stacks[view];
  return stack.length > 0 ? stack[stack.length - 1]! : null;
}

export function panelItemView(nav: PanelNav, item: string): PanelView | null {
  for (const view of PANEL_VIEWS) {
    if (nav.stacks[view].includes(item)) return view;
  }
  return null;
}

/** Every opened item, in view order then stack order. */
export function panelItems(nav: PanelNav): string[] {
  return PANEL_VIEWS.flatMap((view) => nav.stacks[view]);
}

export function switchPanelView(nav: PanelNav, view: PanelView): PanelNav {
  return nav.view === view ? nav : { ...nav, view };
}

/**
 * Put `item` on top of `view`'s stack, removing it from wherever it was.
 * `activate` also makes `view` the current view. Returns `nav` unchanged when
 * nothing would change, so callers can bail out of a state update.
 */
export function pushPanelItem(
  nav: PanelNav,
  view: PanelView,
  item: string,
  options: { activate?: boolean } = {},
): PanelNav {
  const nextView = options.activate ? view : nav.view;
  if (panelTop(nav, view) === item && panelItemView(nav, item) === view) {
    return nextView === nav.view ? nav : { ...nav, view: nextView };
  }
  const stacks = withoutItems(nav.stacks, (candidate) => candidate === item);
  return {
    view: nextView,
    stacks: { ...stacks, [view]: [...stacks[view], item] },
  };
}

/** Pop the top of `view`'s stack. */
export function popPanelItem(
  nav: PanelNav,
  view: PanelView = nav.view,
): { nav: PanelNav; popped: string | null } {
  const popped = panelTop(nav, view);
  if (popped === null) return { nav, popped };
  return {
    nav: { ...nav, stacks: { ...nav.stacks, [view]: nav.stacks[view].slice(0, -1) } },
    popped,
  };
}

export function removePanelItems(nav: PanelNav, shouldRemove: (item: string) => boolean): PanelNav {
  const stacks = withoutItems(nav.stacks, shouldRemove);
  return stacks === nav.stacks ? nav : { ...nav, stacks };
}

/** Rename an item in place (a file renamed while open keeps its position). */
export function renamePanelItem(nav: PanelNav, from: string, to: string): PanelNav {
  if (from === to || panelItemView(nav, from) === null) return nav;
  const cleared = withoutItems(nav.stacks, (item) => item === to);
  const stacks = Object.fromEntries(
    PANEL_VIEWS.map((view) => [view, cleared[view].map((item) => (item === from ? to : item))]),
  ) as Record<PanelView, string[]>;
  return { ...nav, stacks };
}

/** Swap `from` for `to` in the stack that holds `from` (or push `to` onto `fallback`). */
export function replacePanelItem(
  nav: PanelNav,
  from: string,
  to: string,
  fallback: PanelView,
): PanelNav {
  const view = panelItemView(nav, from);
  if (view === null) return pushPanelItem(nav, fallback, to);
  const cleared = withoutItems(nav.stacks, (item) => item === from || item === to);
  return { ...nav, stacks: { ...cleared, [view]: [...cleared[view], to] } };
}

function withoutItems(stacks: PanelStacks, shouldRemove: (item: string) => boolean): PanelStacks {
  let changed = false;
  const next = {} as Record<PanelView, readonly string[]>;
  for (const view of PANEL_VIEWS) {
    const kept = stacks[view].filter((item) => !shouldRemove(item));
    if (kept.length !== stacks[view].length) changed = true;
    next[view] = kept.length === stacks[view].length ? stacks[view] : kept;
  }
  return changed ? next : stacks;
}

// ---------------------------------------------------------------------------
// 改动 viewer items (spec §5): `diff:<checkpointId>:<path>` shows what one
// run did to one file. Checkpoint ids never contain `:`, so the first `:`
// after the prefix ends the id and the rest is the project-relative path.
// ---------------------------------------------------------------------------

const CHANGE_DIFF_PREFIX = 'diff:';

export function changeDiffItem(checkpointId: string, path: string): string {
  return `${CHANGE_DIFF_PREFIX}${checkpointId}:${path}`;
}

export function parseChangeDiffItem(item: string): { checkpointId: string; path: string } | null {
  if (!item.startsWith(CHANGE_DIFF_PREFIX)) return null;
  const rest = item.slice(CHANGE_DIFF_PREFIX.length);
  const split = rest.indexOf(':');
  if (split <= 0 || split === rest.length - 1) return null;
  return { checkpointId: rest.slice(0, split), path: rest.slice(split + 1) };
}

export function isChangeDiffItem(item: string): boolean {
  return parseChangeDiffItem(item) !== null;
}

/**
 * A conversation's "view changes" request: 改动's own list rather than one item.
 * It travels the same path as a file open, so it reveals a hidden panel too.
 */
export const PANEL_CHANGES_ROOT = 'view:changes';

/** Show `view`'s root: whatever it had opened is put away. */
export function showPanelRoot(nav: PanelNav, view: PanelView): PanelNav {
  return { view, stacks: nav.stacks[view].length ? { ...nav.stacks, [view]: [] } : nav.stacks };
}

/** The view a restored item belongs to when no stack holds it yet. */
export function panelItemHomeView(item: string): PanelView {
  return isChangeDiffItem(item) ? 'changes' : 'library';
}

// ---------------------------------------------------------------------------
// Per-project view persistence.
// ---------------------------------------------------------------------------

export function panelViewStorageKey(projectId: string): string {
  return `pixo:project-panel-view:${projectId}`;
}

/** The section key the old five-section switcher used; replaced by the view key. */
export function legacyWorkspaceTabStorageKey(projectId: string): string {
  return `pixo:project-workspace-tab:${projectId}`;
}

export function readStoredPanelView(projectId: string): PanelView {
  try {
    window.localStorage.removeItem(legacyWorkspaceTabStorageKey(projectId));
    const saved = window.localStorage.getItem(panelViewStorageKey(projectId));
    if (isPanelView(saved)) return saved;
    // 生成 was a view here until it became one page for every game; its files were in 资源库.
    if (saved === 'generate') return 'library';
  } catch {
    // Storage may be unavailable; the panel still works in memory.
  }
  return DEFAULT_PANEL_VIEW;
}

export function writeStoredPanelView(projectId: string, view: PanelView): void {
  try {
    window.localStorage.setItem(panelViewStorageKey(projectId), view);
  } catch {
    // Storage may be unavailable; the panel still works in memory.
  }
}
