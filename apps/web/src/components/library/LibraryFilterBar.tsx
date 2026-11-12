import { useRef } from 'react';
import { Input, SegmentedTabs } from '@openpixo/components';
import type { Dict } from '../../i18n/types';
import { Icon } from '../Icon';
import type { TranslateFn } from './file-meta';
import { LIBRARY_TYPE_FILTERS, type LibraryTypeFilter } from './library-entries';
import styles from './Library.module.css';

const TYPE_LABEL: Record<LibraryTypeFilter, keyof Dict> = {
  all: 'panel.library.type.all',
  image: 'panel.library.type.image',
  audio: 'panel.library.type.audio',
  script: 'panel.library.type.script',
  scene: 'panel.library.type.scene',
  other: 'panel.library.type.other',
};

/** Type filter (全部 · 图片 · 音频 · 脚本 · 场景 · 其它, with counts) and path search. */
export function LibraryFilterBar({
  type,
  counts,
  query,
  t,
  onTypeChange,
  onQueryChange,
}: {
  type: LibraryTypeFilter;
  counts: Record<LibraryTypeFilter, number>;
  query: string;
  t: TranslateFn;
  onTypeChange: (type: LibraryTypeFilter) => void;
  onQueryChange: (query: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className={styles.filterBar} data-testid="library-filter-bar">
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
    </div>
  );
}
