import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import type { Response } from 'express';
import { isSafeId } from '../projects.js';

export type ProjectMutationCapability = 'rename' | 'delete' | 'duplicate' | 'writeFiles' | 'comment';
export type AuthorizeProjectRequestOptions =
  | { mode: 'read'; allowNavigationQuery?: boolean }
  | { mode: 'write'; capability: ProjectMutationCapability };
export type AuthorizeProjectRequest = (
  req: any, res: Response, projectId: string, options: AuthorizeProjectRequestOptions,
) => Promise<boolean>;
export type AuthorizedProjectToolRequest = { readonly projectId: string };
export type AuthorizeProjectToolRequest = (
  res: Response, projectId: string, options: AuthorizeProjectRequestOptions,
) => Promise<AuthorizedProjectToolRequest | null>;

interface LocalProject {
  metadata?: { baseDir?: string } | null;
}
interface ProjectAccessDependencies<Database> {
  db: Database;
  PROJECTS_DIR: string;
  getProject: (db: Database, projectId: string) => LocalProject | null | undefined;
}

function canonicalPath(target: string): string {
  return existsSync(target) ? realpathSync.native(target) : path.resolve(target);
}
function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** Project storage authority only; route token and origin middleware runs first. */
export async function enforceLocalProjectDataPlaneRequest<Database>(input: ProjectAccessDependencies<Database> & {
  req: any;
  projectId: string;
  options: AuthorizeProjectRequestOptions;
  onDenied?: (status: number, code: string, message: string) => unknown;
}): Promise<boolean> {
  const deny = (status: number, code: string, message: string): false => {
    input.onDenied?.(status, code, message);
    return false;
  };
  if (!isSafeId(input.projectId)) return deny(400, 'BAD_REQUEST', 'invalid project id');
  const project = input.getProject(input.db, input.projectId);
  if (!project) return deny(404, 'PROJECT_NOT_FOUND', 'project not found');
  const importedRoot = project.metadata?.baseDir;
  if (importedRoot !== undefined && (typeof importedRoot !== 'string' || !path.isAbsolute(importedRoot))) {
    return deny(403, 'FORBIDDEN', 'invalid project directory');
  }
  try {
    // Sandbox availability belongs to the existing file-operation boundary.
    // Project metadata remains readable while an imported folder is unavailable.
    const resolved = importedRoot ?? path.join(input.PROJECTS_DIR, input.projectId);
    const root = canonicalPath(importedRoot ?? input.PROJECTS_DIR);
    const target = existsSync(resolved)
      ? canonicalPath(resolved)
      : importedRoot ? root : path.join(root, input.projectId);
    if (!contains(root, target)) return deny(403, 'FORBIDDEN', 'project directory is outside its storage root');
  } catch (error) {
    return deny(403, 'FORBIDDEN', error instanceof Error ? error.message : 'project directory unavailable');
  }
  return true;
}

export function createAuthorizeProjectRequest<Database>(deps: ProjectAccessDependencies<Database> & {
  sendApiError: (res: Response, status: number, code: string, message: string) => unknown;
}): AuthorizeProjectRequest {
  return (req, res, projectId, options) => enforceLocalProjectDataPlaneRequest({
    ...deps, req, projectId, options,
    onDenied: (status, code, message) => deps.sendApiError(res, status, code, message),
  });
}
