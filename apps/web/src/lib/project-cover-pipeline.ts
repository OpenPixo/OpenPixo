// Shared cover resolution for the project grid and hover preview.
// HTML files are HEAD-probed before either surface loads the sandboxed preview.

import { projectCoverUrl, selectProjectFileCover, type ProjectCoverOverride } from '../components/project-cover';

import { fetchProjectFiles } from '../providers/registry';
import type { Project } from '../types';


/**
 * Resolves one project's cover decision. Returns:
 * - a cover override when the project has a renderable cover,
 * - `null` as the *authoritative* "this project has no cover" answer
 *   (safe to snapshot until the project version changes), and
 * - `undefined` for transient outcomes (abort, network failure) that must
 *   not be cached or written into state.
 */
export async function resolveProjectCover(
  project: Project,
  signal: AbortSignal,
  freshFiles = false,
): Promise<ProjectCoverOverride | null | undefined> {
  let files: Awaited<ReturnType<typeof fetchProjectFiles>>;
  try {
    files = await fetchProjectFiles(project.id, {
      signal,

      ...(freshFiles ? { fresh: true } : {}),
    });
  } catch {
    return undefined;
  }
  if (signal.aborted) return undefined;
  const cover = selectProjectFileCover(files);
  if (cover?.kind !== 'html') return cover;

  const src = projectCoverUrl(
    project.id,
    cover.name,
    cover.mtime
  );
  const diagnostic = `${project.id}:${cover.name}`;

  try {
    const response = await fetch(src, {
      method: 'HEAD',
      cache: 'no-store',
      signal,
      ...({}),
    });
    if (signal.aborted) return undefined;
    if (response.ok || response.status === 304) return cover;
    console.warn(
      `[project-cover] HTML cover unavailable (${response.status} ${response.statusText}):`,
      diagnostic,
    );
    // The server answered: the cover file is not readable. That decision is
    // cacheable; the card renders its glyph until the project changes.
    return null;
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return undefined;
    console.warn('[project-cover] failed to verify HTML cover:', diagnostic, err);
    return undefined;
  }
}
