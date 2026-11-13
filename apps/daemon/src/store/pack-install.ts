import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OpenPixoStoreDownloadResponse, WorkshopPackFile, WorkshopPackManifest } from '@openpixo/contracts';

/** Where an asset pack lives inside a project, relative to the project root. */
export function packFolder(itemName: string): string {
  return `assets/packs/${itemName.slice(itemName.indexOf('/') + 1)}`;
}

export class PackInstallError extends Error {}

const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PACK_BYTES = 500 * 1024 * 1024;
const MANIFEST_BYTES = 4 * 1024 * 1024;
const CONCURRENCY = 6;
/** Lowercase folders, no dot-names, and only the file types packs ship. Mirrors the play Worker's rule. */
const PACK_FILE = /^(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:png|webp|json|md)$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

async function readCapped(response: Response, limit: number, label: string): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new PackInstallError(`${label} is larger than expected.`);
  const reader = response.body?.getReader();
  if (!reader) throw new PackInstallError(`${label} was empty.`);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new PackInstallError(`${label} is larger than expected.`); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

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
  fetch?: Fetch;
  timeoutMs?: number;
}): Promise<{ folder: string; files: number; manifest: WorkshopPackManifest }> {
  const { grant, projectDir } = options;
  const fetchFile = options.fetch ?? ((url, init) => fetch(url, init));
  const headers = { authorization: `Bearer ${grant.token}` };
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10 * 60_000);
  const get = async (relative: string, limit: number): Promise<Buffer> => {
    const url = `${grant.baseUrl}/${relative.split('/').map(encodeURIComponent).join('/')}`;
    let response: Response;
    try { response = await fetchFile(url, { headers, signal }); } catch { throw new PackInstallError('The pack could not be downloaded. Check your connection and try again.'); }
    if (response.status === 401 || response.status === 403) throw new PackInstallError('The download link expired. Try again.');
    if (!response.ok) throw new PackInstallError(`The pack could not be downloaded (${relative}: ${response.status}).`);
    return readCapped(response, limit, relative);
  };

  const manifestBytes = await get('pack.json', MANIFEST_BYTES);
  let parsed: unknown;
  try { parsed = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new PackInstallError('The pack\'s file list is not valid JSON.'); }
  const manifest = parsePackManifest(parsed, grant.itemName, grant.version);

  const folder = packFolder(grant.itemName);
  const target = path.join(projectDir, ...folder.split('/'));
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const stage = path.join(parent, `.${path.basename(target)}.partial-${randomBytes(4).toString('hex')}`);
  const previous = path.join(parent, `.${path.basename(target)}.previous-${randomBytes(4).toString('hex')}`);
  try {
    await mkdir(stage, { recursive: true });
    const queue = [...manifest.files];
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const data = await get(file.path, file.size);
        if (data.length !== file.size || createHash('sha256').update(data).digest('hex') !== file.sha256) {
          throw new PackInstallError(`${file.path} did not match the pack's file list. Try again.`);
        }
        const out = path.join(stage, ...file.path.split('/'));
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, data);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    await writeFile(path.join(stage, 'pack.json'), manifestBytes);
    let hadPrevious = false;
    try { await rename(target, previous); hadPrevious = true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try { await rename(stage, target); } catch (error) {
      if (hadPrevious) await rename(previous, target).catch(() => {});
      throw error;
    }
    if (hadPrevious) await rm(previous, { recursive: true, force: true });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return { folder, files: manifest.files.length + 1, manifest };
}
