/**
 * The right-click menu every surface shares: images and files in chat, the
 * files panel, projects and sessions in the sidebar. Built from a flat list of
 * entries so each surface only says WHAT it offers; placement, focus, the one
 * level of submenu, letter shortcuts and dismissal live here once.
 *
 * Opens at the pointer, clamped inside the window. Esc, Tab, a press outside,
 * scrolling, resizing and the window losing focus all close it. A letter shown
 * at an item's right runs that item while the menu is open.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../Icon';
import { Toast } from '../Toast';
import styles from './ContextMenu.module.css';

export interface ContextMenuAction {
  kind?: 'item';
  id: string;
  label: string;
  icon?: IconName;
  /** One letter, shown at the right; pressing it while the menu is open runs the item. */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuSubmenu {
  kind: 'submenu';
  id: string;
  label: string;
  icon?: IconName;
  items: readonly ContextMenuAction[];
}

export interface ContextMenuSeparator {
  kind: 'separator';
  id: string;
}

export type ContextMenuEntry = ContextMenuAction | ContextMenuSubmenu | ContextMenuSeparator;

export interface ContextMenuState {
  x: number;
  y: number;
  label: string;
  entries: readonly ContextMenuEntry[];
}

const EDGE = 8;

/**
 * Drops separators that would sit first, last or next to another one, so a
 * surface can put a separator between groups without checking which groups
 * ended up empty.
 */
export function tidyContextMenuEntries(entries: readonly ContextMenuEntry[]): ContextMenuEntry[] {
  const out: ContextMenuEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'submenu' && entry.items.length === 0) continue;
    if (entry.kind === 'separator' && (out.length === 0 || out[out.length - 1]!.kind === 'separator')) continue;
    out.push(entry);
  }
  while (out.length > 0 && out[out.length - 1]!.kind === 'separator') out.pop();
  return out;
}

/** Keeps a box of `width` × `height` whose corner is at (x, y) inside the viewport. */
export function clampMenuPosition(x: number, y: number, width: number, height: number,
  viewport: { width: number; height: number }): { left: number; top: number } {
  const left = x + width + EDGE > viewport.width ? Math.max(EDGE, viewport.width - width - EDGE) : Math.max(EDGE, x);
  const top = y + height + EDGE > viewport.height ? Math.max(EDGE, viewport.height - height - EDGE) : Math.max(EDGE, y);
  return { left, top };
}

/**
 * Where a contextmenu event asked for the menu. The keyboard's menu key and
 * Shift+F10 fire it with no pointer position; the menu then opens on the
 * element instead of in the window's corner.
 */
export function contextMenuPoint(event: Pick<ReactMouseEvent, 'clientX' | 'clientY' | 'currentTarget'>): { x: number; y: number } {
  if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY };
  const target = event.currentTarget;
  if (target instanceof Element) {
    const rect = target.getBoundingClientRect();
    return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
  }
  return { x: 0, y: 0 };
}

/**
 * One menu per surface. `openAt` is the `onContextMenu` handler body; render
 * `menu` anywhere (it portals to `<body>`). `notify` shows the short
 * confirmation an item gives ("Copied", "No chat is open") in a toast.
 */
