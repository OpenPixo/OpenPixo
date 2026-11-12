/**
 * Project files handed to the chat composer from another surface (the File
 * Browser, the asset grid, the image viewer) — by click, context menu or drag.
 *
 * Every surface lands on the same thing: a `ChatAttachment` whose `path` is the
 * project-relative file, which the composer stages as a reference chip and the
 * daemon lists for the agent as an attached project file. Nothing is uploaded
 * again; the file is already in the project.
 *
 * Pure data rules only (no DOM, no fetch) so they can be tested without jsdom.
 */
import type { ChatAttachment, ProjectFile } from '../../types';
import { looksLikeImageName } from './staged-attachment';

/**
 * Window event for staging attachments that are ALREADY in the project
 * (ChatAttachment shape, not File). A composer that takes them calls
 * `preventDefault()` on the event, so the sender can tell "added" from
 * "no chat is open to take it" (`dispatchEvent` returns false when handled).
 */
export const STAGE_ATTACHMENT_EVENT = 'pixo:stage-attachment';
export interface StageAttachmentEventDetail {
  attachments: ChatAttachment[];
}

/** Drag MIME carried by project-file drags. Its payload is JSON, see below. */
export const PROJECT_FILE_DRAG_MIME = 'application/x-openpixo-project-file';

/**
 * Drag payload. `path` is the first file and stays for readers that only know
 * the single-file shape; `paths` carries every dragged file in order.
 */
export interface ProjectFileDragPayload {
  projectId: string;
  path: string;
  paths: string[];
}

export function encodeProjectFileDrag(projectId: string, paths: readonly string[]): string {
  const unique = uniquePaths(paths);
  const payload: ProjectFileDragPayload = { projectId, path: unique[0] ?? '', paths: unique };
  return JSON.stringify(payload);
}

/**
 * Reads a drag payload back. Returns the dragged paths only when the payload
 * belongs to `projectId`; anything malformed, foreign or empty is `[]`, so a
 * stale drag from another project never reaches this composer.
 */
export function decodeProjectFileDrag(raw: string | null | undefined, projectId: string | null | undefined): string[] {
  if (!raw || !projectId) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!value || typeof value !== 'object') return [];
  const payload = value as { projectId?: unknown; path?: unknown; paths?: unknown };
  if (payload.projectId !== projectId) return [];
  const listed = Array.isArray(payload.paths)
    ? payload.paths.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  if (listed.length > 0) return uniquePaths(listed);
  return typeof payload.path === 'string' && payload.path ? [payload.path] : [];
}

/**
 * Maps project paths to the attachments the composer stages. Paths that are
 * not in `files` are dropped: a reference to a file that no longer exists
 * would reach the agent as a dead link. Images keep `kind: 'image'` so the
 * chip shows a thumbnail.
 */
export function projectFileAttachments(paths: readonly string[], files: readonly ProjectFile[]): ChatAttachment[] {
  const byName = new Map<string, ProjectFile>();
  for (const file of files) {
    byName.set(file.name, file);
    if (file.path && !byName.has(file.path)) byName.set(file.path, file);
  }
  const attachments: ChatAttachment[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const file = byName.get(path);
    if (!file || seen.has(file.name)) continue;
    seen.add(file.name);
    attachments.push({
      path: file.name,
      name: file.name.split('/').pop() || file.name,
      kind: file.kind === 'image' || looksLikeImageName(file.name, file.mime) ? 'image' : 'file',
      ...(typeof file.size === 'number' ? { size: file.size } : {}),
    });
  }
  return attachments;
}

/**
 * The files a drag should carry: the whole selection when the dragged file is
 * part of it, otherwise just the dragged file. Mirrors file managers, where
 * dragging one of several selected items moves all of them.
 */
export function dragSelection(dragged: string, selected: ReadonlySet<string> | readonly string[]): string[] {
  const list = Array.isArray(selected) ? selected as readonly string[] : [...selected as ReadonlySet<string>];
  return list.includes(dragged) ? uniquePaths([dragged, ...list.filter(path => path !== dragged)]) : [dragged];
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.filter(path => typeof path === 'string' && path.length > 0))];
}
