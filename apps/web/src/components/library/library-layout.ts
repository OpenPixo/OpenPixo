// 资源库 list / grid choice, remembered per project (spec §6: default list,
// grid remembered). Storage can be blocked or throw; the browser then works in
// memory and opens as a list.

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
