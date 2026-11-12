import type {
  CheckGameTargetRequest,
  CheckGameTargetResponse,
  CreateGameFromTemplateRequest,
  GameTemplatesResponse,
  ImportFolderResponse,
} from '@openpixo/contracts';

/** A refused request, keeping the daemon's error code for callers that map it. */
export class GameTemplateRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'GameTemplateRequestError';
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new GameTemplateRequestError(
      body?.error?.message ?? `Game template request failed (${response.status})`,
      response.status,
      typeof body?.error?.code === 'string' ? body.error.code : undefined,
    );
  }
  return body as T;
}

function tokenHeader(token: string | undefined): Record<string, string> {
  return token ? { 'x-pixo-desktop-import-token': token } : {};
}

export async function fetchGameTemplates(signal?: AbortSignal): Promise<GameTemplatesResponse> {
  return readResponse(await fetch('/api/game-templates', { signal }));
}

/** Preflight a target folder. Never writes and never spends the picker token. */
export async function checkGameTarget(
  input: CheckGameTargetRequest,
  token: string | undefined,
  signal?: AbortSignal,
): Promise<CheckGameTargetResponse> {
  return readResponse(await fetch('/api/projects/game-from-template/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tokenHeader(token) },
    body: JSON.stringify(input),
    signal,
  }));
}

export async function createGameFromTemplate(
  input: CreateGameFromTemplateRequest,
  token: string | undefined
): Promise<ImportFolderResponse> {
  return readResponse<ImportFolderResponse>(await fetch('/api/projects/game-from-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tokenHeader(token) },
    body: JSON.stringify(input),
  }));
}
