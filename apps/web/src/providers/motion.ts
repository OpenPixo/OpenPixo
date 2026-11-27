import { useEffect, useSyncExternalStore } from 'react';
import {
  MOTION_API_ERROR_CODES,
  type InstalledMotionCharacter, type MotionApiErrorCode, type MotionCharacter, type MotionCharactersResponse, type MotionJob, type MotionPortrait, type MotionStatus,
} from '@openpixo/contracts';
import { isCloudAccountAvailable, useOpenPixoAccount } from '../hooks/useOpenPixoAccount';

/** Daemon client for moving characters (Pixo Motion). The daemon is the only one that talks to the cloud. */
export class MotionRequestError extends Error {
  constructor(message: string, readonly code: MotionApiErrorCode | null, readonly status: number) {
    super(message);
    this.name = 'MotionRequestError';
  }
}

const KNOWN = new Set<string>(MOTION_API_ERROR_CODES);
export const motionErrorCode = (error: unknown): MotionApiErrorCode | null => error instanceof MotionRequestError ? error.code : null;

async function send(url: string, method: string, body?: unknown): Promise<Response> {
  let response: Response;
  const form = body instanceof FormData;
  try {
    response = await fetch(url, { method, cache: 'no-store', ...(body === undefined ? {} : form ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  } catch {
    throw new MotionRequestError('The daemon could not be reached.', null, 0);
  }
  if (response.ok) return response;
  const data = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null, code = data?.error?.code;
  throw new MotionRequestError(data?.error?.message ?? `Request failed (${response.status})`, code && KNOWN.has(code) ? code as MotionApiErrorCode : null, response.status);
}
const json = async <T>(url: string, method = 'GET', body?: unknown): Promise<T> => await (await send(url, method, body)).json() as T;
const of = (id: string): string => `/api/motion/characters/${encodeURIComponent(id)}`;

export const fetchMotionStatus = (): Promise<MotionStatus> => json('/api/motion/service');
export const fetchMotionCharacters = (): Promise<MotionCharactersResponse> => json('/api/motion/characters');
export const fetchMotionCharacter = (id: string): Promise<MotionCharacter> => json(of(id));
/** Free within the daily limit. The same request id again answers the same portrait. */
export function paintPortrait(text: string, picture: File | null, requestId: string): Promise<MotionPortrait> {
  const form = new FormData();
  form.append('text', text);
  form.append('requestId', requestId);
  if (picture) form.append('picture', picture, picture.name || 'picture');
  return json('/api/motion/portraits', 'POST', form);
}
export const fetchPortrait = (id: string): Promise<MotionPortrait> => json(`/api/motion/portraits/${encodeURIComponent(id)}`);
/** Spends credits. The same request id again answers the same job. */
export const orderMotion = (portraitId: string, name: string, requestId: string): Promise<MotionJob> => json('/api/motion/jobs', 'POST', { portraitId, name, requestId });
export const fetchMotionJob = (id: string): Promise<MotionJob> => json(`/api/motion/jobs/${encodeURIComponent(id)}`);
export const renameMotion = (id: string, name: string): Promise<MotionCharacter> => json(of(id), 'PATCH', { name });
export const deleteMotion = (id: string): Promise<unknown> => json(of(id), 'DELETE');
export const installMotion = (id: string, projectId: string): Promise<InstalledMotionCharacter> => json(`${of(id)}/install`, 'POST', { projectId });
export const dropMotionSuggestion = (id: string): Promise<unknown> => json(`/api/motion/suggestions/${encodeURIComponent(id)}`, 'DELETE');
/** The finished file, as bytes for the player. */
export const fetchMotionFile = async (id: string): Promise<ArrayBuffer> => await (await send(`${of(id)}/file`, 'GET')).arrayBuffer();

export const portraitPicture = (id: string): string => `/api/motion/portraits/${encodeURIComponent(id)}/picture`;
export const motionPoster = (id: string): string => `${of(id)}/poster`;
export const motionDownload = (id: string): string => `${of(id)}/file?download=1`;
/** The player the games get, served by the daemon so the page has no copy of its own. */
export const MOTION_PLAYER_URL = '/api/motion/player.js';

/** Whether this build has moving characters, for everything that shows or hides the page. */
let status: MotionStatus | null = null, reading: Promise<void> | null = null;
const listeners = new Set<() => void>();
export function refreshMotionStatus(): Promise<void> {
  reading ??= fetchMotionStatus().then(next => { status = next; listeners.forEach(f => f()); }, () => { /* an older daemon, or none: as without the feature */ }).finally(() => { reading = null; });
  return reading;
}
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Null until it is known, and in a build without a cloud account. */
export function useMotionStatus(): MotionStatus | null {
  const value = useSyncExternalStore(subscribe, () => status, () => null), account = useOpenPixoAccount();
  const cloud = isCloudAccountAvailable(account.status), signedIn = Boolean(account.status?.signedIn);
  // signing in or out changes what may be shown
  useEffect(() => { if (cloud) void refreshMotionStatus(); }, [cloud, signedIn]);
  return cloud ? value : null;
}
