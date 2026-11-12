import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './PanelSheet.module.css';

/**
 * A sheet over the panel body (specs/current/openpixo-game-panel.md §3, §6):
 * project extensions and the asset generator open here instead of as panel
 * sections.
 *
 * Not a modal Dialog on purpose: the sheet's content stays mounted once it has
 * opened, so a generation in progress or a half-filled form survives closing
 * and reopening it (the old sections kept their state the same way). Closed,
 * it is hidden, inert and out of the accessibility tree.
 */
export function PanelSheet({
  open,
  title,
  onClose,
  children,
  testId,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const t = useT();
  const [hasOpened, setHasOpened] = useState(open);
  const rootRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  if (open && !hasOpened) setHasOpened(true);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.toggleAttribute('inert', !open);
    if (open && !root.contains(document.activeElement)) closeRef.current?.focus();
  }, [open, hasOpened]);

  if (!hasOpened) return null;
  return (
    <section
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      aria-hidden={open ? undefined : true}
      className={styles.sheet}
      data-open={open || undefined}
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        <Button
          ref={closeRef}
          size="icon"
          variant="ghost"
          className={styles.close}
          aria-label={t('panel.sheet.close')}
          onClick={onClose}
        >
          <Icon name="close" size={15} />
        </Button>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
