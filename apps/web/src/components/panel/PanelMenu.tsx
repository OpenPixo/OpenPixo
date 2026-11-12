import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button } from '@openpixo/components';
import { Icon, type IconName } from '../Icon';
import styles from './PanelMenu.module.css';

export interface PanelMenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Shown right-aligned and quiet, e.g. "Ctrl+P". */
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * The panel header's ⋯ menu (specs/current/openpixo-game-panel.md §3): project
 * extensions, terminals, file search and engine settings. A plain anchored
 * menu: it opens under its trigger, right-aligned, and closes on selection,
 * Esc, Tab or a pointer press outside.
 */
export function PanelMenu({ label, items }: { label: string; items: readonly PanelMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      // Claimed here so the panel's own Esc (pop the view stack) stays put.
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const enabled = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    if (enabled.length === 0) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (event.key === 'End') next = enabled.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % enabled.length;
    else if (event.key === 'ArrowUp') next = current < 0 ? enabled.length - 1 : (current - 1 + enabled.length) % enabled.length;
    enabled[next]!.focus();
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <Button
        ref={triggerRef}
        size="icon"
        variant="ghost"
        className={`${styles.trigger} pixo-tooltip`}
        aria-label={label}
        data-tooltip={open ? undefined : label}
        data-tooltip-placement="bottom"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="panel-more-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more-horizontal" size={16} />
      </Button>
      {open ? (
        <div id={menuId} role="menu" aria-label={label} className={styles.menu} onKeyDown={onMenuKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              className={styles.item}
              disabled={item.disabled}
              data-testid={`panel-menu-${item.id}`}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={15} className={styles.icon} /> : null}
              <span className={styles.label}>{item.label}</span>
              {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
