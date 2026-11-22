import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Downloads a folder the cloud described in a manifest, checks every file against the size and
 * SHA-256 the manifest gives, and only then puts it in place, replacing any older copy in one
 * rename. A failed or interrupted download leaves the target as it was. Asset packs and cloud
 * skills both arrive this way.
 */

export type DownloadFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export interface VerifiedFile { path: string; size: number; sha256: string }

const CONCURRENCY = 6;

export async function readCapped(response: Response, limit: number, label: string, fail: (message: string) => Error): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw fail(`${label} is larger than expected.`);
  const reader = response.body?.getReader();
  if (!reader) throw fail(`${label} was empty.`);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw fail(`${label} is larger than expected.`); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export interface VerifiedDownloadOptions<M extends { files: readonly VerifiedFile[] }> {
  /** Files are read from `${baseUrl}/<path>`, with `Authorization: Bearer <token>`. */
  baseUrl: string;
  token: string;
  /** The manifest's own path under `baseUrl`; it is written beside the files. */
  manifestPath: string;
  manifestBytes: number;
  /** Checks the whole manifest before any file is fetched, so one bad entry downloads nothing. */
  parseManifest: (value: unknown) => M;
  /** The folder that ends up holding the files. */
  target: string;
  /** What the user sees for each kind of failure ("The pack", "The skill"). */
  label: string;
  fail: (message: string) => Error;
  fetch?: DownloadFetch;
  timeoutMs?: number;
}

export async function downloadVerifiedFolder<M extends { files: readonly VerifiedFile[] }>(
  options: VerifiedDownloadOptions<M>,
): Promise<M> {
  const { baseUrl, token, target, label, fail } = options;
  const fetchFile = options.fetch ?? ((url, init) => fetch(url, init));
  const headers = { authorization: `Bearer ${token}` };
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10 * 60_000);
  const get = async (relative: string, limit: number): Promise<Buffer> => {
    const url = `${baseUrl}/${relative.split('/').map(encodeURIComponent).join('/')}`;
    let response: Response;
    try { response = await fetchFile(url, { headers, signal }); } catch { throw fail(`${label} could not be downloaded. Check your connection and try again.`); }
    if (response.status === 401 || response.status === 403) throw fail('The download link expired. Try again.');
    if (!response.ok) throw fail(`${label} could not be downloaded (${relative}: ${response.status}).`);
    return readCapped(response, limit, relative, fail);
  };

  const manifestBytes = await get(options.manifestPath, options.manifestBytes);
  let parsed: unknown;
  try { parsed = JSON.parse(manifestBytes.toString('utf8')); } catch { throw fail(`${label}'s file list is not valid JSON.`); }
  const manifest = options.parseManifest(parsed);

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
          throw fail(`${file.path} did not match ${label.toLowerCase()}'s file list. Try again.`);
        }
        const out = path.join(stage, ...file.path.split('/'));
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, data);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    await writeFile(path.join(stage, ...options.manifestPath.split('/')), manifestBytes);
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
  return manifest;
}
