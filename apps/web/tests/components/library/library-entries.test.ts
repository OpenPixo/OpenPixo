// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  libraryFileType,
  libraryListing,
  libraryTypeCounts,
  matchesLibraryQuery,
  nearestExistingDir,
  SCENE_EXTENSIONS,
} from '../../../src/components/library/library-entries';
import { libraryLayoutStorageKey, readLibraryLayout, writeLibraryLayout } from '../../../src/components/library/library-layout';
import type { ProjectFile, ProjectFileKind } from '../../../src/types';

const f = (name: string, kind: ProjectFileKind = 'binary'): ProjectFile => ({ name, kind, size: 1, mtime: 1, mime: '' });

describe('资源库 type filter mapping', () => {
  it.each([
    ['art/hero.png', 'image', 'image'],
    ['sfx/jump.ogg', 'audio', 'audio'],
    ['scripts/player.gd', 'binary', 'script'],
    ['Assets/Scripts/Player.cs', 'binary', 'script'],
    ['src/main.ts', 'code', 'script'],
    ['index.html', 'html', 'script'],
    ['styles/app.css', 'code', 'script'],
    ['scenes/main.tscn', 'text', 'scene'],
    ['scenes/level.scn', 'binary', 'scene'],
    ['resources/theme.tres', 'text', 'scene'],
    ['Assets/Scenes/Main.unity', 'text', 'scene'],
    ['Assets/Prefabs/Enemy.prefab', 'binary', 'scene'],
    ['assets/game.scene', 'binary', 'scene'],
    ['Content/Maps/Arena.umap', 'binary', 'scene'],
    ['main.collection', 'binary', 'scene'],
    ['levels/world.tmx', 'binary', 'scene'],
    ['levels/world.ldtk', 'text', 'scene'],
    ['README.md', 'text', 'other'],
    ['project.godot', 'text', 'other'],
    ['config.json', 'text', 'other'],
    ['package.json', 'code', 'other'],
    ['settings.yaml', 'code', 'other'],
    ['intro.mp4', 'video', 'other'],
    ['Assets/Scenes/Main.unity.meta', 'text', 'other'],
  ] as const)('%s → %s', (name, kind, type) => {
    expect(libraryFileType(f(name, kind))).toBe(type);
  });

  it('matches scene extensions case-insensitively', () => {
    expect(SCENE_EXTENSIONS.has('tscn')).toBe(true);
    expect(libraryFileType(f('Scenes/MAIN.TSCN', 'text'))).toBe('scene');
  });
});

describe('资源库 search', () => {
  it('needs every word somewhere in the path, ignoring case and separators', () => {
    expect(matchesLibraryQuery('art/Hero/walk_01.png', 'hero walk')).toBe(true);
    expect(matchesLibraryQuery('art\\hero\\walk.png', 'art/hero')).toBe(true);
    expect(matchesLibraryQuery('art/hero/idle.png', 'hero walk')).toBe(false);
    expect(matchesLibraryQuery('anything', '   ')).toBe(true);
  });
});

describe('资源库 listing', () => {
  const files = [
    f('index.html', 'html'),
    f('art/hero.png', 'image'),
    f('art/ui/button.png', 'image'),
    f('scenes/main.tscn', 'text'),
    f('scripts/player.gd'),
  ];

  it('browses one level: folders, then the files directly in it', () => {
    expect(libraryListing({ files, currentDir: '', type: 'all', query: '' })).toEqual({
      dirs: ['art', 'scenes', 'scripts'], files: [files[0]], flat: false,
    });
    const art = libraryListing({ files, currentDir: 'art', type: 'all', query: '' });
    expect(art.dirs).toEqual(['ui']);
    expect(art.files.map((file) => file.name)).toEqual(['art/hero.png']);
  });

  it('keeps empty persisted folders', () => {
    const folders = [{ name: 'audio', path: 'audio', type: 'dir' as const, size: 0 as const, mtime: 1 }];
    expect(libraryListing({ files, folders, currentDir: '', type: 'all', query: '' }).dirs).toContain('audio');
  });

  it('lists a type flat across the current subtree', () => {
    const images = libraryListing({ files, currentDir: '', type: 'image', query: '' });
    expect(images).toEqual({ dirs: [], files: [files[1], files[2]], flat: true });
    expect(libraryListing({ files, currentDir: 'art/ui', type: 'image', query: '' }).files.map((file) => file.name))
      .toEqual(['art/ui/button.png']);
    expect(libraryListing({ files, currentDir: '', type: 'scene', query: '' }).files.map((file) => file.name))
      .toEqual(['scenes/main.tscn']);
  });

  it('searches the subtree relative to the current folder', () => {
    expect(libraryListing({ files, currentDir: '', type: 'all', query: 'button' }).files.map((file) => file.name))
      .toEqual(['art/ui/button.png']);
    // Inside `art`, the folder name itself is not part of what is searched.
    expect(libraryListing({ files, currentDir: 'art', type: 'all', query: 'art' }).files).toEqual([]);
    expect(libraryListing({ files, currentDir: '', type: 'image', query: 'hero' }).files.map((file) => file.name))
      .toEqual(['art/hero.png']);
  });

  it('counts each filter under the current folder', () => {
    expect(libraryTypeCounts(files, '')).toEqual({ all: 5, image: 2, audio: 0, script: 2, scene: 1, other: 0 });
    expect(libraryTypeCounts(files, 'art')).toEqual({ all: 2, image: 2, audio: 0, script: 0, scene: 0, other: 0 });
  });

  it('walks up to the nearest folder that still exists', () => {
    expect(nearestExistingDir('art/ui/icons', files)).toBe('art/ui');
    expect(nearestExistingDir('gone/deeper', files)).toBe('');
  });
});

describe('资源库 list / grid persistence', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('defaults to list, remembers grid per project and forgets it on list', () => {
    expect(readLibraryLayout('a')).toBe('list');
    writeLibraryLayout('a', 'grid');
    expect(localStorage.getItem(libraryLayoutStorageKey('a'))).toBe('grid');
    expect(readLibraryLayout('a')).toBe('grid');
    expect(readLibraryLayout('b')).toBe('list');
    writeLibraryLayout('a', 'list');
    expect(localStorage.getItem(libraryLayoutStorageKey('a'))).toBeNull();
  });

  it('works in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readLibraryLayout('a')).toBe('list');
    expect(() => writeLibraryLayout('a', 'grid')).not.toThrow();
  });
});
