import type { GameRunStatus, GameTuningListResponse, GameTuningSetRequest, GameTuningSetResponse } from '@openpixo/contracts';

export class TuningRequestError extends Error {
  constructor(readonly code: string) { super(code); }
}
export async function tuningRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new TuningRequestError(body?.error?.code ?? 'TUNING_READ_FAILED');
  }
  return response.json() as Promise<T>;
}
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/game`;
export const listGameTuning = (projectId: string, signal: AbortSignal) => tuningRequest<GameTuningListResponse>(`${base(projectId)}/tuning`, { signal });
export const updateGameTuning = (projectId: string, request: GameTuningSetRequest, signal: AbortSignal) =>
  tuningRequest<GameTuningSetResponse>(`${base(projectId)}/tuning`, { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
export const readTuningGameRun = (projectId: string, signal?: AbortSignal) => tuningRequest<GameRunStatus>(`${base(projectId)}/run`, { signal });

export function tuningPreviewUrl(run: GameRunStatus): string | null {
  if (run.status !== 'running' || run.engine === 'godot' || !run.url) return null;
  try {
    const url = new URL(run.url);
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
