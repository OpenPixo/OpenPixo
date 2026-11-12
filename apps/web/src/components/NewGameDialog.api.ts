import type { CreateGameFromTemplateRequest, CreateGameFromTemplateResponse } from '@openpixo/contracts';
import { GameTemplateRequestError } from '../state/game-templates';

/** Creation retains its domain reason while keeping the common HTTP error code intact. */
export async function createGameFromTemplate(input: CreateGameFromTemplateRequest, token?: string): Promise<CreateGameFromTemplateResponse> {
  const response = await fetch('/api/projects/game-from-template', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-pixo-desktop-import-token': token } : {}) },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new GameTemplateRequestError(body?.error?.message ?? '', response.status,
    body?.error?.details?.reasonCode ?? body?.error?.code);
  return body as CreateGameFromTemplateResponse;
}
