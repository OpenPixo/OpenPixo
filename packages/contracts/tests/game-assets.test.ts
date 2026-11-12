import { describe, expect, it } from 'vitest';
import { filterProjectAssets, projectAssetKind } from '../src/api/game-assets.js';
import type { ProjectFile } from '../src/api/files.js';

const files: [ProjectFile, ProjectFile, ProjectFile, ProjectFile] = [
  { name: 'Sprites/Hero.PNG', kind: 'image', size: 10, mtime: 1, mime: 'image/png' },
  { name: 'Audio/hero.ogg', kind: 'audio', size: 20, mtime: 2, mime: 'audio/ogg' },
  { name: 'Models/hero.blend', kind: 'binary', size: 30, mtime: 3, mime: 'application/octet-stream' },
  { name: 'folder', type: 'dir', kind: 'binary', size: 0, mtime: 4, mime: '' },
];

describe('project asset inventory shared by UI and CLI', () => {
  it('filters case-insensitive relative paths and media types without changing source paths', () => {
    expect(filterProjectAssets(files, '  HERO  ', 'image')).toEqual([files[0]]);
    expect(filterProjectAssets(files, 'hero', 'audio')).toEqual([files[1]]);
    expect(files[0].name).toBe('Sprites/Hero.PNG');
  });

  it('keeps unrecognized game formats discoverable and excludes directories', () => {
    expect(projectAssetKind(files[2])).toBe('other');
    expect(filterProjectAssets(files, '', 'other')).toEqual([files[2]]);
    expect(filterProjectAssets(files)).toHaveLength(3);
    expect(filterProjectAssets(files, 'absent')).toEqual([]);
  });
});
