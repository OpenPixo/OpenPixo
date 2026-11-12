import type { WorkspaceContextItem } from '@openpixo/contracts';
import type { Dict } from '../i18n/types';

export function workspaceContextLinkedDir(item: WorkspaceContextItem): string | null {
  if (item.kind !== 'local-code' && item.kind !== 'project') return null;
  const dir = item.absolutePath?.trim();
  return dir || null;
}

export function workspaceContextLinkedDirs(items: WorkspaceContextItem[]): string[] {
  const dirs = items
    .map(workspaceContextLinkedDir)
    .filter((dir): dir is string => Boolean(dir));
  return Array.from(new Set(dirs));
}

// Human label for a workspace context kind; used by the chip hover card.
export function workspaceContextKindLabel(kind: WorkspaceContextItem['kind'], t: (key: keyof Dict) => string): string {
  switch (kind) {
    case 'browser': return t('chat.context.browser');
    case 'design-files': return t('chat.context.projectFiles');
    case 'folder': return t('chat.context.folder');
    case 'project': return t('chat.context.referencedProject');
    case 'local-code': return t('chat.context.localCode');
    case 'terminal': return t('chat.context.terminal');
    case 'side-chat': return t('chat.context.sideChat');
    case 'file':
    default: return t('chat.context.file');
  }
}

// The single most useful identifier to surface for a context item: the folder
// it points at, else the URL, else the project id / title. Empty when the item
// carries no locator (the hover card then shows only the type).
export function workspaceContextDetailLine(item: WorkspaceContextItem): string {
  return (
    item.absolutePath?.trim() ||
    item.url?.trim() ||
    item.path?.trim() ||
    item.title?.trim() ||
    ''
  );
}
