import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import type Database from 'better-sqlite3';
import type {
  GeneratedProjectAssetFile, OpenPixoCloudGenerationJob, OpenPixoGenerationParams, OpenPixoGenerationQuote,
  OpenPixoGenerationReferenceResponse, OpenPixoGenerationServicesResponse, ProjectMetadata,
} from '@openpixo/contracts';
import { isOpenPixoModel3dService, OPENPIXO_MODEL3D_PROMPT } from '@openpixo/contracts';
import { AccountError, describeCloudFailure } from '../account/errors.js';
import { kindFor, mimeFor, resolveProjectWritePath } from '../projects.js';
import type { LiveMediaTask } from './task-store.js';

/**
 * Hosted image, audio and 3D generation paid with OpenPixo credits.
 *
 * The cloud job is the source of truth. This module only submits a confirmed
 * quote (idempotently, under a stable request id), follows the job, and writes
 * the artifact into the project. Files normally move straight between this app and
 * the vendor, with the cloud handing out the links; those links stay in this module
 * and never reach the UI, the CLI, task state or a log. It never renders a
 * placeholder: a job either delivers verified bytes or fails. The link between a local media
 * task and its cloud job is persisted, so a daemon restart resumes following the
 * job instead of reporting it interrupted.
 */

export interface HostedCloud {
  generationReference(sha256: string, mime: ReferenceMime, bytes: number, options?: { fresh?: boolean }): Promise<OpenPixoGenerationReferenceResponse>;
  generationQuote(service: string, params: OpenPixoGenerationParams): Promise<OpenPixoGenerationQuote>;
  generationSubmit(input: { quoteId: string; idempotencyKey: string; service: string; params: OpenPixoGenerationParams }): Promise<OpenPixoCloudGenerationJob>;
  generationJob(jobId: string): Promise<OpenPixoCloudGenerationJob>;
  generationServices(): Promise<OpenPixoGenerationServicesResponse>;
  cloudOrigin(): string | null;
}

/**
 * Told the outcome of a request as soon as the cloud proves it, on the first try or
 * after a restart. No call means no proof: whoever is counting keeps counting.
 */
export interface HostedSettlement {
  charged(requestId: string, credits: number): void;
  released(requestId: string): void;
}

/**
 * Refusals the cloud raises after looking up the request id and finding no job
 * (`generation_reserve`), so nothing was reserved whatever happened before.
 */
const REFUSED_AFTER_JOB_LOOKUP: ReadonlySet<string> = new Set(['GENERATION_QUOTE_INVALID', 'GENERATION_QUOTE_EXPIRED', 'GENERATION_RATE_LIMITED', 'INSUFFICIENT_CREDITS']);
/**
 * Refusals raised before that lookup. They prove nothing was reserved only when no
 * earlier attempt under this request id could have reached the cloud.
 */
const REFUSED_BEFORE_JOB_LOOKUP: ReadonlySet<string> = new Set(['GENERATION_PAUSED', 'GENERATION_PARAMS_INVALID', 'GENERATION_SERVICE_UNKNOWN']);

export interface HostedTaskStore {
  getLiveMediaTask(taskId: string): LiveMediaTask | null;
  persistMediaTask(task: LiveMediaTask): void;
  appendTaskProgress(task: LiveMediaTask, line: string): void;
  notifyTaskWaiters(task: LiveMediaTask): void;
}

/** References are always images, whatever else the cloud can hand back. */
type ReferenceMime = 'image/png' | 'image/jpeg' | 'image/webp';
function isReferenceMime(mime: string): mime is ReferenceMime {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp';
}

/** A project image to send as a reference, already read and confined to the project. */
export interface HostedReferenceImage { bytes: Buffer; mime: string }

export interface HostedGenerateArgs {
  taskId: string;
  projectId: string;
  metadata?: ProjectMetadata | undefined;
  service: string;
  params: OpenPixoGenerationParams;
  quoteId: string;
  cloudRequestId: string;
  /** Reference images for an edit service, in the order they were quoted. */
  references?: HostedReferenceImage[] | undefined;
  /** Sanitized project-relative output path; the extension follows the artifact. */
  output: string;
  /**
   * A folder outside the project the file lands in instead, such as a recipe
   * candidate's staging folder; `output` is then relative to it. Kept with the job,
   * so a resumed job delivers there too.
   */
  writeRoot?: string | undefined;
  onProgress?: ((line: string) => void) | undefined;
  onBytesWritten?: ((written: { bytes: Buffer; name: string; mime: string; kind: string; mtime: number }) => void | Promise<void>) | undefined;
}

/** The most this app takes for one file; it is held in memory while saving. */
const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCES = 4;
/** Tries for one reference upload; a dropped one otherwise poisons that picture until the link expires. */
const REFERENCE_UPLOAD_ATTEMPTS = 3;
const REFERENCE_UPLOAD_RETRY_MS = 1_000;
/**
 * Tries for the steps before anything is charged: registering and uploading references, and the
 * quote. None of them reserves credits, so trying again costs nothing; the paid submit has its own,
 * unbounded retry under one request id in `follow`.
 */
