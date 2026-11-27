import {
  MOTION_CHARACTER_STATES, MOTION_ERROR_CODES, MOTION_JOB_STATES, MOTION_PORTRAIT_STATES,
  type MotionCharacter, type MotionErrorCode, type MotionJob, type MotionPortrait, type MotionService,
} from '@openpixo/contracts';
import { MotionError } from './errors.js';

/** The cloud's answers, field by field. What is not named here goes no further; what is missing means the answer is not understood. */

type Row = Record<string, unknown>;
const bad = (): never => { throw new MotionError('CLOUD_UNAVAILABLE'); };
const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : bad();
const rows = (value: unknown, max = 1000): Row[] => Array.isArray(value) && value.length <= max ? value.map(row) : bad();
const text = (value: unknown, max = 300): string => typeof value === 'string' && value.length <= max ? value : bad();
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : bad();
const one = <T extends string>(all: readonly T[], value: unknown): T => all.find(x => x === value) ?? bad();
const date = (value: unknown): string => { const result = text(value, 64); return Number.isFinite(Date.parse(result)) ? result : bad(); };
const match = (form: RegExp, value: unknown): string => typeof value === 'string' && form.test(value) ? value : bad();

/** Ids of portraits, jobs and characters: safe in a path and in a file name. */
export const MOTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CLOUD_CODES: ReadonlySet<string> = new Set(MOTION_ERROR_CODES);
/** Why something failed; a reason this version does not know is told as the plain one. */
const reason = (value: unknown, otherwise: MotionErrorCode): MotionErrorCode | null => value == null ? null : typeof value === 'string' && CLOUD_CODES.has(value) ? value as MotionErrorCode : otherwise;

export function service(value: unknown): MotionService {
  const s = row(value);
  return { paused: s.paused === true, priceVersion: count(s.priceVersion), price: count(s.price), portraitsPerDay: count(s.portraitsPerDay), portraitsLeft: count(s.portraitsLeft) };
}

export function portrait(value: unknown): MotionPortrait {
  const p = row(value);
  return {
    id: match(MOTION_ID, p.id), state: one(MOTION_PORTRAIT_STATES, p.state), text: text(p.text, 4000), fromPicture: p.fromPicture === true, used: p.used === true,
    errorCode: reason(p.errorCode, 'MOTION_PAINTING_FAILED'), createdAt: date(p.createdAt), expiresAt: date(p.expiresAt),
  };
}

export function job(value: unknown): MotionJob {
  const j = row(value), progress = typeof j.progress === 'number' && Number.isFinite(j.progress) ? Math.min(1, Math.max(0, j.progress)) : bad();
  return {
    id: match(MOTION_ID, j.id), characterId: match(MOTION_ID, j.characterId), state: one(MOTION_JOB_STATES, j.state), progress,
    creditsReserved: count(j.creditsReserved), creditsCharged: j.creditsCharged == null ? null : count(j.creditsCharged),
    errorCode: reason(j.errorCode, 'MOTION_BUILD_FAILED'), createdAt: date(j.createdAt), updatedAt: date(j.updatedAt),
  };
}

export function character(value: unknown): MotionCharacter {
  const c = row(value), file = c.file == null ? null : row(c.file);
  return {
    id: match(MOTION_ID, c.id), name: text(c.name, 200), state: one(MOTION_CHARACTER_STATES, c.state), portraitId: match(MOTION_ID, c.portraitId),
    file: file ? { bytes: count(file.bytes), sha256: match(SHA256, file.sha256) } : null,
    job: c.job == null ? null : job(c.job), createdAt: date(c.createdAt), updatedAt: date(c.updatedAt),
  };
}

export const characters = (value: unknown): MotionCharacter[] => rows(row(value).characters).map(character);

export interface RemoteFile { name: string; bytes: number; sha256: string }
export interface RemoteFiles { baseUrl: string; token: string; files: RemoteFile[] }

/** What a download may hold, and how big each file may be. */
const LIMITS: Record<string, number> = { 'portrait.png': 16 * 1024 * 1024, 'poster.png': 16 * 1024 * 1024, 'character.pxmo': 96 * 1024 * 1024 };

/** What can be downloaded. The token goes to `origin` alone; every file that is wanted must be there. */
export function download(value: unknown, origin: string, wanted: readonly string[]): RemoteFiles {
  const d = row(value), baseUrl = text(d.baseUrl, 2048), seen = new Set<string>();
  let url: URL;
  try { url = new URL(baseUrl); } catch { return bad(); }
  if (url.origin !== origin || url.search || url.hash || url.username || url.password) bad();
  const files = rows(d.files, 20).flatMap(f => {
    const name = text(f.name, 64), limit = LIMITS[name];
    // a file this version does not know is not downloaded
    if (limit === undefined || !wanted.includes(name)) return [];
    const bytes = count(f.bytes);
    if (bytes > limit || seen.has(name)) bad();
    seen.add(name);
    return [{ name, bytes, sha256: match(SHA256, f.sha256) }];
  });
  if (wanted.some(name => !seen.has(name))) bad();
  return { baseUrl: baseUrl.replace(/\/+$/u, ''), token: text(d.token, 4096), files };
}
