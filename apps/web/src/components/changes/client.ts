import type {
  CheckpointFileSide,
  GetProjectCheckpointDiffResponse,
  GetProjectCheckpointFileDiffResponse,
} from '@openpixo/contracts';
import { CheckpointRequestError } from '../checkpoints/client';

function base(projectId: string, checkpointId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/checkpoints/${encodeURIComponent(checkpointId)}`;
}

async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(60_000) });
  const result = await response.json();
  if (!response.ok) throw new CheckpointRequestError(result.error?.code ?? result.code ?? 'CHECKPOINT_FAILED');
  return result as T;
}

/** One file the run changed: the run start against its end (or the current files while it runs). */
export function fetchCheckpointFileDiff(projectId: string, checkpointId: string, path: string, signal?: AbortSignal) {
  return request<GetProjectCheckpointFileDiffResponse>(`${base(projectId, checkpointId)}/diff?path=${encodeURIComponent(path)}`, signal);
}

/** Every file the run changed, with line counts. */
export function fetchCheckpointDiff(projectId: string, checkpointId: string, signal?: AbortSignal) {
  return request<GetProjectCheckpointDiffResponse>(`${base(projectId, checkpointId)}/diff`, signal);
}

/** Raw bytes of one side of a changed file, for `<img>`. */
export function checkpointFileUrl(projectId: string, checkpointId: string, path: string, side: CheckpointFileSide): string {
  return `${base(projectId, checkpointId)}/file?path=${encodeURIComponent(path)}&side=${side}`;
}
