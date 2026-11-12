/**
 * Folder names OpenPixo keeps for itself inside a project, at any depth. No
 * project file may live under one, and checkpoints leave them out.
 */
export const RESERVED_PROJECT_FILE_SEGMENTS: ReadonlySet<string> = new Set(['.file-versions', '.live-artifacts']);

export function isReservedProjectFilePath(raw: unknown): boolean {
  const normalized = String(raw ?? '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).some((part) => RESERVED_PROJECT_FILE_SEGMENTS.has(part));
}
