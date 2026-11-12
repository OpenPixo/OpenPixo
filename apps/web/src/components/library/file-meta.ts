// Row / card labels for 资源库 entries: kind subtitle, glyph, size, age.
// Moved out of FilesPanel unchanged except that it is now shared by the list
// rows and the grid cards.

import type { Dict } from '../../i18n/types';
import type { ProjectFile, ProjectFileKind } from '../../types';
import { projectFileKind, projectFileKindLabel } from '../files/file-kind';
import { DATA_EXTENSIONS, SCENE_EXTENSIONS, fileExtension } from './library-entries';

export type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

/**
 * Display-only refinement of ProjectFileKind: the contract lumps all source
 * under `code`; rows label CSS/SCSS/etc. as "Stylesheet". Scenes and data
 * files follow `libraryFileType`, so a row never names a type the filter
 * row files it under differently (a `.tscn` is a scene, not text).
 */
export type FileCategory = ProjectFileKind | 'stylesheet' | 'scene' | 'data';

const STYLESHEET_EXTENSIONS = new Set(['css', 'scss', 'sass', 'less']);

export function fileCategory(file: Pick<ProjectFile, 'name' | 'kind'>): FileCategory {
  const extension = fileExtension(file.name);
  if (SCENE_EXTENSIONS.has(extension)) return 'scene';
  if (DATA_EXTENSIONS.has(extension)) return 'data';
  if (STYLESHEET_EXTENSIONS.has(extension)) return 'stylesheet';
  return projectFileKind(file);
}

/** Singular row subtitle for a category. */
export function categoryLabel(category: FileCategory, t: TranslateFn): string {
  if (category === 'stylesheet') return t('filesPanel.kindStylesheet');
  if (category === 'scene') return t('filesPanel.kindScene');
  if (category === 'data') return t('filesPanel.kindData');
  return projectFileKindLabel(category, t);
}

export function categoryGlyph(category: FileCategory): string {
  switch (category) {
    case 'scene': return '◇';
    case 'data': return '≡';
    case 'stylesheet': return '#';
    case 'html': return '⟨⟩';
    case 'image': return '▣';
    case 'sketch': return '✎';
    case 'text': return '¶';
    case 'code': return '{}';
    case 'pdf': return 'PDF';
    case 'document': return 'DOC';
    case 'presentation': return 'PPT';
    case 'spreadsheet': return 'XLS';
    case 'audio': return '♪';
    case 'video': return '▶';
    default: return '·';
  }
}

export function relativeTime(ts: number, t: TranslateFn, now = Date.now()): string {
  const diff = now - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return t('common.justNow');
  if (diff < hr) return t('common.minutesAgo', { n: Math.floor(diff / min) });
  if (diff < day) return t('common.hoursAgo', { n: Math.floor(diff / hr) });
  if (diff < 7 * day) return t('common.daysAgo', { n: Math.floor(diff / day) });
  if (diff < 30 * day) return t('filesPanel.weeksAgo', { n: Math.floor(diff / (7 * day)) });
  return new Date(ts).toLocaleDateString();
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
