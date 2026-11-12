import type { EnableProjectCheckpointsResponse, GetProjectCheckpointResponse, ListProjectCheckpointsResponse, RestoreProjectCheckpointResponse } from '@openpixo/contracts';

export const CHECKPOINTS_CHANGED = 'pixo:checkpoints-changed';
export const CHECKPOINT_RESTORED = 'pixo:checkpoint-restored';
const lists = new Map<string, { pending: boolean; at: number; promise: Promise<ListProjectCheckpointsResponse> }>();

function trimLists() {
  for (const [key, entry] of lists) {
    if (lists.size <= 32) break;
    if (!entry.pending) lists.delete(key);
  }
}

export class CheckpointRequestError extends Error {
  constructor(readonly code: string) { super(code); }
}

function base(projectId: string) { return `/api/projects/${encodeURIComponent(projectId)}/checkpoints`; }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(60_000) });
  const result = await response.json();
  if (!response.ok) throw new CheckpointRequestError(result.error?.code ?? result.code ?? 'CHECKPOINT_FAILED');
  return result as T;
}

/** The last list each project answered with, kept for `lastProjectCheckpoints`. */
const lastLists = new Map<string, ListProjectCheckpointsResponse>();

export function listProjectCheckpoints(projectId: string, fresh = false): Promise<ListProjectCheckpointsResponse> {
  const previous = lists.get(projectId);
  if (previous && (previous.pending || (!fresh && Date.now() - previous.at < 2_000))) return previous.promise;
  const entry = { pending: true, at: Date.now(), promise: request<ListProjectCheckpointsResponse>(base(projectId)) };
  lists.set(projectId, entry);
  void entry.promise.then((data) => {
    entry.pending = false;
    lastLists.delete(projectId);
    lastLists.set(projectId, data);
    for (const key of lastLists.keys()) { if (lastLists.size <= 8) break; lastLists.delete(key); }
    trimLists();
  }, () => { if (lists.get(projectId) === entry) lists.delete(projectId); });
  return entry.promise;
}

/**
 * The project's last answered list, to draw with while a fresh read is on its
 * way. Switching conversations remounts every message; without it each one
 * draws once with no checkpoint and again when the list arrives, and the
 * images that come with a checkpoint push the conversation down under the
 * reader.
 */
export function lastProjectCheckpoints(projectId: string): ListProjectCheckpointsResponse | undefined {
  return lastLists.get(projectId);
}

export function getProjectCheckpoint(projectId: string, id: string, signal?: AbortSignal) {
  return request<GetProjectCheckpointResponse>(`${base(projectId)}/${encodeURIComponent(id)}`, { signal });
}

/** Tell open checkpoint lists, and with `restored` the file views, that the project changed. */
export function checkpointsChanged(projectId: string, restored = false) {
  lists.delete(projectId);
  window.dispatchEvent(new CustomEvent(CHECKPOINTS_CHANGED, { detail: { projectId } }));
  if (restored) window.dispatchEvent(new CustomEvent(CHECKPOINT_RESTORED, { detail: { projectId } }));
}

export async function restoreProjectCheckpoint(projectId: string, id: string) {
  const result = await request<RestoreProjectCheckpointResponse>(`${base(projectId)}/${encodeURIComponent(id)}/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
  });
  checkpointsChanged(projectId, true);
  return result;
}

export async function enableProjectCheckpoints(projectId: string) {
  const result = await request<EnableProjectCheckpointsResponse>(`${base(projectId)}/enable`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
  });
  checkpointsChanged(projectId);
  return result;
}
