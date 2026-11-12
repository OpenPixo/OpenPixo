import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@openpixo/components';
import { Icon } from '../Icon';
import styles from './ComposerMenuPicker.module.css';

export interface ComposerMenuOption {
  id: string;
  label: string;
  /** One line under the label saying what picking it does. */
  description?: string;
  /** Small mark before the label (a meter, an icon). */
  leading?: ReactNode;
}

interface Props {
  /** Menu heading, also the trigger's accessible name. */
  label: string;
  /** Line under the heading. */
  hint?: string;
  options: readonly ComposerMenuOption[];
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
  busy?: boolean;
  /** Shown in the chip instead of the selected option (e.g. "not supported"). */
  triggerLabel?: string;
  title?: string;
  testId: string;
}

/**
 * The composer's small setting chips (reasoning effort, approval mode): a flat
 * chip that opens a short menu, one row per choice with a check on the current
 * one, instead of a native select.
 */
export function ComposerMenuPicker({
  label, hint, options, value, onChange, disabled, busy, triggerLabel, title, testId,
}: Props) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.id === value) ?? options[0];

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const gap = 6;
      const width = Math.min(260, window.innerWidth - margin * 2);
      const above = rect.top - margin - gap;
      const below = window.innerHeight - rect.bottom - margin - gap;
      const up = above >= below || above > 240;
      setPosition({
        position: 'fixed',
        width,
        left: Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin),
        top: up ? 'auto' : rect.bottom + gap,
        bottom: up ? window.innerHeight - rect.top + gap : 'auto',
        maxHeight: Math.max(120, up ? above : below),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (selected ?? menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]'))?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      className={styles.menu}
      role="menu"
      aria-label={label}
      data-testid={`${testId}-menu`}
      style={position}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          close();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      <div className={styles.head}>
        <span className={styles.title}>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </div>
      {options.map((option) => {
        const selected = option.id === current?.id;
        return (
          <Button
            key={option.id}
            variant="ghost"
            className={styles.row}
            role="menuitemradio"
            aria-checked={selected}
            data-testid={`${testId}-${option.id}`}
            onClick={() => {
              if (!selected) onChange(option.id);
              close();
            }}
          >
            {option.leading ? <span className={styles.leading} aria-hidden="true">{option.leading}</span> : null}
            <span className={styles.text}>
              <span className={styles.label}>{option.label}</span>
              {option.description ? <span className={styles.description}>{option.description}</span> : null}
            </span>
            {selected ? <Icon name="check" size={14} className={styles.check} /> : null}
          </Button>
        );
      })}
    </div>
  );

  const shown = triggerLabel ?? current?.label ?? '';
  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        className={styles.chip}
        data-testid={testId}
        data-value={current?.id}
        aria-label={`${label} · ${shown}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy || undefined}
        disabled={disabled}
        title={title}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {!triggerLabel && current?.leading ? <span className={styles.leading} aria-hidden="true">{current.leading}</span> : null}
        <span className={styles.value}>{shown}</span>
      </Button>
      {open && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </>
  );
}
