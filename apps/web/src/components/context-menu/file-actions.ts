/**
 * What a right-click on a project file can do with the computer: put the
 * image on the clipboard, save a copy, hand the file to the chat, copy its
 * name or path, and select it in Explorer. Every surface (chat images, the
 * files a turn changed, the files panel) builds its menu from
 * `projectFileMenuEntries`, so the same file offers the same things wherever
 * it is shown.
 */
import { canRevealHostProjectFile, getOpenPixoHost, revealHostProjectFile } from '@openpixo/host';
import type { Dict } from '../../i18n/types';
import type { ChatAttachment } from '../../types';
import { copyToClipboard } from '../../lib/copy-to-clipboard';
import { STAGE_ATTACHMENT_EVENT, type StageAttachmentEventDetail } from '../../runtime/chat/project-file-reference';
import { looksLikeImageName } from '../../runtime/chat/staged-attachment';
import type { TranslateFn } from '../library/file-meta';
import type { ContextMenuAction, ContextMenuEntry } from './ContextMenu';

export type MenuNotify = (message: string, tone: 'success' | 'error') => void;

/** "Show in Explorer" on Windows, "Show in Finder" on a Mac, "Show in folder" elsewhere. */
export function revealLabelKey(): keyof Dict {
  const platform = getOpenPixoHost()?.client.platform ?? '';
  if (platform === 'win32') return 'contextMenu.showInExplorer';
  if (platform === 'darwin') return 'contextMenu.showInFinder';
  return 'contextMenu.showInFolder';
}

export function fileBaseName(path: string): string {
  return path.split('/').pop() || path;
}

/** Saves through a throwaway anchor; the desktop asks where to save it. */
export function saveFileFromUrl(url: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

type ClipboardItemCtor = new (items: Record<string, Blob | Promise<Blob>>) => ClipboardItem;

/** The clipboard only takes PNG everywhere; anything else is redrawn as one. */
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('PNG encode failed'))), 'image/png');
    });
  } finally {
    bitmap.close?.();
  }
}

/** Puts the image at `url` on the system clipboard as an image, ready to paste anywhere. */
export async function copyImageFromUrl(url: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  const Item = (globalThis as { ClipboardItem?: ClipboardItemCtor }).ClipboardItem;
  if (!clipboard || typeof clipboard.write !== 'function' || !Item) return false;
  try {
    // The promise form keeps the user gesture alive while the file loads.
    const png = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    }).then(asPng);
    await clipboard.write([new Item({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hands project files to the open chat composer as reference chips. True
 * when a composer took them; false when no chat is open to take them.
 */
export function attachProjectFilesToChat(files: ReadonlyArray<{ path: string; size?: number; image?: boolean }>): boolean {
  const attachments: ChatAttachment[] = files.map((file) => ({
    path: file.path,
    name: fileBaseName(file.path),
    kind: file.image ?? looksLikeImageName(file.path) ? 'image' : 'file',
    ...(typeof file.size === 'number' ? { size: file.size } : {}),
  }));
  if (attachments.length === 0) return false;
  const event = new CustomEvent<StageAttachmentEventDetail>(STAGE_ATTACHMENT_EVENT, {
    cancelable: true,
    detail: { attachments },
  });
  return !window.dispatchEvent(event);
}

export interface ProjectFileMenuInput {
  projectId: string;
  /** Project-relative path. */
  path: string;
  /** Where the file's bytes are served (the turn's snapshot or the live file). */
  url: string;
  image: boolean;
  size?: number;
  /** Absolute path on disk, when the daemon reported one. */
  absolutePath?: string | null;
  /** The file no longer exists in the project: only copying its name or path makes sense. */
  deleted?: boolean;
  /** Read-only viewers cannot add to the chat. */
  canAttach?: boolean;
  onOpen?: (() => void) | undefined;
  t: TranslateFn;
  notify: MenuNotify;
}

export function projectFileMenuEntries(input: ProjectFileMenuInput): ContextMenuEntry[] {
  const { t, notify, path } = input;
  const name = fileBaseName(path);
  const copyText = (text: string) => async () => {
    const copied = await copyToClipboard(text);
    notify(t(copied ? 'contextMenu.copied' : 'contextMenu.copyFailed'), copied ? 'success' : 'error');
  };
  const copyItems: ContextMenuAction[] = [
    { id: 'copy-name', label: t('contextMenu.copyName'), onSelect: () => void copyText(name)() },
    { id: 'copy-relative-path', label: t('filesPanel.copyRelativePath'), onSelect: () => void copyText(path)() },
    ...(input.absolutePath
      ? [{ id: 'copy-absolute-path', label: t('filesPanel.copyAbsolutePath'), onSelect: () => void copyText(input.absolutePath!)() }]
      : []),
  ];
  const entries: ContextMenuEntry[] = [];
  if (input.onOpen && !input.deleted) {
    entries.push({ id: 'open', label: t('contextMenu.open'), icon: 'external-link', onSelect: input.onOpen });
    entries.push({ kind: 'separator', id: 'sep-open' });
  }
  if (!input.deleted) {
    if (input.image) {
      entries.push({
        id: 'copy-image',
        label: t('contextMenu.copyImage'),
        icon: 'copy',
        onSelect: () => {
          void copyImageFromUrl(input.url).then((copied) =>
            notify(t(copied ? 'contextMenu.imageCopied' : 'contextMenu.imageCopyFailed'), copied ? 'success' : 'error'));
        },
      });
    }
    entries.push({
      id: 'save',
      label: t(input.image ? 'contextMenu.saveImage' : 'contextMenu.saveFile'),
      icon: 'download',
      onSelect: () => saveFileFromUrl(input.url, name),
    });
    entries.push({ kind: 'separator', id: 'sep-save' });
    if (input.canAttach !== false) {
      entries.push({
        id: 'attach',
        label: t('contextMenu.attach'),
        icon: 'attach',
        onSelect: () => {
          const added = attachProjectFilesToChat([{ path, image: input.image, ...(input.size === undefined ? {} : { size: input.size }) }]);
          notify(added ? t('filesPanel.addedToChat', { n: 1 }) : t('filesPanel.noChatOpen'), added ? 'success' : 'error');
        },
      });
    }
  }
  entries.push({ kind: 'submenu', id: 'copy', label: t('contextMenu.copy'), icon: 'file-text', items: copyItems });
  if (!input.deleted && canRevealHostProjectFile()) {
    entries.push({ kind: 'separator', id: 'sep-reveal' });
    entries.push({
      id: 'reveal',
      label: t(revealLabelKey()),
      icon: 'folder',
      onSelect: () => {
        void revealHostProjectFile(input.projectId, path).then((result) => {
          if (!result.ok) notify(t('contextMenu.revealFailed'), 'error');
        });
      },
    });
  }
  return entries;
}
