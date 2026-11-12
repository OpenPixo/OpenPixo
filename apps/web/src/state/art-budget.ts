import type { ApproveArtRequest, ArtBudgetResponse, ArtSpendingMode, SetArtBudgetRequest } from '@openpixo/contracts';

/** The same endpoints as `pixo game plan budget`. */
function route(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/art-budget`;
}

/** A refusal from the art budget routes, with the daemon's error code for plain-words copy. */
export class ArtBudgetRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'ArtBudgetRequestError';
  }
}

export async function fetchArtBudget(projectId: string, signal?: AbortSignal): Promise<ArtBudgetResponse> {
  const response = await fetch(route(projectId), { cache: 'no-store', ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(`Reading the art budget failed (${response.status})`);
  return await response.json() as ArtBudgetResponse;
}

async function post(url: string, request: unknown, what: string): Promise<ArtBudgetResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => ({})) as ArtBudgetResponse & { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new ArtBudgetRequestError(body.error?.message ?? `${what} failed (${response.status})`, response.status, body.error?.code ?? null);
  }
  return body;
}

/** Change the budget, the spending mode, or both; either may be left out, not both. */
export async function setArtBudget(projectId: string, change: number | SetArtBudgetRequest): Promise<ArtBudgetResponse> {
  const request: SetArtBudgetRequest = typeof change === 'number' ? { credits: change } : change;
  return await post(route(projectId), request, 'Changing the art budget');
}

export async function setArtSpendingMode(projectId: string, mode: ArtSpendingMode): Promise<ArtBudgetResponse> {
  return await setArtBudget(projectId, { mode });
}

/** The user's click on an art card's Approve. */
export async function approveArt(projectId: string, credits: number): Promise<ArtBudgetResponse> {
  const request: ApproveArtRequest = { credits };
  return await post(`${route(projectId)}/approve`, request, 'Approving the art');
}

/** A reply is the budget state when it carries the fields every state has. */
export function isArtBudgetResponse(value: unknown): value is ArtBudgetResponse {
  return Boolean(value) && typeof value === 'object' && 'budget' in (value as object) && 'runActive' in (value as object);
}
