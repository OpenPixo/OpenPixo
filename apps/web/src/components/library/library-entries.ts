// What the 资源库 browser lists (specs/current/openpixo-game-panel.md §6).
//
// Two listing modes, chosen by the filters rather than by a separate switch:
//
// - Browsing (type 全部, empty search): one directory level — its immediate
//   folders, then the files that live directly in it. Breadcrumbs move
//   between levels.
// - Finding (a type other than 全部, or a search): every matching file in the
//   current directory's whole subtree, flat. 图片 at the project root is the
//   old asset gallery; a search in `art/` searches all of `art/`.
//
// Pure: no React, no storage.

import type { ProjectFile, ProjectFolder } from '../../types';
import { projectFileKind } from '../files/file-kind';

export type LibraryTypeFilter = 'all' | 'image' | 'audio' | 'script' | 'scene' | 'other';
export type LibraryFileType = Exclude<LibraryTypeFilter, 'all'>;

export const LIBRARY_TYPE_FILTERS: readonly LibraryTypeFilter[] = ['all', 'image', 'audio', 'script', 'scene', 'other'];

export function isLibraryTypeFilter(value: unknown): value is LibraryTypeFilter {
  return typeof value === 'string' && (LIBRARY_TYPE_FILTERS as readonly string[]).includes(value);
}

/**
 * Engine scene, prefab and level formats. Checked before the file kind: most
 * of them are text the daemon (or `projectFileKind`) calls `text`, and a scene
 * is what a developer looks for, not "a text file".
 */
export const SCENE_EXTENSIONS: ReadonlySet<string> = new Set([
  // Godot: text / binary scenes and resources.
  'tscn', 'scn', 'escn', 'tres', 'res',
  // Unity scenes and prefabs.
  'unity', 'prefab',
  // Cocos Creator (and other engines that use the plain name).
  'scene', 'fire',
  // Unreal levels.
  'umap',
  // Defold collections.
  'collection',
  // Tiled and LDtk levels (Phaser and most 2D web engines load these).
  'tmx', 'tmj', 'ldtk',
]);

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Config and data files the daemon may report as `code`: they are not what a
 * developer means by 脚本, so they stay under 其它.
 */
export const DATA_EXTENSIONS: ReadonlySet<string> = new Set([
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'xml', 'csv', 'lock',
]);

/** The 资源库 type of a file: the filter it appears under besides 全部. */
export function libraryFileType(file: Pick<ProjectFile, 'name' | 'kind'>): LibraryFileType {
  const extension = fileExtension(file.name);
  if (SCENE_EXTENSIONS.has(extension)) return 'scene';
  if (DATA_EXTENSIONS.has(extension)) return 'other';
  const kind = projectFileKind(file);
  if (kind === 'image') return 'image';
  if (kind === 'audio') return 'audio';
  // A web game's pages are its entry points: they sit with the scripts.
  if (kind === 'code' || kind === 'html') return 'script';
  return 'other';
}

/** Image and audio files carry the asset actions (details, processing). */
export function isMediaFile(file: Pick<ProjectFile, 'name' | 'kind'>): boolean {
  const kind = projectFileKind(file);
  return kind === 'image' || kind === 'audio' || kind === 'video';
}

/**
 * Case-insensitive path search. Every whitespace-separated word must appear
 * somewhere in the path, so `hero walk` finds `art/hero/walk_01.png`.
 */
export function matchesLibraryQuery(path: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = path.replace(/\\/g, '/').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export interface LibraryListing {
  /** Immediate child folder names (browse mode only). */
  dirs: string[];
  files: ProjectFile[];
  /** Files come from the whole subtree, so each one shows its folder. */
  flat: boolean;
}

function dirPrefix(dir: string): string {
  return dir === '' ? '' : `${dir}/`;
}

const byPath = (a: ProjectFile, b: ProjectFile) => a.name.localeCompare(b.name, undefined, { numeric: true });

export function libraryListing({
  files,
  folders,
  currentDir,
  type,
  query,
}: {
  files: readonly ProjectFile[];
  folders?: readonly ProjectFolder[];
  currentDir: string;
  type: LibraryTypeFilter;
  query: string;
}): LibraryListing {
  const prefix = dirPrefix(currentDir);
  const finding = type !== 'all' || query.trim() !== '';
  if (finding) {
    const matches = files.filter((file) => file.name.startsWith(prefix)
      && (type === 'all' || libraryFileType(file) === type)
      && matchesLibraryQuery(file.name.slice(prefix.length), query));
    return { dirs: [], files: matches.sort(byPath), flat: true };
  }
  const dirs = new Set<string>();
  const local: ProjectFile[] = [];
  for (const file of files) {
    if (!file.name.startsWith(prefix)) continue;
    const rest = file.name.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) local.push(file);
    else dirs.add(rest.slice(0, slash));
  }
  // Persisted folders keep empty (user-created or imported) folders visible.
  for (const folder of folders ?? []) {
    if (!folder.path.startsWith(prefix)) continue;
    const rest = folder.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    dirs.add(slash === -1 ? rest : rest.slice(0, slash));
  }
  return {
    dirs: [...dirs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    files: local.sort(byPath),
    flat: false,
  };
}

/** How many files each filter would list under `currentDir` (ignoring search). */
export function libraryTypeCounts(files: readonly ProjectFile[], currentDir: string): Record<LibraryTypeFilter, number> {
  const counts: Record<LibraryTypeFilter, number> = { all: 0, image: 0, audio: 0, script: 0, scene: 0, other: 0 };
  const prefix = dirPrefix(currentDir);
  for (const file of files) {
    if (!file.name.startsWith(prefix)) continue;
    counts.all += 1;
    counts[libraryFileType(file)] += 1;
  }
  return counts;
}

/** Files under every folder, counted once per ancestor: O(files × depth). */
export function descendantFileCounts(files: readonly ProjectFile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.name.split('/');
    let dir = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      dir = dir ? `${dir}/${parts[index]}` : parts[index]!;
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The nearest directory at or above `dir` that still exists: has files under
 * it or is a persisted (possibly empty) folder. Deleting the last file in a
 * folder lands the browser on its parent instead of an empty level.
 */
export function nearestExistingDir(
  dir: string,
  files: readonly ProjectFile[],
  folders?: readonly ProjectFolder[],
): string {
  const exists = (candidate: string) =>
    files.some((file) => file.name.startsWith(`${candidate}/`))
    || (folders ?? []).some((folder) => folder.path === candidate || folder.path.startsWith(`${candidate}/`));
  const parts = dir.split('/').filter(Boolean);
  for (let length = parts.length; length > 0; length -= 1) {
    const candidate = parts.slice(0, length).join('/');
    if (exists(candidate)) return candidate;
  }
  return '';
}

/** `name` relative to `dir`, the label a row shows. */
export function relativeToDir(name: string, dir: string): string {
  return dir !== '' && name.startsWith(`${dir}/`) ? name.slice(dir.length + 1) : name;
}

export function baseName(name: string): string {
  return name.split('/').pop() || name;
}

/** The folder part of `name` relative to `dir`, with a trailing slash, or ''. */
export function folderWithinDir(name: string, dir: string): string {
  const rest = relativeToDir(name, dir);
  const slash = rest.lastIndexOf('/');
  return slash > 0 ? `${rest.slice(0, slash)}/` : '';
}
