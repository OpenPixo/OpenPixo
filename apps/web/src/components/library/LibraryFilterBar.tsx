import { useEffect, useRef, useState } from 'react';
import { Button, Input, SegmentedTabs } from '@openpixo/components';
import type { Dict } from '../../i18n/types';
import { Icon } from '../Icon';
import { humanBytes, type TranslateFn } from './file-meta';
import {
  LIBRARY_SORTS,
  LIBRARY_TYPE_FILTERS,
  type LibrarySort,
  type LibrarySummary,
  type LibraryTypeFilter,
} from './library-entries';
import styles from './Library.module.css';

const TYPE_LABEL: Record<LibraryTypeFilter, keyof Dict> = {
  all: 'panel.library.type.all',
  image: 'panel.library.type.image',
  audio: 'panel.library.type.audio',
  script: 'panel.library.type.script',
  scene: 'panel.library.type.scene',
  other: 'panel.library.type.other',
};

const SORT_LABEL: Record<LibrarySort, keyof Dict> = {
  name: 'panel.library.sort.name',
  recent: 'panel.library.sort.recent',
  size: 'panel.library.sort.size',
};

/** "3 个文件夹 · 8 个文件 · 520 MB": a zero folder count and an empty size are left out. */
export function librarySummaryText(summary: LibrarySummary, t: TranslateFn): string {
  const parts: string[] = [];
  if (summary.folders > 0) {
    parts.push(t(summary.folders === 1 ? 'panel.library.summary.folder' : 'panel.library.summary.folders', { n: summary.folders }));
  }
  parts.push(t(summary.files === 1 ? 'panel.library.summary.file' : 'panel.library.summary.files', { n: summary.files }));
  if (summary.files > 0) parts.push(humanBytes(summary.bytes));
  return parts.join(' · ');
}

function SortGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden focusable="false" fill="none"
      stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5" />
    </svg>
  );
}

/** The header's sort button: one small menu, the current order checked. */
export function LibrarySortMenu({ sort, t, onChange }: { sort: LibrarySort; t: TranslateFn; onChange: (sort: LibrarySort) => void }) {
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
  const current = t(SORT_LABEL[sort]);
  return (
    <div className={styles.sortAnchor} ref={anchorRef}>
      <Button
        size="sm"
        variant="ghost"
        className={styles.sortButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('panel.library.sort')}: ${current}`}
        title={t('panel.library.sort')}
        data-testid="library-sort"
        onClick={() => setOpen((value) => !value)}
      >
        <SortGlyph />
        <span className={styles.sortLabel}>{current}</span>
      </Button>
      {open ? (
        <div className={styles.sortMenu} role="menu" aria-label={t('panel.library.sort')}>
          {LIBRARY_SORTS.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={value === sort}
              data-testid={`library-sort-${value}`}
              onClick={() => {
                setOpen(false);
                onChange(value);
              }}
            >
              <span className={styles.sortCheck} aria-hidden>{value === sort ? <Icon name="check" size={13} /> : null}</span>
              <span>{t(SORT_LABEL[value])}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The 资源库 header under the toolbar: the folder's name and a muted count
 * line on the left (when the browser passes them), then the type filter
 * (全部 · 图片 · 音频 · 脚本 · 场景 · 其它, with counts), path search and the
 * sort button.
 */
export function LibraryFilterBar({
  type,
  counts,
  query,
  t,
  onTypeChange,
  onQueryChange,
  title,
  summary,
  sort,
  onSortChange,
}: {
  type: LibraryTypeFilter;
  counts: Record<LibraryTypeFilter, number>;
  query: string;
  t: TranslateFn;
  onTypeChange: (type: LibraryTypeFilter) => void;
  onQueryChange: (query: string) => void;
  /** The folder being browsed (or the project's name at the root). */
  title?: string;
  /** What is listed right now; drives the count line under the title. */
  summary?: LibrarySummary;
  sort?: LibrarySort;
  onSortChange?: (sort: LibrarySort) => void;
}) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className={styles.filterBar} data-testid="library-filter-bar">
      {title !== undefined ? (
        <div className={styles.heading}>
          <h2 className={styles.title} title={title} data-testid="library-title">{title}</h2>
          {summary ? (
            <p className={styles.summary} data-testid="library-summary">{librarySummaryText(summary, t)}</p>
          ) : null}
        </div>
      ) : null}
      <div className={styles.controls}>
        <SegmentedTabs
          className={styles.typeTabs}
          label={t('panel.library.type')}
          value={type}
          onValueChange={(next) => onTypeChange(next as LibraryTypeFilter)}
          items={LIBRARY_TYPE_FILTERS.map((value) => ({
            value,
            id: `library-type-${value}`,
            label: t(TYPE_LABEL[value]),
            count: counts[value],
          }))}
        />
        <label className={styles.search}>
          <Icon name="search" size={13} />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={t('gameAssets.search')}
            aria-label={t('gameAssets.search')}
            data-testid="library-search"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              // Esc clears a search first; an empty field lets Esc reach the panel.
              if (event.key !== 'Escape' || !query) return;
              event.preventDefault();
              event.stopPropagation();
              onQueryChange('');
            }}
          />
        </label>
        {sort && onSortChange ? <LibrarySortMenu sort={sort} t={t} onChange={onSortChange} /> : null}
      </div>
    </div>
  );
}
