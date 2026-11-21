// 资源库 list / grid choice, remembered per project (spec §6: default list,
// grid remembered). Storage can be blocked or throw; the browser then works in
// memory and opens as a list.

import { useCallback, useState } from 'react';
import { isLibrarySort, type LibrarySort } from './library-entries';

export type LibraryLayout = 'list' | 'grid';

export function libraryLayoutStorageKey(projectId: string): string {
  return `pixo:library-layout:${projectId}`;
}

export function readLibraryLayout(projectId: string): LibraryLayout {
  try {
    return window.localStorage.getItem(libraryLayoutStorageKey(projectId)) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

export function writeLibraryLayout(projectId: string, layout: LibraryLayout): void {
  try {
    // The default needs no record: a project the user never switched stays unwritten.
    if (layout === 'grid') window.localStorage.setItem(libraryLayoutStorageKey(projectId), 'grid');
    else window.localStorage.removeItem(libraryLayoutStorageKey(projectId));
  } catch {
    // Storage may be unavailable; the choice still holds for this session.
  }
}

// File order, remembered per project the same way: the default (by name)
// needs no record, and blocked storage only loses the memory.

export function librarySortStorageKey(projectId: string): string {
  return `pixo:library-sort:${projectId}`;
}

export function readLibrarySort(projectId: string): LibrarySort {
  try {
    const stored = window.localStorage.getItem(librarySortStorageKey(projectId));
    return isLibrarySort(stored) ? stored : 'name';
  } catch {
    return 'name';
  }
}

export function writeLibrarySort(projectId: string, sort: LibrarySort): void {
  try {
    if (sort === 'name') window.localStorage.removeItem(librarySortStorageKey(projectId));
    else window.localStorage.setItem(librarySortStorageKey(projectId), sort);
  } catch {
    // Storage may be unavailable; the choice still holds for this session.
  }
}

/** The browser's file order and its setter, remembered per project. */
export function useLibrarySort(projectId: string): [LibrarySort, (sort: LibrarySort) => void] {
  const [sort, setSortState] = useState<LibrarySort>(() => readLibrarySort(projectId));
  const setSort = useCallback((next: LibrarySort) => {
    setSortState(next);
    writeLibrarySort(projectId, next);
  }, [projectId]);
  return [sort, setSort];
}
