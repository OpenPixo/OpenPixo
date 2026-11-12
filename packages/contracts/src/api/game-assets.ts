import type { ProjectFile } from './files.js';
import type { ProjectAssetKind } from './project-assets.js';

export type { ProjectAssetKind } from './project-assets.js';

export const PROJECT_ASSET_KINDS = ['all', 'image', 'audio', 'video', 'other'] as const;

export function projectAssetKind(file: ProjectFile): Exclude<ProjectAssetKind, 'all'> {
  return file.kind === 'image' || file.kind === 'audio' || file.kind === 'video'
    ? file.kind
    : 'other';
}

/** The UI and CLI filter the same live project-file inventory. */
export function filterProjectAssets(
  files: readonly ProjectFile[],
  query = '',
  kind: ProjectAssetKind = 'all',
): ProjectFile[] {
  const needle = query.trim().toLocaleLowerCase();
  return files.filter((file) =>
    file.type !== 'dir'
    && (kind === 'all' || projectAssetKind(file) === kind)
    && (!needle || file.name.toLocaleLowerCase().includes(needle)),
  );
}
