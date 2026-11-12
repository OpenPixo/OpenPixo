import type { Dict } from '../../i18n/types';
import type { ProjectFile, ProjectFileKind } from '../../types';

const SOURCE_EXTENSIONS = new Set([
  'gd', 'gdshader', 'cs', 'shader', 'glsl', 'hlsl',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'py', 'lua',
]);

const TEXT_EXTENSIONS = new Set([
  'tscn', 'tres', 'godot', 'cfg', 'import',
  'json', 'yaml', 'yml', 'toml', 'ini', 'ldtk', 'tmx',
  'unity', 'prefab', 'meta', 'asset', 'uproject',
]);

const TEXT_FILENAMES = new Set([
  '.gitignore', '.gitattributes', '.gitmodules', '.editorconfig',
]);

/** Text-based engine files use source viewers while specialized media kinds keep their previews. */
export function projectFileKind(file: Pick<ProjectFile, 'name' | 'kind'>): ProjectFileKind {
  if (file.kind !== 'binary') return file.kind;
  const basename = file.name.split(/[\\/]/).pop()!.toLowerCase();
  const dot = basename.lastIndexOf('.');
  const extension = dot >= 0 ? basename.slice(dot + 1) : '';
  if (SOURCE_EXTENSIONS.has(extension)) return 'code';
  if (TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(basename)) return 'text';
  return file.kind;
}

const KIND_LABEL_KEYS: Record<ProjectFileKind, keyof Dict> = {
  html: 'filesPanel.kindHtml',
  image: 'filesPanel.kindImage',
  video: 'filesPanel.kindVideo',
  model3d: 'filesPanel.kindModel3d',
  audio: 'filesPanel.kindAudio',
  sketch: 'filesPanel.kindSketch',
  text: 'filesPanel.kindText',
  code: 'filesPanel.kindCode',
  pdf: 'filesPanel.kindPdf',
  document: 'filesPanel.kindDocument',
  presentation: 'filesPanel.kindPresentation',
  spreadsheet: 'filesPanel.kindSpreadsheet',
  binary: 'filesPanel.kindBinary',
};

/** File lists, chat artifact cards and workspace filters share one localized kind vocabulary. */
export function projectFileKindLabel(
  kind: ProjectFileKind,
  t: (key: keyof Dict, vars?: Record<string, string | number>) => string,
): string {
  return t(KIND_LABEL_KEYS[kind]);
}
