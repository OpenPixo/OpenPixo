import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useT } from '../../i18n';
import { isFileSystemReadError } from '../../utils/fileSystemErrors';
import {
  dragCarriesFiles,
  filesFromClipboardData,
  filesFromDataTransfer,
  shouldIgnoreClipboardFilePaste,
} from './file-transfer';

/**
 * Files pasted anywhere on the page (outside a text field) upload into the
 * project. Mount only while the browser is on screen: a hidden browser would
 * take pastes meant for another view.
 */
export function useClipboardFileUpload(onUploadFiles: (files: File[]) => void, onBeforeUpload?: () => void): void {
  useEffect(() => {
    const onClipboardPaste = (event: ClipboardEvent) => {
      if (shouldIgnoreClipboardFilePaste(event.target)) return;
      const pasted = filesFromClipboardData(event.clipboardData);
      if (pasted.length === 0) return;
      event.preventDefault();
      onBeforeUpload?.();
      onUploadFiles(pasted);
    };
    window.addEventListener('paste', onClipboardPaste);
    return () => window.removeEventListener('paste', onClipboardPaste);
  }, [onBeforeUpload, onUploadFiles]);
}

/**
 * Drag-to-upload over the browser body. Only OS file drags count: dragging a
 * project file out of a row (towards the chat) must not show the drop overlay.
 * Read-only viewers get neither the overlay nor the upload.
 */
export function useFileDropZone({
  disabled,
  onUploadFiles,
}: {
  disabled: boolean;
  onUploadFiles: (files: File[]) => void;
}) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const depth = useRef(0);

  const handlers = {
    onDragEnter(event: DragEvent<HTMLElement>) {
      if (!dragCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (disabled) return;
      depth.current += 1;
      setDragging(true);
    },
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!dragCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        depth.current = 0;
        setDragging(false);
        return;
      }
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    async onDrop(event: DragEvent<HTMLElement>) {
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (disabled) return;
      setReadError(null);
      try {
        const dropped = await filesFromDataTransfer(event.dataTransfer);
        if (dropped.length > 0) onUploadFiles(dropped);
      } catch (error) {
        if (!isFileSystemReadError(error)) throw error;
        setReadError(t('filesPanel.readDroppedFailed'));
      }
    },
  };

  return { dragging, readError, clearReadError: () => setReadError(null), handlers };
}
