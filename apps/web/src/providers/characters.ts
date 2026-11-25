import { useEffect, useSyncExternalStore } from 'react';
import {
  CHARACTER_ERROR_CODES,
  type CharacterBrief, type CharacterBriefRequest, type CharacterErrorCode, type CharacterGear, type CharacterJob, type CharacterSampleResponse, type CharactersResponse, type CharactersStatus,
  type CharacterTuning, type CharacterUpdate, type CharacterWear, type InstalledCharacter, type LocalCharacter,
} from '@openpixo/contracts';
import { isCloudAccountAvailable, useOpenPixoAccount } from '../hooks/useOpenPixoAccount';

/** Daemon client for animated characters. The daemon is the only one that talks to the cloud. */
export class CharacterRequestError extends Error {
  constructor(message: string, readonly code: CharacterErrorCode | null, readonly status: number) {
    super(message);
    this.name = 'CharacterRequestError';
  }
}

const KNOWN = new Set<string>(CHARACTER_ERROR_CODES);
export const characterErrorCode = (error: unknown): CharacterErrorCode | null => error instanceof CharacterRequestError ? error.code : null;

async function send(url: string, method: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { method, cache: 'no-store', ...(signal ? { signal } : {}), ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new CharacterRequestError('The daemon could not be reached.', null, 0);
  }
  if (response.ok) return response;
  const data = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null, code = data?.error?.code;
  throw new CharacterRequestError(data?.error?.message ?? `Request failed (${response.status})`, code && KNOWN.has(code) ? code as CharacterErrorCode : null, response.status);
}
const json = async <T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => await (await send(url, method, body, signal)).json() as T;
const of = (id: string): string => `/api/characters/${encodeURIComponent(id)}`;

export const fetchCharactersStatus = (): Promise<CharactersStatus> => json('/api/characters/service');
export const fetchCharacters = (signal?: AbortSignal): Promise<CharactersResponse> => json('/api/characters', 'GET', undefined, signal);
/** The free sample, also for someone who is signed out. Null when there is none. */
export const fetchSampleCharacter = async (language: string): Promise<LocalCharacter | null> => (await json<CharacterSampleResponse>(`/api/characters/sample?language=${encodeURIComponent(language)}`)).character;
export const fetchCharacter = (id: string): Promise<LocalCharacter> => json(of(id));
export const fetchCharacterGear = (): Promise<CharacterGear> => json('/api/characters/gear');
export const priceCharacter = (request: CharacterBriefRequest, signal?: AbortSignal): Promise<CharacterBrief> => json('/api/characters/briefs', 'POST', request, signal);
/** Spends credits. The same request id again answers the same job. */
export const orderCharacter = (briefId: string, requestId: string): Promise<CharacterJob> => json('/api/characters/orders', 'POST', { briefId, requestId });
export const updateCharacter = (id: string, change: CharacterUpdate): Promise<LocalCharacter> => json(of(id), 'PATCH', change);
export const deleteCharacter = (id: string): Promise<unknown> => json(of(id), 'DELETE');
export const saveCharacterMotion = (id: string, motion: string, tuning: CharacterTuning): Promise<LocalCharacter> => json(`${of(id)}/motions/${motion}`, 'PUT', { tuning });
export const removeCharacterMotion = (id: string, motion: string): Promise<LocalCharacter> => json(`${of(id)}/motions/${motion}`, 'DELETE');
export const packCharacter = (id: string): Promise<CharacterJob> => json(`${of(id)}/pack`, 'POST', { requestId: crypto.randomUUID() });
export const renamePiece = (piece: string, label: string): Promise<CharacterGear> => json(`/api/characters/gear/${piece}`, 'PATCH', { label });
export const removePiece = (piece: string): Promise<CharacterGear> => json(`/api/characters/gear/${piece}`, 'DELETE');
export const removeGearMotion = (motion: string): Promise<CharacterGear> => json(`/api/characters/gear/motions/${motion}`, 'DELETE');
export const dropCharacterSuggestion = (id: string): Promise<unknown> => json(`/api/characters/suggestions/${encodeURIComponent(id)}`, 'DELETE');
export const installCharacter = (projectId: string, characterId: string): Promise<InstalledCharacter & { playerState: 'written' | 'same' | 'edited' }> => json(`/api/projects/${encodeURIComponent(projectId)}/heroes`, 'POST', { characterId });
export const uninstallCharacter = (projectId: string, slug: string): Promise<unknown> => json(`/api/projects/${encodeURIComponent(projectId)}/heroes/${encodeURIComponent(slug)}`, 'DELETE');

export const characterFile = (id: string, revision: number, file: string): string => `${of(id)}/package/${revision}/${file}`;
export const pieceIcon = (piece: string): string => `/api/characters/gear/icons/${piece}.png`;

/** A motion with other sliders, as it would be packed: the parts of one packet. */
export async function tuneCharacter(id: string, motion: string, tuning: CharacterTuning, wear: CharacterWear, signal?: AbortSignal): Promise<{ json: unknown; bin: Uint8Array }> {
  const bytes = new Uint8Array(await (await send(`${of(id)}/tune`, 'POST', { motion, tuning, wear }, signal)).arrayBuffer()), parts = readPacket(bytes), meta = parts.get('motion.json'), bin = parts.get('motion.bin');
  if (!meta || !bin) throw new CharacterRequestError('The preview could not be read.', null, 0);
  return { json: JSON.parse(new TextDecoder().decode(meta)) as unknown, bin };
}

/** Length of the head (4 bytes), the head as JSON with the parts' names and sizes, then the parts. */
export function readPacket(bytes: Uint8Array): Map<string, Uint8Array> {
  const bad = (): never => { throw new CharacterRequestError('The preview could not be read.', null, 0); };
  if (bytes.length < 4) bad();
  const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
  if (size > bytes.length - 4) bad();
  let at = 4 + size;
  let listed: unknown;
  try { listed = (JSON.parse(new TextDecoder().decode(bytes.subarray(4, at))) as { parts?: unknown }).parts; } catch { return bad(); }
  const out = new Map<string, Uint8Array>();
  for (const entry of Array.isArray(listed) ? listed as unknown[] : []) {
    const [name, length] = Array.isArray(entry) ? entry as unknown[] : [];
    if (typeof name !== 'string' || typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || at + length > bytes.length) bad();
    out.set(name as string, bytes.slice(at, at + (length as number)));
    at += length as number;
  }
  return out;
}

/** Whether this build has characters, for everything that shows or hides the page. */
let status: CharactersStatus | null = null, reading: Promise<void> | null = null;
const listeners = new Set<() => void>();
export function refreshCharactersStatus(): Promise<void> {
  reading ??= fetchCharactersStatus().then(next => { status = next; listeners.forEach(f => f()); }, () => { /* an older daemon, or none: as without the feature */ }).finally(() => { reading = null; });
  return reading;
}
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Null until it is known, and in a build without a cloud account. */
export function useCharactersStatus(): CharactersStatus | null {
  const value = useSyncExternalStore(subscribe, () => status, () => null), account = useOpenPixoAccount();
  const cloud = isCloudAccountAvailable(account.status), signedIn = Boolean(account.status?.signedIn);
  // signing in or out changes what may be shown
  useEffect(() => { if (cloud) void refreshCharactersStatus(); }, [cloud, signedIn]);
  return cloud ? value : null;
}
