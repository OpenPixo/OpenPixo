import type { ProjectFile } from '../../types';

/** Prefer the daemon's exact local path, with the resolved project root as fallback. */
export function absoluteProjectFilePath(file: ProjectFile, resolvedDir?: string | null): string | null {
  if (file.localPath) return file.localPath;
  if (!resolvedDir) return null;
  const separator = resolvedDir.includes('\\') ? '\\' : '/';
  const root = resolvedDir.replace(/[\\/]+$/u, '');
  const relative = file.name.replace(/^[\\/]+/u, '').replace(/[\\/]/gu, separator);
  return `${root}${separator}${relative}`;
}