export function useContextMenu(): {
  openAt: (event: ReactMouseEvent, label: string, entries: readonly ContextMenuEntry[]) => void;
  close: () => void;
  notify: (message: string, tone: 'success' | 'error') => void;
  isOpen: boolean;
  menu: ReactElement;
} {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error'; key: number } | null>(null);
  const close = useCallback(() => setState(null), []);
  const notify = useCallback((message: string, tone: 'success' | 'error') => {
    setNotice({ message, tone, key: Date.now() });
  }, []);
  const openAt = useCallback((event: ReactMouseEvent, label: string, entries: readonly ContextMenuEntry[]) => {
    const tidy = tidyContextMenuEntries(entries);
    if (tidy.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = contextMenuPoint(event);
    setState({ ...point, label, entries: tidy });
  }, []);
  const menu = (
    <>
      {state ? <ContextMenu key={`${state.x}:${state.y}:${state.label}`} state={state} onClose={close} /> : null}
      {notice ? (
        <Toast key={notice.key} message={notice.message} tone={notice.tone}
          role={notice.tone === 'error' ? 'alert' : 'status'} ttlMs={2400} portalToBody
          onDismiss={() => setNotice(null)} />
      ) : null}
    </>
  );
  return { openAt, close, notify, isOpen: state !== null, menu };
}

function focusableItems(root: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(root?.querySelectorAll<HTMLButtonElement>(':scope > [role="menuitem"]:not(:disabled)') ?? []);
}

function moveFocus(root: HTMLElement | null, key: string): boolean {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return false;
  const items = focusableItems(root);
  if (items.length === 0) return true;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  let next = 0;
  if (key === 'End') next = items.length - 1;
  else if (key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
  else if (key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
  items[next]!.focus();
  return true;
}

function findShortcut(entries: readonly ContextMenuEntry[], key: string): ContextMenuAction | null {
  const wanted = key.toLowerCase();
  for (const entry of entries) {
    if (entry.kind === 'separator' || entry.kind === 'submenu') continue;
    if (!entry.disabled && entry.shortcut?.toLowerCase() === wanted) return entry;
  }
  return null;
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }): ReactElement | null {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [openSub, setOpenSub] = useState<{ id: string; left: number; top: number; focus: boolean } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    setPosition(clampMenuPosition(state.x, state.y, rect.width, rect.height,
      { width: window.innerWidth, height: window.innerHeight }));
  }, [state.x, state.y]);

  useEffect(() => {
    if (position) focusableItems(rootRef.current)[0]?.focus({ preventScroll: true });
  }, [position !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = useCallback((restoreFocus: boolean) => {
    onClose();
    if (restoreFocus && opener.current instanceof HTMLElement && opener.current.isConnected) {
      opener.current.focus({ preventScroll: true });
    }
  }, [onClose]);

  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (rootRef.current?.contains(target) || subRef.current?.contains(target))) return;
      dismiss(false);
    };
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (rootRef.current?.contains(target) || subRef.current?.contains(target))) return;
      dismiss(false);
    };
    const onBlur = () => dismiss(false);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('contextmenu', outside, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onBlur);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('contextmenu', outside, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onBlur);
      window.removeEventListener('blur', onBlur);
    };
  }, [dismiss]);

  // The submenu's own focus, once it has rendered.
  useEffect(() => {
    if (openSub?.focus) focusableItems(subRef.current)[0]?.focus({ preventScroll: true });
  }, [openSub]);

  // Keep the submenu inside the window: flip to the left of the menu when the
  // right side has no room, and lift it when it would run off the bottom.
  useLayoutEffect(() => {
    const sub = subRef.current;
    const root = rootRef.current;
    if (!openSub || !sub || !root) return;
    const rect = sub.getBoundingClientRect();
    const parent = root.getBoundingClientRect();
    let left = openSub.left;
    if (left + rect.width + EDGE > window.innerWidth) left = Math.max(EDGE, parent.left - rect.width + 2);
    const top = Math.max(EDGE, Math.min(openSub.top, window.innerHeight - rect.height - EDGE));
    if (left !== openSub.left || top !== openSub.top) setOpenSub({ ...openSub, left, top });
  }, [openSub]);

  const run = (action: ContextMenuAction) => {
    if (action.disabled) return;
    dismiss(false);
    action.onSelect();
  };

  const showSub = (id: string, button: HTMLElement, focus: boolean) => {
    const rect = button.getBoundingClientRect();
    setOpenSub({ id, left: rect.right - 2, top: rect.top - 5, focus });
  };

  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
      return;
    }
    if (event.key === 'Tab') { event.preventDefault(); dismiss(true); return; }
    if (moveFocus(rootRef.current, event.key)) { event.preventDefault(); setOpenSub(null); return; }
    const focused = document.activeElement as HTMLElement | null;
    const subId = focused?.dataset.submenu;
    if (subId && (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      showSub(subId, focused!, true);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const action = findShortcut(state.entries, event.key);
      if (action) { event.preventDefault(); run(action); }
    }
  };

  const onSubKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const id = openSub?.id;
      setOpenSub(null);
      rootRef.current?.querySelector<HTMLElement>(`[data-submenu="${CSS.escape(id ?? '')}"]`)?.focus();
      return;
    }
    if (event.key === 'Tab') { event.preventDefault(); dismiss(true); return; }
    if (moveFocus(subRef.current, event.key)) event.preventDefault();
  };

  const submenu = openSub ? state.entries.find((entry): entry is ContextMenuSubmenu =>
    entry.kind === 'submenu' && entry.id === openSub.id) : undefined;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div
        ref={rootRef}
        role="menu"
        aria-label={state.label}
        className={styles.menu}
        data-testid="context-menu"
        data-ready={position !== null || undefined}
        style={position ?? { left: state.x, top: state.y, visibility: 'hidden' }}
        onKeyDown={onRootKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        {state.entries.map((entry) => {
          if (entry.kind === 'separator') return <div key={entry.id} role="separator" className={styles.separator} />;
          if (entry.kind === 'submenu') {
            const expanded = openSub?.id === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={expanded}
                data-submenu={entry.id}
                data-testid={`context-menu-${entry.id}`}
                className={`${styles.item} ${expanded ? styles.itemOpen : ''}`}
                onPointerEnter={(event) => showSub(entry.id, event.currentTarget, false)}
                onClick={(event) => showSub(entry.id, event.currentTarget, true)}
              >
                <ItemLead icon={entry.icon} />
                <span className={styles.label}>{entry.label}</span>
                <Icon name="chevron-right" size={13} className={styles.chevron} />
              </button>
            );
          }
          return (
            <ActionButton key={entry.id} action={entry} onRun={run}
              onPointerEnter={() => setOpenSub(null)} />
          );
        })}
      </div>
      {submenu && openSub ? (
        <div
          ref={subRef}
          role="menu"
          aria-label={submenu.label}
          className={styles.menu}
          data-testid={`context-menu-${submenu.id}-items`}
          style={{ left: openSub.left, top: openSub.top }}
          onKeyDown={onSubKeyDown}
          onContextMenu={(event) => event.preventDefault()}
        >
          {submenu.items.map((action) => <ActionButton key={action.id} action={action} onRun={run} />)}
        </div>
      ) : null}
    </>,
    document.body,
  );
}

function ItemLead({ icon }: { icon: IconName | undefined }) {
  return icon ? <Icon name={icon} size={14} className={styles.icon} /> : null;
}

function ActionButton({ action, onRun, onPointerEnter }: {
  action: ContextMenuAction;
  onRun: (action: ContextMenuAction) => void;
  onPointerEnter?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={action.disabled}
      data-testid={`context-menu-${action.id}`}
      aria-keyshortcuts={action.shortcut}
      className={`${styles.item} ${action.danger ? styles.danger : ''}`}
      onPointerEnter={onPointerEnter}
      onClick={(event) => {
        event.stopPropagation();
        onRun(action);
      }}
    >
      <ItemLead icon={action.icon} />
      <span className={styles.label}>{action.label}</span>
      {action.shortcut ? <kbd className={styles.shortcut}>{action.shortcut.toUpperCase()}</kbd> : null}
    </button>
  );
}
