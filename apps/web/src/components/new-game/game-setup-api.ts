import type { GameProjectSetup, GameProjectSetupResponse } from '@openpixo/contracts';
import { referencePath, type WizardReference } from './wizard-state';

/** Same endpoint as `pixo project game-setup`. */
const endpoint = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/game-setup`;

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body as T;
}

export async function fetchGameSetup(projectId: string, signal?: AbortSignal): Promise<GameProjectSetupResponse> {
  return json(await fetch(endpoint(projectId), { signal, headers: { Accept: 'application/json' } }));
}

export async function saveGameSetup(projectId: string, setup: GameProjectSetup | null): Promise<GameProjectSetupResponse> {
  return json(await fetch(endpoint(projectId), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setup }),
  }));
}

/**
 * Write reference images into the project through the ordinary file upload,
 * so they live in the game's own folder. Returns the paths that were written;
 * a failed image is skipped rather than failing the whole setup.
 */
export async function uploadReferences(projectId: string, references: readonly WizardReference[]): Promise<{ paths: string[]; failed: number }> {
  const paths: string[] = [];
  let failed = 0;
  for (const [index, reference] of references.entries()) {
    const name = referencePath(reference.file, index);
    const form = new FormData();
    form.append('file', reference.file, reference.file.name);
    form.append('name', name);
    try {
      const body = await json<{ file?: { name?: string } }>(await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, { method: 'POST', body: form }));
      paths.push(body.file?.name ?? name);
    } catch {
      failed++;
    }
  }
  return { paths, failed };
}