const PRECHARGE_ATTEMPTS = 3;
const PRECHARGE_RETRY_MS = [2_000, 6_000] as const;
const PRECHARGE_GAVE_UP = `OpenPixo cloud did not take this request after ${PRECHARGE_ATTEMPTS} tries, so nothing was charged. It is safe to send the same request again in a minute.`;
/** How long a note about an unconfirmed or replaced reference is kept; the cloud keeps a reference a day. */
const REFERENCE_NOTE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const EXTENSIONS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'audio/mpeg': '.mp3', 'model/gltf-binary': '.glb', 'video/mp4': '.mp4' } as const;
const PENDING = ['submitting', 'pending'] as const;

/** Every hosted 3D tier works from its reference alone, so its prompt is fixed and a quote cannot drift. */
function pricedParams(service: string, params: OpenPixoGenerationParams): OpenPixoGenerationParams {
  return isOpenPixoModel3dService(service) ? { ...params, prompt: OPENPIXO_MODEL3D_PROMPT } : params;
}

/** A delivery check this module wrote itself, so its words hold no link and may be logged. */
class DeliveryProblem extends Error {}

/** The link itself says the file is not there, as opposed to a server or a network that failed for now. */
class LinkGone extends DeliveryProblem {
  constructor(readonly status: number) { super(`artifact download answered ${status}`); }
}
const LINK_GONE_ANSWERS: ReadonlySet<number> = new Set([403, 404, 410]);

/** The most tries at a download before the task says so. A restart tries again, unless the link is gone. */
const MAX_DOWNLOAD_ATTEMPTS = 5;

const DOWNLOAD_WAITING = 'The file is paid and waiting for you for 7 days, but downloading it failed. Restart OpenPixo to retry the download.';
const DOWNLOAD_LATE = 'This file was paid for, but downloading it failed and its 7-day download window has passed. Restart OpenPixo to retry, or contact support.';
const DOWNLOAD_EXPIRED = 'This file was paid for, but its 7-day download window has passed. Contact support.';
const DOWNLOAD_GONE = 'This file was paid for, but its download link no longer works. Contact support.';

/**
 * Whether a paid file's 7 days at the vendor are over. Only a direct file has them, and it is the one
 * with no hash; a stored file's date is just when this signed link stops working. The cloud keeps
 * answering with the same link and date after that, so nothing else here would notice.
 */
function downloadWindowPassed(job: OpenPixoCloudGenerationJob, now: number): boolean {
  return Boolean(job.download) && job.artifact?.sha256 === null && Date.parse(job.download!.expiresAt) <= now;
}

