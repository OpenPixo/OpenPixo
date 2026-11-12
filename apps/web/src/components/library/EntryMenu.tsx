import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { projectFileUrl } from '../../providers/registry';
import type { TranslateFn } from './file-meta';
import styles from './EntryMenu.module.css';

export interface EntryMenuPosition {
  name: string;
  top: number;
  left: number;
}

const MENU_WIDTH = 176;
const MENU_ITEM_HEIGHT = 30;
const MENU_SAFE_PADDING = 8;

export function entryMenuHeight(items: number): number {
  return items * MENU_ITEM_HEIGHT + 8;
}

/** Below the ⋯ trigger when it fits, above it otherwise, clamped to the viewport. */
export function menuPositionForAnchor(name: string, anchor: HTMLElement, items: number): EntryMenuPosition | null {
  const rect = (anchor.closest('.df-row-menu') ?? anchor).getBoundingClientRect();
  const height = entryMenuHeight(items);
  const viewportHeight = window.innerHeight;
  let top: number;
  if (viewportHeight - rect.bottom >= height + MENU_SAFE_PADDING) top = rect.bottom + 4;
  else if (rect.top >= height + MENU_SAFE_PADDING) top = rect.top - height - 4;
  else top = Math.max(MENU_SAFE_PADDING, viewportHeight - height - MENU_SAFE_PADDING);
  return { name, top, left: Math.max(MENU_SAFE_PADDING, rect.right - MENU_WIDTH) };
}

/** At the pointer, for right-click. */
export function menuPositionAtPointer(name: string, x: number, y: number, items: number): EntryMenuPosition {
  const top = Math.min(y, window.innerHeight - entryMenuHeight(items) - MENU_SAFE_PADDING);
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - MENU_SAFE_PADDING);
  return { name, top: Math.max(MENU_SAFE_PADDING, top), left: Math.max(MENU_SAFE_PADDING, left) };
}

export interface EntryMenuActions {
  /** Absent for read-only viewers. */
  addToChat?: { label: string; run: () => void };
  open: () => void;
  /** Image / audio / video: the asset details drawer. */
  details?: () => void;
  /** Images: open the generator with this image as a reference. */
  generateFrom?: () => void;
  /** One image: the image editor. */
  editImage?: () => void;
  rename?: () => void;
  copyRelativePath: () => void;
  /** Absent when the daemon reported no local path for the file. */
  copyAbsolutePath?: () => void;
  delete?: () => void;
}

/** How many rows `actions` renders: positions the menu before it mounts. */
export function entryMenuItemCount(actions: EntryMenuActions): number {
  return [actions.addToChat, actions.open, actions.details, actions.generateFrom, actions.editImage, actions.rename,
    actions.copyRelativePath, true, true, actions.delete].filter(Boolean).length;
}

function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
}

/** Saves through a throwaway anchor: a button inside `<a>` is invalid and two tab stops. */
function saveProjectFile(projectId: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = projectFileUrl(projectId, name);
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * One entry's menu (⋯ or right-click). Read-only viewers get the items that
 * change nothing: open, details, copy paths, download.
 */
export function EntryMenu({
  projectId,
  position,
  actions,
  t,
  onClose,
}: {
  projectId: string;
  position: EntryMenuPosition;
  actions: EntryMenuActions;
  t: TranslateFn;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Captured before the first item takes focus, so Esc can hand it back.
  const opener = useRef(document.activeElement);

  useEffect(() => {
    menuItems(menuRef.current)[0]?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const run = (action: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    onClose();
    action();
  };
  const { name } = position;

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') { onClose(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = menuItems(menuRef.current);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    items[next]!.focus();
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={name}
      data-testid="design-file-menu-popover"
      className={`df-row-popover ${styles.menu}`}
      style={{ top: position.top, left: position.left }}
      onKeyDown={onMenuKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {actions.addToChat ? (
        <button type="button" role="menuitem" data-testid="design-file-menu-add-to-chat" onClick={run(actions.addToChat.run)}>
          {actions.addToChat.label}
        </button>
      ) : null}
      <button type="button" role="menuitem" data-testid="design-file-menu-open" onClick={run(actions.open)}>
        {t('filesPanel.openInTab')}
      </button>
      {actions.details ? (
        <button type="button" role="menuitem" data-testid="design-file-menu-details" onClick={run(actions.details)}>
          {t('gameAssets.details')}
        </button>
      ) : null}
      {actions.generateFrom ? (
        <button type="button" role="menuitem" data-testid="design-file-menu-generate-from" onClick={run(actions.generateFrom)}>
          {t('gameAssets.generateFrom')}
        </button>
      ) : null}
      {actions.editImage ? (
        <button type="button" role="menuitem" data-testid="design-file-menu-edit-image" onClick={run(actions.editImage)}>
          {t('imageEditor.title')}
        </button>
      ) : null}
      {actions.rename ? (
        <button
          type="button"
          role="menuitem"
          onClick={(event) => {
            event.stopPropagation();
            // Rename closes the menu itself, after the field has mounted.
            actions.rename!();
          }}
        >
          {t('common.rename')}
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={run(actions.copyRelativePath)}>
        {t('filesPanel.copyRelativePath')}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!actions.copyAbsolutePath}
        onClick={actions.copyAbsolutePath ? run(actions.copyAbsolutePath) : undefined}
      >
        {t('filesPanel.copyAbsolutePath')}
      </button>
      <button type="button" role="menuitem" onClick={run(() => saveProjectFile(projectId, name))}>
        {t('filesPanel.download')}
      </button>
      {actions.delete ? (
        <button type="button" role="menuitem" className="danger" data-testid={`design-file-delete-${name}`} onClick={run(actions.delete)}>
          {t('filesPanel.delete')}
        </button>
      ) : null}
    </div>
  );
}
