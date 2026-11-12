import type { CharacterCard, CharacterListResponse, CharacterUpdateRequest, RecipeDetail, RecipeListResponse, RecipeRun, RecipeRunRequest, RecipeRunResponse } from '@openpixo/contracts';


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
export function startStudioRun(projectId: string, body: RecipeRunRequest) {
  return request<RecipeRunResponse>(`${projectUrl(projectId)}/recipe-runs`, { method: 'POST', body: JSON.stringify(body) });
}
export function getStudioRun(projectId: string, runId: string, signal?: AbortSignal) {
  return request<RecipeRun>(`${projectUrl(projectId)}/recipe-runs/${encodeURIComponent(runId)}`, { signal });
}
export function adoptStudioCandidates(projectId: string, runId: string, candidateIds: string[]) {
  return request<RecipeRun>(`${projectUrl(projectId)}/recipe-runs/${encodeURIComponent(runId)}/adopt`, { method: 'POST', body: JSON.stringify({ candidateIds }) });
}
