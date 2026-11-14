import type { CharacterCard, CharacterListResponse, CharacterUpdateRequest, GenerateReferenceResponse, RecipeDetail, RecipeListResponse, RecipeQuoteRequest, RecipeRun, RecipeRunListResponse, RecipeRunQuote, RecipeRunRequest, RecipeRunResponse } from '@openpixo/contracts';


export class StudioRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

const projectUrl = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...({}), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const body = await response.json();
  // Code recipes return their actionable result with HTTP 409.
  if (!response.ok && !(response.status === 409 && body.status === 'missing-skills')) {
    throw new StudioRequestError(body.error?.message ?? body.message ?? `HTTP ${response.status}`, body.error?.code ?? body.code);
  }
  return body as T;
}

export function listStudioRecipes(signal?: AbortSignal) {
  return request<RecipeListResponse>('/api/recipes', { signal });
}
export function getStudioRecipe(id: string, signal?: AbortSignal) {
  return request<RecipeDetail>(`/api/recipes/${encodeURIComponent(id)}`, { signal });
}
export function listStudioCharacters(projectId: string, signal?: AbortSignal) {
  return request<CharacterListResponse>(`${projectUrl(projectId)}/characters`, { signal });
}
export function saveStudioCharacter(projectId: string, card: CharacterCard, slug: string | undefined) {
  const { slug: _slug, ...update } = card;
  const body: CharacterCard | CharacterUpdateRequest = slug ? update : card;
  return request<CharacterCard>(`${projectUrl(projectId)}/characters${slug ? `/${encodeURIComponent(slug)}` : ''}`, { method: slug ? 'PUT' : 'POST', body: JSON.stringify(body) });
}
/*
 * 生成 runs, quotes and saving go through `/api/generate/*` (the same runs the per-game
 * routes serve), with the game in the body: `projectId` null makes art for no game.
 */
const GENERATE = '/api/generate';
const runUrl = (runId: string) => `${GENERATE}/runs/${encodeURIComponent(runId)}`;

export function startStudioRun(projectId: string | null, body: RecipeRunRequest) {
  return request<RecipeRunResponse>(`${GENERATE}/runs`, { method: 'POST', body: JSON.stringify({ ...body, projectId }) });
}
/** Prices a run for the user to confirm; `paid: false` means their own tool makes it. Nothing is spent. */
export function quoteStudioRun(projectId: string | null, body: RecipeQuoteRequest) {
  return request<RecipeRunQuote>(`${GENERATE}/quote`, { method: 'POST', body: JSON.stringify({ ...body, projectId }) });
}
/** Runs on this machine, newest first, the user's and the agent's: one game's, or every run when no game is given. */
export function listStudioRuns(projectId: string | null, signal?: AbortSignal) {
  return request<RecipeRunListResponse>(`${GENERATE}/runs${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`, { signal });
}
export function getStudioRun(runId: string, signal?: AbortSignal) {
  return request<RecipeRun>(runUrl(runId), { signal });
}
/** Saves candidates into a game: the run's own, or any game for a run made with no game. */
export function adoptStudioCandidates(projectId: string, runId: string, candidateIds: string[]) {
  return request<RecipeRun>(`${runUrl(runId)}/adopt`, { method: 'POST', body: JSON.stringify({ projectId, candidateIds }) });
}
/** One staged file of a candidate, whichever game its run is for. */
export function stagedCandidateFileUrl(runId: string, candidateId: string, index: number): string {
  return `${runUrl(runId)}/candidates/${encodeURIComponent(candidateId)}/files/${index}`;
}
/** Uploads a picture a run with no game can use as a reference; a game's runs use the game's own files. */
export async function uploadGenerateReference(file: File): Promise<GenerateReferenceResponse> {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch(`${GENERATE}/references`, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string } } & Partial<GenerateReferenceResponse>;
  if (!response.ok) throw new StudioRequestError(body.error?.message ?? `HTTP ${response.status}`, body.error?.code);
  return body as GenerateReferenceResponse;
}
