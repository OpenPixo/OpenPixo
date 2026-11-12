import type {
  GameEngineId,
  ProjectNextStepsResponse,
  PublishRequest,
  PublishStartResponse,
  PublishStatusResponse,
  RoomsStatusResponse,
  RoomsTestResponse,
} from '@openpixo/contracts';

/**
 * Daemon client for public game links and live rooms
 * (specs/current/publish-and-rooms.md). The daemon holds the cloud session; this
 * module only ever sees status, job progress and the URLs to show the creator.
 */
export class PublishRequestError extends Error {
  constructor(
    message: string,
    /** The API's error code, or null for transport and unknown failures. */
    readonly code: string | null,
    readonly status: number,
    /** The named offending paths when an upload was refused. */
    readonly refusedFiles?: string[],
  ) {
    super(message);
    this.name = 'PublishRequestError';
  }
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; refusedFiles?: unknown; details?: { refusedFiles?: unknown } | null };
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}

async function send(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught;
    throw new PublishRequestError(caught instanceof Error ? caught.message : 'Network error', null, 0);
  }
  const body = await response.json().catch(() => null) as unknown;
  if (response.ok) return body;
  const error = (body as ErrorBody | null)?.error;
  throw new PublishRequestError(
    typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
    typeof error?.code === 'string' ? error.code : null,
    response.status,
    stringList(error?.refusedFiles) ?? stringList(error?.details?.refusedFiles),
  );
}

async function read<T>(url: string, init: RequestInit | undefined, valid: (body: T) => boolean): Promise<T> {
  const body = await send(url, init) as T | null;
  if (body === null || typeof body !== 'object' || !valid(body)) throw new PublishRequestError('Invalid response', null, 200);
  return body;
}

const projectBase = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export function fetchPublishStatus(projectId: string, signal?: AbortSignal): Promise<PublishStatusResponse> {
  return read<PublishStatusResponse>(`${projectBase(projectId)}/publish`, { signal }, body => typeof body.available === 'boolean');
}

export function startPublish(projectId: string, request: PublishRequest): Promise<PublishStartResponse> {
  return read<PublishStartResponse>(`${projectBase(projectId)}/publish`, json('POST', request), body => typeof body.job?.id === 'string');
}

export async function removePublishedGame(projectId: string): Promise<void> {
  await send(`${projectBase(projectId)}/publish`, { method: 'DELETE' });
}

export function fetchRoomsStatus(projectId: string, signal?: AbortSignal): Promise<RoomsStatusResponse> {
  return read<RoomsStatusResponse>(`${projectBase(projectId)}/rooms`, { signal }, body => typeof body.sdkInstalled === 'boolean');
}

/** Callers re-read `fetchRoomsStatus` afterwards, so the answer's shape does not matter here. */
export async function updateRoomsLimit(projectId: string, monthlyCreditLimit: number): Promise<void> {
  await send(`${projectBase(projectId)}/rooms`, json('PATCH', { monthlyCreditLimit }));
}

export function startRoomsTest(projectId: string): Promise<RoomsTestResponse> {
  return read<RoomsTestResponse>(`${projectBase(projectId)}/rooms/test`, json('POST', {}), body => Array.isArray(body.urls) && body.urls.length === 2);
}

/** The engine as the daemon detects it now, for managed and imported projects alike. */
export async function fetchProjectEngine(projectId: string, signal?: AbortSignal): Promise<GameEngineId> {
  const body = await read<ProjectNextStepsResponse>(`${projectBase(projectId)}/next-steps`, { signal }, value => typeof value.engine === 'string');
  return body.engine;
}
