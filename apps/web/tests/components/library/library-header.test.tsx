// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryFilterBar, librarySummaryText } from '../../../src/components/library/LibraryFilterBar';
import { libraryListing, librarySummary, libraryTitle } from '../../../src/components/library/library-entries';
import { librarySortStorageKey, readLibrarySort, writeLibrarySort } from '../../../src/components/library/library-layout';
import { en } from '../../../src/i18n/locales/en';
import type { Dict } from '../../../src/i18n/types';
import type { ProjectFile } from '../../../src/types';

const t = (key: keyof Dict, vars?: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));

const f = (name: string, size: number, mtime: number): ProjectFile => ({ name, kind: 'binary', size, mtime, mime: '' });

const FILES = [
  f('art/hero.png', 2048, 10),
  f('b.txt', 300, 30),
  f('a.txt', 5000, 20),
  f('c.txt', 300, 5),
];

const COUNTS = { all: 4, image: 0, audio: 0, script: 0, scene: 0, other: 4 };

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('资源库 file order', () => {
  it('keeps folders first by name and orders only the files', () => {
    const byName = libraryListing({ files: FILES, currentDir: '', type: 'all', query: '' });
    expect(byName.dirs).toEqual(['art']);
    expect(byName.files.map((file) => file.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);

    const recent = libraryListing({ files: FILES, currentDir: '', type: 'all', query: '', sort: 'recent' });
    expect(recent.dirs).toEqual(['art']);
    expect(recent.files.map((file) => file.name)).toEqual(['b.txt', 'a.txt', 'c.txt']);

    // Equal sizes fall back to the path, so the order never flickers.
    const size = libraryListing({ files: FILES, currentDir: '', type: 'all', query: '', sort: 'size' });
    expect(size.files.map((file) => file.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('remembers a non-default order per project and survives blocked storage', () => {
    expect(readLibrarySort('p1')).toBe('name');
    writeLibrarySort('p1', 'size');
    expect(readLibrarySort('p1')).toBe('size');
    expect(readLibrarySort('p2')).toBe('name');
    writeLibrarySort('p1', 'name');
    expect(localStorage.getItem(librarySortStorageKey('p1'))).toBeNull();
    localStorage.setItem(librarySortStorageKey('p3'), 'bogus');
    expect(readLibrarySort('p3')).toBe('name');

    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readLibrarySort('p1')).toBe('name');
    spy.mockRestore();
  });
});

describe('资源库 header', () => {
  it('counts only what the listing has', () => {
    const listing = libraryListing({ files: FILES, currentDir: '', type: 'all', query: '' });
    expect(librarySummary(listing)).toEqual({ folders: 1, files: 3, bytes: 5600 });
    expect(librarySummaryText(librarySummary(listing), t)).toBe('1 folder · 3 files · 5.5 KB');
    expect(librarySummaryText({ folders: 0, files: 0, bytes: 0 }, t)).toBe('0 files');
    expect(libraryTitle('', 'my-game')).toBe('my-game');
    expect(libraryTitle('art/hero', 'my-game')).toBe('hero');
  });

  it('shows the title, the count line and a sort menu that reports the pick', () => {
    const onSortChange = vi.fn();
    render(
      <LibraryFilterBar
        type="all"
        counts={COUNTS}
        query=""
        t={t}
        onTypeChange={vi.fn()}
        onQueryChange={vi.fn()}
        title="my-game"
        summary={{ folders: 3, files: 8, bytes: 520 * 1024 * 1024 }}
        sort="name"
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByTestId('library-title').textContent).toBe('my-game');
    expect(screen.getByTestId('library-summary').textContent).toBe('3 folders · 8 files · 520.0 MB');

    fireEvent.click(screen.getByTestId('library-sort'));
    expect(screen.getByRole('menuitemradio', { name: 'Name' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Last changed' }));
    expect(onSortChange).toHaveBeenCalledWith('recent');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the plain filter row when the browser passes no title or sort', () => {
    render(
      <LibraryFilterBar type="all" counts={COUNTS} query="" t={t} onTypeChange={vi.fn()} onQueryChange={vi.fn()} />,
    );
    expect(screen.queryByTestId('library-title')).toBeNull();
    expect(screen.queryByTestId('library-sort')).toBeNull();
    expect(document.getElementById('library-type-other')?.textContent).toContain('4');
  });
});
