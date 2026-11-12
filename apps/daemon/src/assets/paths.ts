import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { ProjectMetadata } from '@openpixo/contracts';
import { resolveProjectFilePath } from '../projects.js';

/** Reject traversal before normalization, including Windows drive/UNC paths. */
export function assetRelPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f:]/.test(value)
    || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) throw new Error('Asset path must be project-relative');
  const rel = value.replace(/\\/g, '/');
  if (rel.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid asset path');
  return rel;
}

/** Uses the existing realpath boundary, including imported metadata.baseDir. */
export async function resolveAssetFile(projectsRoot: string, projectId: string, relPath: string, metadata?: ProjectMetadata) {
  return resolveProjectFilePath(projectsRoot, projectId, assetRelPath(relPath), metadata);
}

export async function hashAssetFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
