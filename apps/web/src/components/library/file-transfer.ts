// Files arriving in 资源库 from outside: pasted from the clipboard or dropped
// from the OS (folders included). Moved out of FilesPanel unchanged.

import { createFileSystemReadError } from '../../utils/fileSystemErrors';

type FileSystemEntryWithReader = FileSystemEntry & {
  createReader?: () => FileSystemDirectoryReader;
};
type FileSystemFileEntryWithFile = FileSystemFileEntry & {
  file: (
    successCallback: (file: File) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
};
type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

export function filesFromClipboardData(clipboardData: DataTransfer | null): File[] {
  const files = Array.from(clipboardData?.files ?? []);
  if (files.length > 0) return files.map((file) => normalizePastedFile(file));
  const items = Array.from(clipboardData?.items ?? []);
  return items
    .filter((item) => item.kind === 'file')
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [normalizePastedFile(file)] : [];
    });
}

/** A pasted screenshot has no name; give it one the project can keep. */
export function normalizePastedFile(file: File, now = new Date()): File {
  if (file.name.trim()) return file;
  const extension = extensionForMimeType(file.type);
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return new File([file], `pasted-${stamp}${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/svg+xml') return '.svg';
  if (mimeType === 'text/html') return '.html';
  if (mimeType === 'text/plain') return '.txt';
  return '';
}

/** A paste into a text field is text editing, not a file upload. */
export function shouldIgnoreClipboardFilePaste(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[contenteditable="true"]')) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

/** Whether a drag carries OS files (not a project-file drag from a row). */
export function dragCarriesFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes('Files') || Boolean(dataTransfer.files?.length);
}

export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const fallbackFiles = Array.from(dataTransfer.files ?? []);
  if (items.length === 0) return fallbackFiles;

  const results = await Promise.allSettled(items.map(filesFromDataTransferItem));
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) {
    if (fallbackFiles.length > 0) return fallbackFiles;
    throw rejected.reason;
  }
  const files = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  return files.length > 0 ? files : fallbackFiles;
}

async function filesFromDataTransferItem(item: DataTransferItem): Promise<File[]> {
  const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.();
  if (!entry) {
    const file = item.kind === 'file' ? item.getAsFile() : null;
    return file ? [file] : [];
  }
  return filesFromFileSystemEntry(entry);
}

async function filesFromFileSystemEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) return [await fileFromEntry(entry as FileSystemFileEntryWithFile)];
  if (!entry.isDirectory) return [];

  const reader = (entry as FileSystemEntryWithReader).createReader?.();
  if (!reader) return [];

  const files: File[] = [];
  for (;;) {
    const entries = await readEntryBatch(reader);
    if (entries.length === 0) break;
    const nested = await Promise.all(entries.map(filesFromFileSystemEntry));
    files.push(...nested.flat());
  }
  return files;
}

function fileFromEntry(entry: FileSystemFileEntryWithFile): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, (error) => {
      reject(createFileSystemReadError('Could not read dropped file', error));
    });
  });
}

function readEntryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, (error) => {
      reject(createFileSystemReadError('Could not read dropped folder', error));
    });
  });
}