/** The body, read no further than the limit, whatever a compressed answer's headers said. */
async function readWithin(response: Response, limit: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel().catch(() => undefined); throw new DeliveryProblem('artifact too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Whether what arrived is the file the cloud proved. A server may compress even when asked not to, and
 * fetch then hands over the decompressed file, so that is what the size is compared with. If the cloud's
 * size came from the compressed answer, the server's Content-Length is the same number.
 */
function isProvenSize(bytes: number, proven: number, response: Response): boolean {
  if (bytes === proven) return true;
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  return Boolean(encoding) && encoding !== 'identity' && Number(response.headers.get('content-length')) === proven;
}

/**
 * What to log about a failed download. Anything else came from the transport or the URL parser, whose
 * words can carry the vendor's host, so only its type is kept.
 */
function deliveryFailureReason(error: unknown): string {
  if (error instanceof DeliveryProblem) return error.message;
  if (!(error instanceof Error)) return typeof error;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} ${code}` : error.name;
}

/**
 * A link the cloud handed out. The account's own session carried it here, so its host is
 * the cloud's call; it must still be secure, unless it is the cloud itself.
 */
function cloudGivenUrl(value: string, origin: string | null): URL {
  const url = new URL(value);
  if (!origin || url.username || url.password || (url.origin !== origin && url.protocol !== 'https:')) throw new DeliveryProblem('untrusted link');
  return url;
}

export class HostedGenerationError extends Error {
  constructor(readonly code: string, message: string, readonly status = 502, readonly retryable?: boolean) {
    super(message);
    this.name = 'HostedGenerationError';
  }
}

export function migrateOpenPixoCloudJobs(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS openpixo_cloud_jobs (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      cloud_job_id TEXT,
      request_id TEXT NOT NULL,
      quote_id TEXT NOT NULL,
      service TEXT NOT NULL,
      params_json TEXT NOT NULL,
      output TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('submitting','pending','delivered','failed')),
      error_code TEXT,
      credits_charged INTEGER,
      file_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_openpixo_cloud_jobs_state ON openpixo_cloud_jobs(state);
  `);
  const columns = db.prepare('PRAGMA table_info(openpixo_cloud_jobs)').all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'write_root')) db.exec('ALTER TABLE openpixo_cloud_jobs ADD COLUMN write_root TEXT');
  // A reference picture this app could not prove reached the vendor (`unconfirmed`), or that it now
  // sends as a byte-different copy (`variant` > 0), keyed by the hash of the picture itself.
  db.exec(`
    CREATE TABLE IF NOT EXISTS openpixo_cloud_references (
      sha256 TEXT PRIMARY KEY,
      variant INTEGER NOT NULL DEFAULT 0,
      unconfirmed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
}

interface ReferenceNote { variant: number; unconfirmed: boolean }
/** A reference picture the cloud called already uploaded, by the hash of the picture itself. */
interface TrustedReference { sha256: string; bytes: Buffer; mime: string }
/** What a generate does about references the cloud called uploaded, once the submit shows whether they were. */
interface ReferenceChecks { confirm(): void; reupload(): Promise<void> }

/**
 * The same picture with a few bytes of text added, so it hashes differently: a PNG gets a `tEXt`
 * chunk before IEND, a JPEG a comment after its start marker. Decoders skip both. An older cloud
 * that keeps refusing one picture's hash (castle run, C17) takes the copy as a new reference.
 * Null for a file this cannot extend safely (WebP, or a PNG with bytes after IEND).
 */
export function referenceCopy(bytes: Buffer, mime: string, variant: number): Buffer | null {
  if (mime === 'image/png') {
    const end = bytes.length - 12;
    if (end < 8 || bytes.readUInt32BE(end) !== 0 || bytes.toString('latin1', end + 4, end + 8) !== 'IEND') return null;
    const body = Buffer.from(`tEXtopenpixo\0reference copy ${variant}`, 'latin1');
    const length = Buffer.alloc(4); length.writeUInt32BE(body.length - 4);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([bytes.subarray(0, end), length, body, crc, bytes.subarray(end)]);
  }
  if (mime === 'image/jpeg') {
    const text = Buffer.from(`openpixo reference copy ${variant}`, 'latin1');
    const marker = Buffer.from([0xff, 0xfe, 0, 0]); marker.writeUInt16BE(text.length + 2, 2);
    return Buffer.concat([bytes.subarray(0, 2), marker, text, bytes.subarray(2)]);
  }
  return null;
}

/** A failure where the cloud did not take the request, so a later try may well work. */
function cloudDidNotTake(error: unknown): error is AccountError {
  return error instanceof AccountError && error.code === 'CLOUD_UNAVAILABLE';
}

/** The cloud answered with a failure, as opposed to never answering. */
function cloudAnsweredFailure(error: unknown): boolean {
  return cloudDidNotTake(error) && error.reason === 'service';
}

/** The same refusal, in words that tell a person or an agent that trying again is safe. */
function prechargeGaveUp(error: AccountError): AccountError {
  const final = new AccountError(error.code, error.retryAfterSec, error.reason, PRECHARGE_GAVE_UP);
  if (error.cloud) final.cloud = error.cloud;
  return final;
}

interface LinkRow {
  task_id: string; project_id: string; cloud_job_id: string | null; request_id: string; quote_id: string;
  service: string; params_json: string; output: string; state: string; write_root?: string | null;
}

/** Task ids whose cloud job is still being followed; boot reconcile must not mark them interrupted. */
export function pendingHostedTaskIds(db: Database.Database): string[] {
  return (db.prepare(`SELECT task_id FROM openpixo_cloud_jobs WHERE state IN ('submitting','pending')`).all() as Array<{ task_id: string }>)
    .map(row => row.task_id);
}

/**
 * An MPEG audio Layer III frame header: the 11-bit sync, a real version, Layer III, a stated
 * bitrate and a real sample rate. The sync alone would also pass a UTF-16 byte order mark.
 */
function isMp3Frame(bytes: Buffer): boolean {
  const second = bytes[1]!;
  const third = bytes[2]!;
  const version = (second >> 3) & 0b11;
  const layer = (second >> 1) & 0b11;
  const bitrate = third >> 4;
  const sampleRate = (third >> 2) & 0b11;
  return bytes[0] === 0xff && (second & 0xe0) === 0xe0 && version !== 0b01 && layer === 0b01
    && bitrate !== 0b0000 && bitrate !== 0b1111 && sampleRate !== 0b11;
}

function sniff(bytes: Buffer): keyof typeof EXTENSIONS | null {
  if (bytes.length < 64) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3' || isMp3Frame(bytes)) return 'audio/mpeg';
  if (bytes.subarray(0, 4).toString('latin1') === 'glTF' && bytes.readUInt32LE(4) === 2) return 'model/gltf-binary';
  // ISO base media: an `ftyp` box first, with an MP4 brand.
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp' && /^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash)$/u.test(bytes.subarray(8, 12).toString('latin1'))) return 'video/mp4';
  return null;
}

const FAILURES: Record<string, string> = {
  CONTENT_BLOCKED: 'This was blocked by the content filter. Change the prompt and try again.',
  VENDOR_INPUT_REJECTED: 'The hosted service rejected this prompt. Change it and try again.',
  SUBMISSION_UNCONFIRMED: 'The hosted service never confirmed this job.',
  ARTIFACT_UNAVAILABLE: 'The finished file could not be retrieved in time, so this job was cancelled.',
  GENERATION_TIMED_OUT: 'The hosted service did not finish this job in time.',
};

export interface OpenPixoHostedMediaOptions {
  db: Database.Database;
  cloud: HostedCloud;
  projectsRoot: string;
  getProjectMetadata(projectId: string): ProjectMetadata | undefined | null;
  tasks?: HostedTaskStore;
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
}

export class OpenPixoHostedMedia {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private closed = false;
  private tasks: HostedTaskStore | undefined;
  private settlement: HostedSettlement | undefined;

  constructor(private readonly options: OpenPixoHostedMediaOptions) {
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms).unref?.()));
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.tasks = options.tasks;
  }

  attachTaskStore(tasks: HostedTaskStore): void { this.tasks = tasks; }

  attachSettlement(settlement: HostedSettlement): void { this.settlement = settlement; }

  /** Best-effort: a ledger write that fails leaves the charge counted, which is the safe side. */
  private settle(apply: (settlement: HostedSettlement) => void): void {
    if (!this.settlement) return;
    try { apply(this.settlement); }
    catch (error) { console.warn('[media] hosted settlement failed', error); }
  }

  private update(taskId: string, fields: Partial<{ cloud_job_id: string; state: string; error_code: string | null; credits_charged: number | null; file_json: string }>): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.options.db.prepare(`UPDATE openpixo_cloud_jobs SET ${keys.map(key => `${key} = @${key}`).join(', ')}, updated_at = @updated_at WHERE task_id = @task_id`)
      .run({ ...fields, updated_at: this.now(), task_id: taskId });
  }

  /**
   * Uploads reference images to the cloud once each (keyed by SHA-256) and returns
   * their hashes in order. The same files always yield the same hashes, so a quote
   * and the generate that follows it agree on the exact references.
   */
  async uploadReferences(images: readonly HostedReferenceImage[]): Promise<string[]> {
    return (await this.sendReferences(images, false)).hashes;
  }

  private referenceNote(sha256: string): ReferenceNote | null {
    const row = this.options.db.prepare('SELECT variant, unconfirmed FROM openpixo_cloud_references WHERE sha256 = ?').get(sha256) as
      { variant: number; unconfirmed: number } | undefined;
    return row ? { variant: row.variant, unconfirmed: row.unconfirmed === 1 } : null;
  }

  private writeReferenceNote(sha256: string, note: ReferenceNote): void {
    const now = this.now();
    this.options.db.prepare('DELETE FROM openpixo_cloud_references WHERE updated_at < ?').run(now - REFERENCE_NOTE_TTL_MS);
    if (note.variant === 0 && !note.unconfirmed) {
      this.options.db.prepare('DELETE FROM openpixo_cloud_references WHERE sha256 = ?').run(sha256);
      return;
    }
    this.options.db.prepare(`INSERT INTO openpixo_cloud_references (sha256, variant, unconfirmed, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(sha256) DO UPDATE SET variant = excluded.variant, unconfirmed = excluded.unconfirmed, updated_at = excluded.updated_at`)
      .run(sha256, note.variant, note.unconfirmed ? 1 : 0, now);
  }

  /**
   * Stops trusting what the cloud says about a picture after the cloud failed on it. First the
   * next registration asks for a fresh upload link; if that was already asked for and the cloud
   * still fails, an older cloud is ignoring the request, so the picture moves to its next
   * byte-different copy, which that cloud has never seen. A copy changes the hash, so only a
   * quote may move to one: a generate must send exactly what was quoted.
   */
  private distrustReference(sha256: string, bytes: Buffer, mime: string, mayReplace: boolean): void {
    const note = this.referenceNote(sha256) ?? { variant: 0, unconfirmed: false };
    if (!note.unconfirmed) this.writeReferenceNote(sha256, { ...note, unconfirmed: true });
    else if (mayReplace && referenceCopy(bytes, mime, note.variant + 1)) this.writeReferenceNote(sha256, { variant: note.variant + 1, unconfirmed: true });
  }

  /** The cloud used these references, so what it said about them held. */
  private confirmReferences(trusted: readonly TrustedReference[]): void {
    for (const reference of trusted) {
      const note = this.referenceNote(reference.sha256);
      if (note?.unconfirmed) this.writeReferenceNote(reference.sha256, { variant: note.variant, unconfirmed: false });
    }
  }

  /**
   * Registers and uploads reference images (keyed by SHA-256) and returns their hashes in order.
   * The same files always yield the same hashes, so a quote and the generate that follows it
   * agree on the exact references; a picture this app moved to a byte-different copy keeps
   * sending that copy. `trusted` lists the pictures the cloud called already uploaded.
   *
   * A reference stays unconfirmed from the moment the cloud hands out its link until the upload
   * is answered: the cloud may count it as there already, and one lost upload then made every
   * later quote on that picture fail until the registration expired (castle run, C17).
   */
  private async sendReferences(images: readonly HostedReferenceImage[], mayReplace: boolean): Promise<{ hashes: string[]; trusted: TrustedReference[] }> {
    if (images.length > MAX_REFERENCES) throw new AccountError('GENERATION_PARAMS_INVALID');
    const origin = this.options.cloud.cloudOrigin();
    const hashes: string[] = [];
    const trusted: TrustedReference[] = [];
    for (const image of images) {
      const mime = sniff(image.bytes);
      if (!mime || !isReferenceMime(mime) || mime !== image.mime || image.bytes.length > MAX_REFERENCE_BYTES) throw new AccountError('GENERATION_PARAMS_INVALID');
      const original = createHash('sha256').update(image.bytes).digest('hex');
      const note = this.referenceNote(original);
      const variant = note?.variant ?? 0;
      const bytes = variant ? referenceCopy(image.bytes, mime, variant) ?? image.bytes : image.bytes;
      if (bytes.length > MAX_REFERENCE_BYTES) throw new AccountError('GENERATION_PARAMS_INVALID');
      const sent = bytes === image.bytes ? original : createHash('sha256').update(bytes).digest('hex');
      const fresh = note?.unconfirmed === true;
      let registered: OpenPixoGenerationReferenceResponse;
      try { registered = await this.options.cloud.generationReference(sent, mime, bytes.length, fresh ? { fresh: true } : undefined); }
      catch (error) {
        console.warn(`[media] hosted reference registration failed${fresh ? ' (fresh link asked)' : ''}: ${describeCloudFailure(error)}`);
        if (cloudAnsweredFailure(error)) this.distrustReference(original, image.bytes, mime, mayReplace);
        throw error;
      }
      if (registered.uploadUrl) {
        let url: URL;
        try { url = cloudGivenUrl(registered.uploadUrl, origin); } catch { throw new AccountError('CLOUD_UNAVAILABLE'); }
        this.writeReferenceNote(original, { variant, unconfirmed: true });
        await this.putReference(url, mime, bytes, url.origin === origin);
        this.writeReferenceNote(original, { variant, unconfirmed: false });
      } else {
        // Still unconfirmed if a fresh link was asked for and an older cloud said "there" anyway:
        // only the quote or the job that uses it proves it.
        trusted.push({ sha256: original, bytes: image.bytes, mime });
      }
      hashes.push(sent);
    }
    return { hashes, trusted };
  }

  /**
   * Puts one reference on the link the cloud handed out, trying a dropped connection or a
   * server error again on the same link. A refusal (4xx) is final. Whatever happens, the
   * caller keeps the reference unconfirmed until this returns.
   */
  private async putReference(url: URL, mime: string, bytes: Uint8Array, cloudStorage: boolean): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response | null = null;
      let transport = '';
      // The transport's own words can carry the host, and this error reaches the task and the CLI.
      try {
        response = await this.fetcher(url, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(120_000),
          headers: { 'Content-Type': mime, ...(cloudStorage ? { 'x-upsert': 'true' } : {}) }, body: new Uint8Array(bytes) });
      } catch (error) { response = null; transport = deliveryFailureReason(error); }
      if (response?.ok) return;
      const retryable = !response || response.status >= 500 || response.status === 429;
      // Only the status or the error's type: the link itself must never reach a log.
      console.warn(`[media] hosted reference upload ${response ? `answered ${response.status}` : `failed: ${transport}`} (try ${attempt} of ${REFERENCE_UPLOAD_ATTEMPTS})`);
      if (!retryable || attempt >= REFERENCE_UPLOAD_ATTEMPTS) throw new AccountError('CLOUD_UNAVAILABLE');
      await this.sleep(REFERENCE_UPLOAD_RETRY_MS * attempt);
    }
  }

  /**
   * Runs a step that charges nothing, trying it again when the cloud did not take it, and
   * says in the end that a retry is safe. A refusal is passed on at once.
   */
  private async beforeCharge<T>(what: string, attempt: () => Promise<T>): Promise<T> {
    for (let tries = 1; ; tries++) {
      try { return await attempt(); }
      catch (error) {
        console.warn(`[media] hosted ${what} failed (try ${tries} of ${PRECHARGE_ATTEMPTS}): ${describeCloudFailure(error)}`);
        if (!cloudDidNotTake(error)) throw error;
        if (tries >= PRECHARGE_ATTEMPTS) throw prechargeGaveUp(error);
        await this.sleep(PRECHARGE_RETRY_MS[Math.min(tries, PRECHARGE_RETRY_MS.length) - 1]!);
      }
    }
  }

  /** Quotes exactly what `generate` will send, references included. Spends nothing. */
  async quote(service: string, params: OpenPixoGenerationParams, references: readonly HostedReferenceImage[] = []) {
    return this.beforeCharge(`quote for ${service}`, async () => {
      const { hashes, trusted } = await this.sendReferences(references, true);
      try {
        const quote = await this.options.cloud.generationQuote(service, { ...pricedParams(service, params), ...(hashes.length ? { references: hashes } : {}) });
        this.confirmReferences(trusted);
        return quote;
      } catch (error) {
        // The cloud called these uploaded and then failed on the quote: they are the likeliest cause.
        if (cloudAnsweredFailure(error)) for (const reference of trusted) this.distrustReference(reference.sha256, reference.bytes, reference.mime, true);
        throw error;
      }
    });
  }

  /** The cloud's own catalogue: what each service costs and can render. */
  services() { return this.options.cloud.generationServices(); }

  /** Submits the confirmed quote and follows the job to a delivered file or a failure. */
  async generate(args: HostedGenerateArgs) {
    // Uploading happens before any job exists, so a failure here reserves nothing and is tried again.
    const references = args.references ?? [];
    const { hashes, trusted } = await this.beforeCharge(`reference upload for ${args.service}`, () => this.sendReferences(references, false));
    const checks: ReferenceChecks | undefined = trusted.length ? {
      confirm: () => this.confirmReferences(trusted),
      // Same hashes, so the submit still matches its quote: only a fresh link, never a copy.
      reupload: async () => {
        for (const reference of trusted) this.distrustReference(reference.sha256, reference.bytes, reference.mime, false);
        await this.sendReferences(references, false);
      },
    } : undefined;
    args = { ...args, params: { ...pricedParams(args.service, args.params), ...(hashes.length ? { references: hashes } : {}) } };
    const triedBefore = this.options.db.prepare('SELECT 1 FROM openpixo_cloud_jobs WHERE request_id = ? LIMIT 1').get(args.cloudRequestId) !== undefined;
    const writeRoot = args.writeRoot ?? null;
    this.options.db.prepare(`INSERT INTO openpixo_cloud_jobs
      (task_id, project_id, request_id, quote_id, service, params_json, output, state, write_root, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'submitting', ?, ?, ?)`)
      .run(args.taskId, args.projectId, args.cloudRequestId, args.quoteId, args.service, JSON.stringify(args.params), args.output, writeRoot, this.now(), this.now());
    return this.follow({ task_id: args.taskId, project_id: args.projectId, cloud_job_id: null, request_id: args.cloudRequestId,
      quote_id: args.quoteId, service: args.service, params_json: JSON.stringify(args.params), output: args.output, state: 'submitting', write_root: writeRoot },
    args.metadata, args.onProgress, args.onBytesWritten, triedBefore, checks);
  }

  private async follow(link: LinkRow, metadata: ProjectMetadata | undefined | null, onProgress?: (line: string) => void,
    onBytesWritten?: HostedGenerateArgs['onBytesWritten'], triedBefore = true, referenceChecks?: ReferenceChecks) {
    let checks = referenceChecks;
    let lastLogged = '';
    const progress = (line: string) => { try { onProgress?.(line); } catch { /* progress is advisory */ } };
    const params = JSON.parse(link.params_json) as OpenPixoGenerationParams;
    let job: OpenPixoCloudGenerationJob | null = null;
    let jobId = link.cloud_job_id;
    let delay = 1500;
    let lastState = '';
    let downloadAttempts = 0;
    let mayHaveReachedCloud = triedBefore;
    while (!this.closed) {
      try {
        // Submitting again under the same request id returns the original job, so a
        // resumed or retried submit can never create a second paid job.
        job = jobId ? await this.options.cloud.generationJob(jobId)
          : await this.options.cloud.generationSubmit({ quoteId: link.quote_id, idempotencyKey: link.request_id, service: link.service, params });
        if (!jobId) {
          jobId = job.jobId;
          this.update(link.task_id, { cloud_job_id: jobId, state: 'pending' });
          progress(`OpenPixo cloud job ${jobId}: ${job.creditsReserved} credits reserved`);
          // The cloud took the job with these references, so they were there.
          checks?.confirm();
          checks = undefined;
        }
      } catch (error) {
        const code = error instanceof AccountError ? error.code : null;
        // Before a job id is known, an unavailable cloud may still have created the
        // job, so retry the idempotent submit. Any other refusal there reserved
        // nothing. Once a job exists, only its own terminal state ends the task.
        const retry = jobId ? code !== 'GENERATION_JOB_NOT_FOUND' : code === 'CLOUD_UNAVAILABLE' || code === 'ACCOUNT_SIGNED_OUT';
        const described = `${jobId ? `hosted job ${jobId} status` : 'hosted submit'} (request ${link.request_id}, ${link.service}) failed: ${describeCloudFailure(error)}`;
        // Once per change, so a long wait does not fill the log with the same line.
        if (described !== lastLogged) { console.warn(`[media] ${described}${retry ? '; trying again' : ''}`); lastLogged = described; }
        if (!retry) {
          this.update(link.task_id, { state: 'failed', error_code: code ?? 'CLOUD_UNAVAILABLE' });
          if (!jobId && code && (REFUSED_AFTER_JOB_LOOKUP.has(code) || (!mayHaveReachedCloud && REFUSED_BEFORE_JOB_LOOKUP.has(code)))) {
            this.settle(settlement => settlement.released(link.request_id));
          }
          throw error;
        }
        mayHaveReachedCloud = true;
        // The cloud called a reference uploaded and then failed on the submit: upload it again,
        // once, under the same hash, and keep retrying the same request id as before.
        if (!jobId && checks && cloudAnsweredFailure(error)) {
          const reupload = checks.reupload;
          checks = undefined;
          await reupload().catch((failure: unknown) => console.warn(`[media] hosted reference re-upload failed: ${describeCloudFailure(failure)}`));
        }
        if (code === 'ACCOUNT_SIGNED_OUT') progress('Sign in to OpenPixo again to finish this paid generation.');
        await this.sleep(code === 'ACCOUNT_SIGNED_OUT' ? 30_000 : delay);
        delay = Math.min(delay * 1.5, 15_000);
        continue;
      }
      if (job.state !== lastState) {
        lastState = job.state;
        if (job.state === 'checking') progress('The hosted service has not confirmed the job yet; credits stay reserved and nothing is resubmitted.');
        else if (job.state !== 'succeeded' && job.state !== 'failed') progress(`OpenPixo cloud: ${job.state}`);
      }
      if (job.state === 'failed') {
        console.warn(`[media] hosted job ${job.jobId} (request ${link.request_id}, ${link.service}) failed: ${job.errorCode ?? 'no code'}`);
        this.update(link.task_id, { state: 'failed', error_code: job.errorCode });
        // A failed job returned its whole reservation (`generation_fail`).
        this.settle(settlement => settlement.released(link.request_id));
        const code = job.errorCode ?? 'GENERATION_FAILED';
        throw new HostedGenerationError(`OPENPIXO_${code}`, `${FAILURES[code] ?? 'Hosted generation failed.'} Your ${job.creditsReserved} reserved credits were returned.`,
          code === 'CONTENT_BLOCKED' || code === 'VENDOR_INPUT_REJECTED' ? 422 : 502, code !== 'CONTENT_BLOCKED' && code !== 'VENDOR_INPUT_REJECTED');
      }
      if (job.state === 'succeeded') {
        // Paid from here on, whether or not the local copy works out.
        const paid = job.creditsCharged ?? job.creditsReserved;
        this.settle(settlement => settlement.charged(link.request_id, paid));
        try {
          const file = await this.deliver(link, job, params, metadata, onBytesWritten);
          this.update(link.task_id, { state: 'delivered', credits_charged: job.creditsCharged, file_json: JSON.stringify(file) });
          progress(`OpenPixo cloud: ${job.creditsCharged ?? job.creditsReserved} credits charged`);
          return file;
        } catch (error) {
          // The job is paid and the file is waiting; only the local copy failed.
          // Ask the cloud for the link again and retry; never resubmit, and never release:
          // the cloud proved the file when it charged for it.
          console.warn(`[media] openpixo artifact download failed for ${jobId}: ${deliveryFailureReason(error)}`);
          downloadAttempts++;
          const late = downloadWindowPassed(job, this.now());
          // A link that says the file is gone won't change its mind, so later restarts need not ask.
          // Inside the 7 days it gets every try first, in case it was a blip. A 403 inside them never
          // ends it: a proxy or a blocked region answers the same way, and giving up then would leave
          // someone with a paid file they could still fetch from another network.
          if (error instanceof LinkGone && (late || (error.status !== 403 && downloadAttempts >= MAX_DOWNLOAD_ATTEMPTS))) {
            this.update(link.task_id, { state: 'failed', error_code: 'DOWNLOAD_GONE', credits_charged: paid });
            throw new HostedGenerationError('OPENPIXO_DOWNLOAD_FAILED', late ? DOWNLOAD_EXPIRED : DOWNLOAD_GONE, 410, false);
          }
          if (downloadAttempts >= MAX_DOWNLOAD_ATTEMPTS) {
            throw new HostedGenerationError('OPENPIXO_DOWNLOAD_FAILED', late ? DOWNLOAD_LATE : DOWNLOAD_WAITING, 503, true);
          }
        }
      }
      await this.sleep(delay);
      delay = Math.min(delay * 1.5, 15_000);
    }
    throw new HostedGenerationError('OPENPIXO_DAEMON_STOPPING', 'OpenPixo is shutting down; the job resumes on the next start.', 503, true);
  }

  private async deliver(link: LinkRow, job: OpenPixoCloudGenerationJob, params: OpenPixoGenerationParams,
    metadata: ProjectMetadata | undefined | null, onBytesWritten?: HostedGenerateArgs['onBytesWritten']) {
    const artifact = job.artifact!;
    if (!job.download) throw new DeliveryProblem('no artifact link');
    const url = cloudGivenUrl(job.download.url, this.options.cloud.cloudOrigin());
    const response = await this.fetcher(url, { headers: { 'Accept-Encoding': 'identity' }, redirect: 'error', signal: AbortSignal.timeout(600_000) });
    if (LINK_GONE_ANSWERS.has(response.status)) throw new LinkGone(response.status);
    if (!response.ok) throw new DeliveryProblem(`artifact download answered ${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_ARTIFACT_BYTES) throw new DeliveryProblem('artifact too large');
    const bytes = await readWithin(response, MAX_ARTIFACT_BYTES);
    if (!isProvenSize(bytes.length, artifact.bytes, response)) throw new DeliveryProblem('artifact size mismatch');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // Without a hash from the cloud, the size and the file's own signature are the proof.
    if ((artifact.sha256 && sha256 !== artifact.sha256) || sniff(bytes) !== artifact.mime) throw new DeliveryProblem('artifact integrity mismatch');
    const stem = link.output.slice(0, link.output.length - path.posix.extname(link.output).length);
    const name = `${stem}${EXTENSIONS[artifact.mime]}`;
    const destination = link.write_root
      ? await resolveProjectWritePath(path.dirname(link.write_root), path.basename(link.write_root), name)
      : await resolveProjectWritePath(this.options.projectsRoot, link.project_id, name, metadata ?? undefined);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    const info = await stat(destination);
    const charged = job.creditsCharged ?? job.creditsReserved;
    const surface = artifact.mime === 'audio/mpeg' ? 'audio' as const : artifact.mime === 'model/gltf-binary' ? 'model3d' as const
      : artifact.mime === 'video/mp4' ? 'video' as const : 'image' as const;
    const file = {
      name, size: info.size, mtime: info.mtimeMs, kind: kindFor(name), mime: mimeFor(name), model: link.service, surface,
      providerId: 'openpixo', providerNote: `OpenPixo cloud · ${charged} credits`, providerError: null,
      usedStubFallback: false, intentionalStub: false, warnings: [] as string[], cloudJobId: job.jobId, creditsCharged: charged,
      assetProvenance: {
        contentHash: sha256, provider: 'openpixo', model: link.service, promptText: params.prompt,
        params: { surface, aspect: params.aspect, resolution: params.resolution, style: params.style, duration: params.duration, cloudJobId: job.jobId, cloudRequestId: link.request_id },
        referenceHashes: params.references ?? [],
      } satisfies GeneratedProjectAssetFile['assetProvenance'],
    };
    try { await onBytesWritten?.({ bytes, name, mime: file.mime, kind: file.kind, mtime: info.mtimeMs }); }
    catch (error) { console.warn('[media] openpixo snapshot capture failed', error); }
    return file;
  }

  /**
   * Resumes every cloud job still being followed after a restart, finishing its
   * media task when the cloud does. Call after the media task store is hydrated.
   */
  resumePending(): void {
    const rows = this.options.db.prepare(`SELECT * FROM openpixo_cloud_jobs WHERE state IN (${PENDING.map(() => '?').join(',')})`)
      .all(...PENDING) as LinkRow[];
    for (const link of rows) {
      const task = this.tasks?.getLiveMediaTask(link.task_id) ?? null;
      void this.follow(link, this.options.getProjectMetadata(link.project_id), line => { if (task) this.tasks!.appendTaskProgress(task, line); })
        .then(file => this.finishTask(task, 'done', file, null))
        .catch(error => {
          if (error instanceof HostedGenerationError && error.code === 'OPENPIXO_DAEMON_STOPPING') return;
          this.finishTask(task, 'failed', null, error);
        });
    }
  }

  private finishTask(task: LiveMediaTask | null, status: 'done' | 'failed', file: unknown, error: unknown): void {
    if (!task || !this.tasks) return;
    task.status = status;
    task.file = file;
    task.error = error ? { message: error instanceof Error ? error.message : String(error),
      status: typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 502,
      code: typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'OPENPIXO_GENERATION_FAILED' } : null;
    task.endedAt = this.now();
    this.tasks.persistMediaTask(task);
    this.tasks.notifyTaskWaiters(task);
  }

  close(): void { this.closed = true; }
}
