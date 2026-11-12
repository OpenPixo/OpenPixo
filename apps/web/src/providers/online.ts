import type { OnlineDataResponse, OnlineSeedRequest, OnlineSeedResponse, OnlineStatusResponse, OnlineTestResponse } from '@openpixo/contracts';

import { PublishRequestError } from './publish';

/**
 * Daemon client for a game's online features (specs/current/online-features.md). The same
 * routes back `pixo online`. Failures throw `PublishRequestError`, so the Share dialog reads
 * them like its other errors.
 */

async function send(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught;
    throw new PublishRequestError(caught instanceof Error ? caught.message : 'Network error', null, 0);
  }
  const body = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
  if (response.ok) return body;
  const error = body?.error;
  throw new PublishRequestError(typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
    typeof error?.code === 'string' ? error.code : null, response.status);
}

async function read<T>(url: string, init: RequestInit | undefined, valid: (body: T) => boolean): Promise<T> {
  const body = await send(url, init) as T | null;
  if (body === null || typeof body !== 'object' || !valid(body)) throw new PublishRequestError('Invalid response', null, 200);
  return body;
}

const online = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/online`;
const isCounts = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function fetchOnlineStatus(projectId: string, signal?: AbortSignal): Promise<OnlineStatusResponse> {
  return read<OnlineStatusResponse>(online(projectId), { signal },
    body => typeof body.sdkInstalled === 'boolean' && typeof body.local?.players === 'number' && isCounts(body.local.collections));
}

export function startOnlineTest(projectId: string): Promise<OnlineTestResponse> {
  return read<OnlineTestResponse>(`${online(projectId)}/test`, { method: 'POST', body: '{}' }, body => typeof body.url === 'string');
}

export function seedOnlinePlayers(projectId: string, request: OnlineSeedRequest): Promise<OnlineSeedResponse> {
  return read<OnlineSeedResponse>(`${online(projectId)}/seed`, { method: 'POST', body: JSON.stringify(request) },
    body => typeof body.players === 'number' && typeof body.docs === 'number');
}

export function resetOnlineTestData(projectId: string): Promise<OnlineDataResponse> {
  return read<OnlineDataResponse>(`${online(projectId)}/data`, { method: 'DELETE' }, body => typeof body.players === 'number');
}

/** Deletes every player and save of the published game. The daemon accepts this only from the creator. */
export async function clearHostedOnlineData(projectId: string): Promise<void> {
  await send(`${online(projectId)}/hosted`, { method: 'DELETE' });
}
