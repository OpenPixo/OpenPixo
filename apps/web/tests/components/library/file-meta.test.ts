import { describe, expect, it } from 'vitest';
import { categoryLabel, fileCategory } from '../../../src/components/library/file-meta';
import { libraryFileType } from '../../../src/components/library/library-entries';
import { en } from '../../../src/i18n/locales/en';
import type { ProjectFile, ProjectFileKind } from '../../../src/types';

const f = (name: string, kind: ProjectFileKind): ProjectFile => ({ name, kind, size: 1, mtime: 1, mime: '' });
const t = (key: keyof typeof en) => en[key];

describe('资源库 row subtitles', () => {
  it.each([
    ['scenes/main.tscn', 'text', 'Scene', 'scene'],
    ['Assets/Level.unity', 'binary', 'Scene', 'scene'],
    ['package.json', 'code', 'Data', 'other'],
    ['tsconfig.json', 'code', 'Data', 'other'],
    ['styles/app.css', 'code', 'Stylesheet', 'script'],
  ] as const)('labels %s as %s, matching its %s filter', (name, kind, label, type) => {
    const file = f(name, kind);
    expect(categoryLabel(fileCategory(file), t)).toBe(label);
    expect(libraryFileType(file)).toBe(type);
  });
});
