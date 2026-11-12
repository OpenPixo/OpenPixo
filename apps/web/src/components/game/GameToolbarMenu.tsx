import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { Icon } from '../Icon';
import styles from './GameToolbarMenu.module.css';

export interface GameToolbarMenuItem {
  id: string;
  label: string;
  hint?: string;
  /** Draws a hairline above this item. */
  separated?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A dropdown for the 游戏 toolbar (试玩 ▾, the verify options). The toolbar
 * clips its overflow, so the menu is fixed-positioned from its trigger's
 * rectangle, left-aligned and kept inside the viewport. Closes on selection,
 * Esc (claimed, so the panel's own Esc stays put), Tab, a press outside,
 * scroll or resize.
 */
export function GameToolbarMenu({ label, trigger, items, disabled, testId, iconOnly = false, openSignal = 0 }: {
  /** Accessible name of the trigger and the menu. */
  label: string;
  /** Visible trigger content; a chevron is appended. */
  trigger?: ReactNode;
  items: readonly GameToolbarMenuItem[];
  disabled?: boolean;
  testId?: string;
  iconOnly?: boolean;
  /** A new value opens the menu, e.g. from `/playtest` in the composer. */
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const consumedOpenSignal = useRef(openSignal);
  useEffect(() => {
    if (!openSignal || openSignal === consumedOpenSignal.current || disabled) return;
    consumedOpenSignal.current = openSignal;
    // One frame later: the panel may only now be switching to this view, and
    // the menu is placed from the trigger's position.
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [openSignal, disabled]);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = menuRef.current?.offsetWidth ?? 0;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPosition({ top: rect.bottom + 4, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    // Only a scroll that moves the trigger (an ancestor scroller or the
    // document) invalidates the fixed position; the chat log scrolling
    // beside the panel does not.
    const onViewportChange = (event: Event) => {
      if (event.type === 'scroll') {
        const target = event.target === document ? document.documentElement : event.target;
        if (!(target instanceof Node) || !target.contains(triggerRef.current)) return;
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') { close(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
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
        size={iconOnly ? 'icon' : 'sm'}
        variant="secondary"
        className={iconOnly ? styles.iconTrigger : styles.trigger}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        data-testid={testId}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
        <Icon name="chevron-down" size={13} className={styles.chevron} />
      </Button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          className={styles.menu}
          style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              className={styles.item}
              data-separated={item.separated || undefined}
              disabled={item.disabled}
              data-testid={testId ? `${testId}-${item.id}` : undefined}
              onClick={() => { close(false); item.onSelect(); }}
            >
              <span className={styles.label}>{item.label}</span>
              {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
