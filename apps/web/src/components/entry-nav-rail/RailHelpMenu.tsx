// The rail foot's "?" control: one small upward menu for everything that is
// help rather than a destination — keyboard shortcuts plus the support and
// changelog pages on the site, which used to be a separate icon row above the
// identity.

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@openpixo/components';
import { localizedProductPage, PRODUCT_RELEASES_URL, PRODUCT_SUPPORT_URL } from '@openpixo/contracts';
import type { TrackingWorkspacePage } from '@openpixo/contracts/analytics';

import { useAnalytics } from '../../analytics/provider';
import { trackAccountMenuClick } from '../../analytics/events';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';
import { openKeyboardShortcuts } from '../KeyboardShortcutsHelp';
import styles from './RailHelpMenu.module.css';

const externalLinkProps = { target: '_blank', rel: 'noreferrer noopener' } as const;

const LINKS = [
  { href: PRODUCT_SUPPORT_URL, label: 'openpixo.feedback', icon: 'comment', element: 'github_help', testId: 'entry-nav-rail-feedback' },
  { href: PRODUCT_RELEASES_URL, label: 'openpixo.releases', icon: 'external-link', element: 'github', testId: 'entry-nav-rail-releases' },
] as const;

export function RailHelpMenu({ page }: { page: TrackingWorkspacePage }) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Kept mounted (the exit transition needs it), so focus moves in on open and
  // an outside press closes it, the way the account menu beside it behaves.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className={`${styles.trigger} pixo-tooltip`}
        aria-label={t('entry.navHelp')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-tooltip={open ? undefined : t('entry.navHelp')}
        data-testid="entry-nav-help"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="help-circle" size={16} />
      </Button>
      <div
        ref={menuRef}
        id={menuId}
        className={styles.menu}
        role="menu"
        aria-label={t('entry.navHelp')}
        aria-hidden={!open}
        data-open={open}
        data-testid="entry-nav-help-menu"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        <Button
          variant="ghost"
          role="menuitem"
          className={styles.item}
          tabIndex={open ? 0 : -1}
          data-testid="entry-nav-shortcuts"
          onClick={() => {
            close(false);
            openKeyboardShortcuts();
          }}
        >
          <span className={styles.glyph} aria-hidden>?</span>
          <span className={styles.label}>{t('shortcuts.title')}</span>
        </Button>
        <div className={styles.separator} role="separator" />
        {LINKS.map((link) => (
          <a
            key={link.label}
            className={styles.item}
            href={localizedProductPage(link.href, locale)}
            {...externalLinkProps}
            role="menuitem"
            tabIndex={open ? 0 : -1}
            data-testid={link.testId}
            onClick={() => {
              trackAccountMenuClick(analytics.track, {
                page_name: page,
                area: 'account_menu',
                element: link.element,
              });
              close(false);
            }}
          >
            <span className={styles.glyph} aria-hidden><Icon name={link.icon} size={15} /></span>
            <span className={styles.label}>{t(link.label)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
