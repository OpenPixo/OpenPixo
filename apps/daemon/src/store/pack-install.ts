import path from 'node:path';
import type { OpenPixoStoreDownloadResponse, WorkshopPackFile, WorkshopPackManifest } from '@openpixo/contracts';
import { downloadVerifiedFolder, type DownloadFetch } from './verified-download.js';

/** Where an asset pack lives inside a project, relative to the project root. */
export function packFolder(itemName: string): string {
  return `assets/packs/${itemName.slice(itemName.indexOf('/') + 1)}`;
}

export class PackInstallError extends Error {}

const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PACK_BYTES = 500 * 1024 * 1024;
const MANIFEST_BYTES = 4 * 1024 * 1024;
/** Lowercase folders, no dot-names, and only the file types packs ship. Mirrors the play Worker's rule. */
const PACK_FILE = /^(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:png|webp|json|md)$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

/** The manifest is checked whole before any file is fetched: a pack with one bad entry installs nothing. */
export function parsePackManifest(value: unknown, itemName: string, version: string): WorkshopPackManifest {
  const bad = (why: string): never => { throw new PackInstallError(`The pack's file list is not valid (${why}).`); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('not an object');
  const manifest = value as Partial<WorkshopPackManifest>;
  if (manifest.schema !== 1) bad('unknown schema');
  if (manifest.name !== itemName || manifest.version !== version) bad('it names another pack');
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES) bad('file count');
  const seen = new Set<string>();
  let total = 0;
  for (const file of manifest.files as WorkshopPackFile[]) {
    if (!file || typeof file.path !== 'string' || !PACK_FILE.test(file.path) || file.path.includes('..') || file.path === 'pack.json') bad('a file path');
    const key = file.path.toLowerCase();
    if (seen.has(key)) bad('a repeated path');
    seen.add(key);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) bad(`the size of ${file.path}`);
    if (typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) bad(`the hash of ${file.path}`);
    if (typeof file.title !== 'string' || typeof file.use !== 'string' || typeof file.kind !== 'string') bad(`the description of ${file.path}`);
    total += file.size;
  }
  if (total > MAX_PACK_BYTES) bad('total size');
  if (!Array.isArray(manifest.animations)) bad('animations');
  return manifest as WorkshopPackManifest;
}

/**
 * Downloads an owned pack into `<project>/assets/packs/<pack>/`. Every file is checked against the size and
 * SHA-256 the manifest gives before anything lands in the project; the folder then replaces any older copy
 * in one rename, so a failed or interrupted install leaves the project as it was.
 */
export async function installWorkshopPack(options: {
  grant: OpenPixoStoreDownloadResponse;
  projectDir: string;
  fetch?: DownloadFetch;
  timeoutMs?: number;
}): Promise<{ folder: string; files: number; manifest: WorkshopPackManifest }> {
  const { grant, projectDir } = options;
  const folder = packFolder(grant.itemName);
  const manifest = await downloadVerifiedFolder({
    baseUrl: grant.baseUrl, token: grant.token, manifestPath: 'pack.json', manifestBytes: MANIFEST_BYTES,
    parseManifest: value => parsePackManifest(value, grant.itemName, grant.version),
    target: path.join(projectDir, ...folder.split('/')),
    label: 'The pack', fail: message => new PackInstallError(message),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  return { folder, files: manifest.files.length + 1, manifest };
}
