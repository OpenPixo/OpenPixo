import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@openpixo/components';
import { Icon } from '../Icon';
import { RemixIcon } from '../RemixIcon';
import toolbar from '../panel/ViewToolbar.module.css';
import type { TranslateFn } from './file-meta';
import type { LibraryLayout } from './library-layout';
import styles from './Library.module.css';

/** Root crumb, then one crumb per folder; the last one is where the browser is. */
export function LibraryBreadcrumbs({
  currentDir,
  rootLabel,
  t,
  onNavigate,
}: {
  currentDir: string;
  rootLabel: string;
  t: TranslateFn;
  onNavigate: (dir: string) => void;
}) {
  const parts = currentDir.split('/').filter(Boolean);
  return (
    <nav className={`df-breadcrumbs ${styles.crumbs}`} aria-label={t('filesPanel.crumbs')}>
      {parts.length === 0 ? (
        <span className="df-breadcrumb-current" title={rootLabel}>{rootLabel}</span>
      ) : (
        <button type="button" className="df-breadcrumb-btn" title={rootLabel} onClick={() => onNavigate('')}>
          {rootLabel}
        </button>
      )}
      {parts.map((segment, index) => {
        const path = parts.slice(0, index + 1).join('/');
        const last = index === parts.length - 1;
        return (
          <span key={path} className="df-breadcrumb-segment">
            <span className="df-breadcrumb-sep" aria-hidden>/</span>
            {last ? (
              <span className="df-breadcrumb-current" title={path} aria-current="location">{segment}</span>
            ) : (
              <button type="button" className="df-breadcrumb-btn" title={path} onClick={() => onNavigate(path)}>
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function ListGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden focusable="false" fill="currentColor">
      <rect x="2" y="3" width="2" height="2" rx="0.5" />
      <rect x="6" y="3.25" width="8" height="1.5" rx="0.75" />
      <rect x="2" y="7" width="2" height="2" rx="0.5" />
      <rect x="6" y="7.25" width="8" height="1.5" rx="0.75" />
      <rect x="2" y="11" width="2" height="2" rx="0.5" />
      <rect x="6" y="11.25" width="8" height="1.5" rx="0.75" />
    </svg>
  );
}

export function LibraryLayoutToggle({
  layout,
  t,
  onChange,
}: {
  layout: LibraryLayout;
  t: TranslateFn;
  onChange: (layout: LibraryLayout) => void;
}) {
  return (
    <div className={styles.layoutToggle} role="group" aria-label={t('panel.library.layout')} data-testid="library-layout-toggle">
      <Button
        size="icon"
        variant="ghost"
        aria-pressed={layout === 'list'}
        aria-label={t('panel.library.list')}
        title={t('panel.library.list')}
        data-testid="library-layout-list"
        onClick={() => onChange('list')}
      >
        <ListGlyph />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-pressed={layout === 'grid'}
        aria-label={t('panel.library.grid')}
        title={t('panel.library.grid')}
        data-testid="library-layout-grid"
        onClick={() => onChange('grid')}
      >
        <RemixIcon name="layout-grid-line" size={14} />
      </Button>
    </div>
  );
}

/**
 * The browser's own ⋯: Upload, New document, Duplicate project. Upload and
 * New document stay here once the project has files (the empty state's
 * buttons vanish with the first file).
 */
export function LibraryProjectMenu({
  t,
  duplicateBusy,
  onUpload,
  onNewDocument,
  onDuplicateProject,
}: {
  t: TranslateFn;
  duplicateBusy: boolean;
  onUpload: () => void;
  onNewDocument: () => void;
  onDuplicateProject?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && anchorRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Closing this menu is the whole effect of Esc; the panel stack stays.
      event.stopPropagation();
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);
  const item = (key: string, icon: Parameters<typeof Icon>[0]['name'], label: string, run: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      data-testid={key}
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      <Icon name={icon} size={13} />
      <span>{label}</span>
    </button>
  );
  return (
    <div className={`df-actions ${styles.projectMenu}`}>
      <div className="df-project-menu-anchor" ref={anchorRef}>
        <Button
          size="icon"
          variant="ghost"
          className="df-project-menu-trigger"
          aria-label={t('filesPanel.projectMenu')}
          aria-haspopup="menu"
          aria-expanded={open}
          title={t('filesPanel.projectMenu')}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="more-horizontal" size={14} />
        </Button>
        {open ? (
          <div className="df-project-menu" role="menu">
            {item('file-list-menu-upload', 'upload', t('filesPanel.upload.label'), onUpload)}
            {item('file-list-menu-new-document', 'file', t('filesPanel.newDocument'), onNewDocument)}
            {onDuplicateProject
              ? item('file-list-menu-duplicate', duplicateBusy ? 'spinner' : 'copy', t('filesPanel.duplicateProject'), onDuplicateProject, duplicateBusy)
              : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The 36px 资源库 toolbar: where you are on the left, how to look and what to add on the right. */
export function LibraryToolbar({ crumbs, children }: { crumbs: ReactNode; children: ReactNode }) {
  return (
    <div className={`${toolbar.toolbar} ${styles.toolbar}`} data-testid="library-toolbar">
      <div className={styles.toolbarLeft}>{crumbs}</div>
      <span className={toolbar.spacer} />
      {children}
    </div>
  );
}

export function GenerateAssetsButton({ t, onGenerate }: { t: TranslateFn; onGenerate: () => void }) {
  return (
    <Button size="sm" variant="ghost" className={styles.generate} data-testid="panel-library-generate" onClick={onGenerate}>
      <Icon name="sparkles" size={14} />
      <span className={styles.generateLabel}>{t('panel.library.generate')}</span>
    </Button>
  );
}
