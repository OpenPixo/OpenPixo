import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { PublishCloudError } from '../account/errors.js';
import type { BundleFile } from './bundle.js';

export const UPLOAD_CONCURRENCY = 4;
export const UPLOAD_ATTEMPTS = 4;
const UPLOAD_ATTEMPT_TIMEOUT_MS = 5 * 60 * 1000;
const RETRY_BASE_MS = 500;

export class PublishUploadError extends Error {
  constructor(readonly code: 'PUBLISH_UPLOAD_FAILED' | 'PUBLISH_UPLOAD_REJECTED' | 'PUBLISH_FILES_CHANGED', message: string) { super(message); }
}

export interface UploadInput {
  rootDir: string;
  files: BundleFile[];
  baseUrl: string;
  version: number;
  token: string;
  signal?: AbortSignal;
  onFileDone?: () => void;
  /** Injected so retry tests do not wait for real backoff. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms).unref?.(); });

/** The Worker's path form: each segment encoded, the slashes kept. */
export function uploadUrl(baseUrl: string, version: number, relative: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/${version}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

async function readChecked(rootDir: string, file: BundleFile): Promise<Buffer> {
  const absolute = await realpath(path.join(rootDir, ...file.path.split('/')));
  const body = await readFile(absolute);
  // The manifest is already signed into the token, so a changed file could only fail on the server.
  if (body.length !== file.size || createHash('sha256').update(body).digest('hex') !== file.sha256) {
    throw new PublishUploadError('PUBLISH_FILES_CHANGED', `${file.path} changed while publishing. Publish again when nothing is rebuilding the game.`);
  }
  return body;
}

/** Retries what can heal on its own: lost connections, rate limits and server errors. */
async function uploadOne(input: UploadInput, file: BundleFile): Promise<void> {
  const body = await readChecked(input.rootDir, file);
  const url = uploadUrl(input.baseUrl, input.version, file.path);
  const sleep = input.sleep ?? realSleep;
  for (let attempt = 1; ; attempt += 1) {
    let status: number | null = null;
    let refusal: { message?: unknown; refusedFiles?: unknown } | null = null;
    try {
      const response = await fetch(url, { method: 'PUT', redirect: 'error', body,
        signal: AbortSignal.any([AbortSignal.timeout(UPLOAD_ATTEMPT_TIMEOUT_MS), ...(input.signal ? [input.signal] : [])]),
        headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/octet-stream' } });
      const reply = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown; refusedFiles?: unknown } } | null;
      if (response.ok) return;
      status = response.status;
      if (reply?.error?.code === 'PUBLISH_REFUSED') refusal = reply.error;
    } catch {
      if (input.signal?.aborted) throw new PublishUploadError('PUBLISH_UPLOAD_FAILED', 'The upload was stopped. Publish again to finish it.');
    }
    if (status === 401 || status === 403) throw new PublishUploadError('PUBLISH_UPLOAD_REJECTED', 'The upload session expired before the upload finished. Publish again.');
    // The Worker applies the rules again and names the file, so the job can list it like any other refusal.
    if (refusal) {
      throw new PublishCloudError('PUBLISH_REFUSED', refusal.message, Array.isArray(refusal.refusedFiles) && refusal.refusedFiles.every(item => typeof item === 'string') ? refusal.refusedFiles.slice(0, 20) as string[] : [file.path]);
    }
    if (status !== null && status !== 408 && status !== 429 && status < 500) {
      throw new PublishUploadError('PUBLISH_UPLOAD_REJECTED', `${file.path} could not be uploaded. Publish again; if it keeps happening, rebuild the game first.`);
    }
    if (attempt >= UPLOAD_ATTEMPTS) {
      throw new PublishUploadError('PUBLISH_UPLOAD_FAILED', `The upload was interrupted at ${file.path}. Check your connection and publish again. Your public link, if you have one, still shows the previous version.`);
    }
    await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
}

/** Bounded concurrency. The first permanent failure stops new uploads. */
export async function uploadBundle(input: UploadInput): Promise<void> {
  let next = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, input.files.length) }, async () => {
    while (!failed && next < input.files.length) {
      const file = input.files[next++]!;
      try {
        await uploadOne(input, file);
        input.onFileDone?.();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }));
}
