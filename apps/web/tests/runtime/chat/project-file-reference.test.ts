import { describe, expect, it } from 'vitest';
import {
  decodeProjectFileDrag,
  dragSelection,
  encodeProjectFileDrag,
  projectFileAttachments,
} from '../../../src/runtime/chat/project-file-reference';
import type { ProjectFile } from '../../../src/types';

const files: ProjectFile[] = [
  { name: 'art/hero.png', kind: 'image', size: 1024, mtime: 1, mime: 'image/png' },
  { name: 'art/raw/hero', path: 'art/raw/hero', kind: 'binary', size: 9, mtime: 1, mime: 'image/webp' },
  { name: 'src/player.ts', kind: 'code', size: 12, mtime: 1, mime: 'text/typescript' },
];

describe('project file drag payload', () => {
  it('round-trips every dragged path and keeps the single-file `path` field', () => {
    const raw = encodeProjectFileDrag('p1', ['art/hero.png', 'src/player.ts', 'art/hero.png']);
    expect(JSON.parse(raw)).toEqual({ projectId: 'p1', path: 'art/hero.png', paths: ['art/hero.png', 'src/player.ts'] });
    expect(decodeProjectFileDrag(raw, 'p1')).toEqual(['art/hero.png', 'src/player.ts']);
  });

  it('still reads the older single-file payload', () => {
    expect(decodeProjectFileDrag(JSON.stringify({ projectId: 'p1', path: 'art/hero.png' }), 'p1')).toEqual(['art/hero.png']);
  });

  it.each([
    ['malformed JSON', 'not json', 'p1'],
    ['null payload', 'null', 'p1'],
    ['another project', JSON.stringify({ projectId: 'p2', path: 'a.png', paths: ['a.png'] }), 'p1'],
    ['no target project', JSON.stringify({ projectId: 'p1', path: 'a.png' }), null],
    ['non-string paths', JSON.stringify({ projectId: 'p1', path: 7, paths: [7, null] }), 'p1'],
    ['empty data', '', 'p1'],
  ])('ignores %s', (_label, raw, projectId) => {
    expect(decodeProjectFileDrag(raw, projectId)).toEqual([]);
  });
});

describe('project file attachments', () => {
  it('maps known paths to references in order, with images marked for thumbnails', () => {
    expect(projectFileAttachments(['src/player.ts', 'art/hero.png', 'art/raw/hero'], files)).toEqual([
      { path: 'src/player.ts', name: 'player.ts', kind: 'file', size: 12 },
      { path: 'art/hero.png', name: 'hero.png', kind: 'image', size: 1024 },
      // No extension, but the MIME says it is a picture.
      { path: 'art/raw/hero', name: 'hero', kind: 'image', size: 9 },
    ]);
  });

  it('drops unknown and duplicate paths instead of sending dead references', () => {
    expect(projectFileAttachments(['gone.png', 'art/hero.png', 'art/hero.png'], files)).toEqual([
      { path: 'art/hero.png', name: 'hero.png', kind: 'image', size: 1024 },
    ]);
  });
});

describe('drag selection', () => {
  it('drags the whole selection when the dragged file is part of it, dragged file first', () => {
    expect(dragSelection('b', new Set(['a', 'b', 'c']))).toEqual(['b', 'a', 'c']);
  });

  it('drags only the file itself when it is not selected', () => {
    expect(dragSelection('d', ['a', 'b'])).toEqual(['d']);
    expect(dragSelection('d', new Set())).toEqual(['d']);
  });
});
