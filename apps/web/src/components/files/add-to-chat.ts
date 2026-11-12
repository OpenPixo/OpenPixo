import type { ProjectFile } from '../../types';
import {
  encodeProjectFileDrag,
  PROJECT_FILE_DRAG_MIME,
  projectFileAttachments,
  STAGE_ATTACHMENT_EVENT,
  type StageAttachmentEventDetail,
} from '../../runtime/chat/project-file-reference';

export type AddToChatOutcome =
  /** A chat composer took the files; `count` is how many were sent. */
  | { kind: 'added'; count: number }
  /** Nothing to add (every path was unknown). */
  | { kind: 'empty' }
  /** The files were valid but no composer is open to take them. */
  | { kind: 'no-chat'; count: number };

/**
 * Hands project files to the open chat composer as reference chips. The
 * composer acknowledges by cancelling the event; without one (chat closed,
 * read-only), the caller gets `no-chat` and can say so instead of claiming
 * the files were added.
 */
export function addProjectFilesToChat(paths: readonly string[], files: readonly ProjectFile[]): AddToChatOutcome {
  const attachments = projectFileAttachments(paths, files);
  if (attachments.length === 0) return { kind: 'empty' };
  const event = new CustomEvent<StageAttachmentEventDetail>(STAGE_ATTACHMENT_EVENT, {
    cancelable: true,
    detail: { attachments },
  });
  const handled = !window.dispatchEvent(event);
  return handled ? { kind: 'added', count: attachments.length } : { kind: 'no-chat', count: attachments.length };
}

/** Writes the project-file drag payload the chat composer accepts on drop. */
export function setProjectFileDragData(dataTransfer: DataTransfer, projectId: string, paths: readonly string[]): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(PROJECT_FILE_DRAG_MIME, encodeProjectFileDrag(projectId, paths));
  dataTransfer.setData('text/plain', paths.join('\n'));
}
