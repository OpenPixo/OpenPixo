import { redactSecrets } from '../redact.js';

const MAX_MEDIA_ERROR_LOG_LENGTH = 2_000;
const MAX_MEDIA_DETAIL_LOG_LENGTH = 300;

export interface MediaTaskDiagnosticInput {
  code?: string | undefined;
  /**
   * The provider's own short reason, when its error carries one (`logDetail`).
   * Log only: it never reaches task state, the CLI or the UI.
   */
  detail?: string | undefined;
  elapsedMs?: number | undefined;
  error?: string | undefined;
  event: 'queued' | 'done' | 'failed';
  fileSize?: number | undefined;
  hasCompositionDir?: boolean | undefined;
  mime?: string | undefined;
  model: string;
  projectId: string;
  providerId?: string | undefined;
  runId?: string | undefined;
  referenceImageCount?: number | undefined;
  status?: number | string | undefined;
  surface: string;
  taskId: string;
}

function oneLine(text: string, limit: number): string {
  return redactSecrets(text).replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** The log-only reason a provider error carries, if any. */
export function mediaFailureLogDetail(err: unknown): string | undefined {
  const detail = (err as { logDetail?: unknown } | null | undefined)?.logDetail;
  return typeof detail === 'string' && detail.trim() ? detail : undefined;
}

export function formatMediaTaskDiagnostic(
  input: MediaTaskDiagnosticInput,
): string {
  const diagnostic = {
    event: input.event,
    task_id: input.taskId,
    run_id: input.runId ?? null,
    project_id: input.projectId,
    surface: input.surface,
    model_id: input.model,
    provider_id: input.providerId ?? null,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.code ? { code: input.code } : {}),
    ...(input.elapsedMs !== undefined
      ? { elapsed_ms: Math.max(0, Math.round(input.elapsedMs)) }
      : {}),
    ...(input.referenceImageCount !== undefined
      ? { reference_image_count: Math.max(0, Math.round(input.referenceImageCount)) }
      : {}),
    ...(input.hasCompositionDir !== undefined
      ? { has_composition_dir: input.hasCompositionDir }
      : {}),
    ...(input.fileSize !== undefined
      ? { file_size: Math.max(0, Math.round(input.fileSize)) }
      : {}),
    ...(input.mime ? { mime: input.mime } : {}),
    ...(input.error
      ? {
          error: oneLine(input.error, MAX_MEDIA_ERROR_LOG_LENGTH),
        }
      : {}),
    ...(input.detail
      ? { detail: oneLine(input.detail, MAX_MEDIA_DETAIL_LOG_LENGTH) }
      : {}),
  };
  return `[media] ${JSON.stringify(diagnostic)}`;
}
