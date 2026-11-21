import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectLocationRefusal, ProjectLocationRefusalReason } from '@openpixo/contracts';
import type { ProjectLocationPrefs } from './app-config.js';
import { expandHomePrefix } from './home-expansion.js';
import { isBlocked, isFilesystemRoot } from './linked-dirs.js';
import { isSafeId } from './projects.js';

export const BUILT_IN_PROJECT_LOCATION_ID = 'default';
export const PROJECT_MANIFEST_RELATIVE_PATH = path.join('.pixo', 'project.json');

export interface ProjectLocation extends ProjectLocationPrefs {
  builtIn?: boolean;
}

export interface ProjectManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  skillId?: string | null;
}

export function builtInProjectLocation(projectsDir: string): ProjectLocation {
  return {
    id: BUILT_IN_PROJECT_LOCATION_ID,
    name: 'OpenPixo projects',
    path: projectsDir,
    builtIn: true,
  };
}

export function allProjectLocations(projectsDir: string, external: ProjectLocationPrefs[] | undefined): ProjectLocation[] {
  return [builtInProjectLocation(projectsDir), ...(external ?? [])];
}

export function locationProjectDir(location: ProjectLocation, projectId: string): string {
  if (!isSafeId(projectId)) throw new Error('invalid project id');
  return path.join(location.path, projectId);
}

function assertInsideLocation(locationRoot: string, projectDir: string): void {
  const relative = path.relative(locationRoot, projectDir);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('project directory escapes project location');
  }
}

export async function createLocationProjectDir(location: ProjectLocation, projectId: string): Promise<string> {
  const root = await realpath(location.path);
  const target = locationProjectDir({ ...location, path: root }, projectId);
  await mkdir(target, { recursive: false });
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('project directory must be a real directory');
  const canonical = await realpath(target);
  assertInsideLocation(root, canonical);
  return canonical;
}

export async function canonicalLocationChildDir(location: ProjectLocation, childName: string): Promise<string> {
  const root = await realpath(location.path);
  if (!isSafeId(childName)) throw new Error('invalid project directory name');
  const target = path.join(root, childName);
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('project directory must be a real directory');
  const canonical = await realpath(target);
  assertInsideLocation(root, canonical);
  return canonical;
}

export function manifestPath(projectDir: string): string {
  return path.join(projectDir, PROJECT_MANIFEST_RELATIVE_PATH);
}

export type PreparedProjectLocation =
  | { ok: true; path: string }
  | { ok: false; refusal: ProjectLocationRefusal; message: string };

function systemErrorCode(error: unknown): string | undefined {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code ? code : undefined;
}

function placementRefusal(candidate: string): ProjectLocationRefusalReason | null {
  if (isFilesystemRoot(candidate)) return 'drive-root';
  if (isBlocked(candidate)) return 'system-folder';
  return null;
}

/**
 * Creates the requested folder if it is missing and returns its real path, or
 * says which rule refused it. Every refusal names the folder as the request
 * gave it, so the user sees which entry failed and why instead of one generic
 * line. A drive root or system folder is refused before anything is created
 * there, and again after the real path is known, since a link can lead into one.
 * Overlap with the daemon's own data is the caller's rule; it knows the data root.
 */
export async function prepareProjectLocation(locationPath: string): Promise<PreparedProjectLocation> {
  const requested = locationPath.trim();
  const refuse = (reason: ProjectLocationRefusalReason, message: string, systemCode?: string): PreparedProjectLocation => ({
    ok: false,
    refusal: { reason, path: requested, ...(systemCode ? { systemCode } : {}) },
    message: `${message}: ${requested}`,
  });
  const expanded = expandHomePrefix(requested);
  if (!path.isAbsolute(expanded)) return refuse('not-absolute', 'project location must be an absolute path');
  const resolved = path.resolve(expanded);
  const early = placementRefusal(resolved);
  if (early) return refuse(early, early === 'drive-root' ? 'project location cannot be a drive root' : 'system directory not allowed');
  let canonical: string;
  try {
    await mkdir(resolved, { recursive: true });
    canonical = await realpath(resolved);
  } catch (error) {
    const code = systemErrorCode(error);
    if (code === 'EEXIST' || code === 'ENOTDIR') return refuse('not-a-folder', 'not a directory', code);
    return refuse('not-accessible', `directory is not accessible${code ? ` (${code})` : ''}`, code);
  }
  try {
    if (!(await stat(canonical)).isDirectory()) return refuse('not-a-folder', 'not a directory');
  } catch (error) {
    const code = systemErrorCode(error);
    return refuse('not-accessible', `directory is not accessible${code ? ` (${code})` : ''}`, code);
  }
  const late = placementRefusal(canonical);
  if (late) return refuse(late, late === 'drive-root' ? 'project location cannot be a drive root' : 'system directory not allowed');
  return { ok: true, path: canonical };
}

export async function writeProjectManifest(projectDir: string, manifest: ProjectManifest): Promise<void> {
  const file = manifestPath(projectDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(manifest, null, 2), 'utf8');
}

export async function readProjectManifest(projectDir: string): Promise<ProjectManifest | null> {
  try {
    const raw = await readFile(manifestPath(projectDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.schemaVersion !== 1) return null;
    if (typeof obj.id !== 'string' || !isSafeId(obj.id)) return null;
    if (typeof obj.name !== 'string' || !obj.name.trim()) return null;
    const createdAt = typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : Date.now();
    const updatedAt = typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : createdAt;
    return {
      schemaVersion: 1,
      id: obj.id,
      name: obj.name.trim(),
      createdAt,
      updatedAt,
      skillId: typeof obj.skillId === 'string' ? obj.skillId : null,
    };
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string };
    if (e.code === 'ENOENT' || e.name === 'SyntaxError') return null;
    throw err;
  }
}

export async function scanProjectLocation(location: ProjectLocation): Promise<Array<{ dir: string; manifest: ProjectManifest }>> {
  const entries = await readdir(location.path, { withFileTypes: true });
  const found: Array<{ dir: string; manifest: ProjectManifest }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let dir: string;
    try {
      dir = await canonicalLocationChildDir(location, entry.name);
    } catch {
      continue;
    }
    const manifest = await readProjectManifest(dir);
    if (manifest) found.push({ dir, manifest });
  }
  return found;
}
