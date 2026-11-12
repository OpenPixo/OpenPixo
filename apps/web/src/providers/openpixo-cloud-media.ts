import type {
  MediaGenerationRequest, OpenPixoGenerationParams, OpenPixoGenerationQuote, OpenPixoGenerationServicesResponse,
  OpenPixoMediaGenerationFields,
} from '@openpixo/contracts';
import { OpenPixoAccountRequestError } from './openpixo-account';

/**
 * Hosted generation paid with credits. Quotes come from the daemon's cloud-media
 * routes; spending happens only through the shared media generate route with the
 * quote the user just confirmed and a request id reused by every retry.
 */
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined });
  const body = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown; reason?: unknown } | string } | null;
  if (!response.ok) {
    const error = typeof body?.error === 'object' ? body.error : null;
    throw new OpenPixoAccountRequestError(typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
      typeof error?.code === 'string' ? error.code as OpenPixoAccountRequestError['code'] : null, response.status,
      undefined, error?.reason === 'service' ? 'service' : undefined);
  }
  return body as T;
}

export const fetchCloudMediaServices = (signal?: AbortSignal) =>
  json<OpenPixoGenerationServicesResponse>('/api/openpixo/cloud-media/services', { signal });

/** Quotes through the project so reference images are uploaded and priced exactly as generate will send them. */
export const quoteCloudMedia = (projectId: string, service: string, params: OpenPixoGenerationParams, images: string[] = []) =>
  json<OpenPixoGenerationQuote>(`/api/projects/${encodeURIComponent(projectId)}/media/openpixo-quote`, { method: 'POST',
    body: JSON.stringify({ service, prompt: params.prompt, ...(params.aspect ? { aspect: params.aspect } : {}),
      ...(params.style ? { style: params.style } : {}), ...(params.duration !== undefined ? { duration: params.duration } : {}), images }) });

export function generateCloudMedia(projectId: string, request: { service: string; surface?: 'image' | 'audio' | 'model3d'; params: OpenPixoGenerationParams; output: string; images?: string[] } & Omit<OpenPixoMediaGenerationFields, 'style'>) {
  const body: MediaGenerationRequest & OpenPixoMediaGenerationFields = {
    surface: request.surface ?? 'image', model: request.service, prompt: request.params.prompt, output: request.output,
    ...(request.params.aspect ? { aspect: request.params.aspect } : {}), ...(request.params.style ? { style: request.params.style } : {}),
    ...(request.params.duration !== undefined ? { duration: request.params.duration } : {}),
    ...(request.images?.length ? { images: request.images } : {}),
    quoteId: request.quoteId, cloudRequestId: request.cloudRequestId,
  };
  return json<{ taskId: string }>(`/api/projects/${encodeURIComponent(projectId)}/media/generate`, { method: 'POST', body: JSON.stringify(body) });
}

export interface MediaTaskWait {
  status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted';
  progress: string[];
  nextSince: number;
  file?: { name?: string; creditsCharged?: number } | null;
  error?: { message?: string; code?: string } | null;
}

export const waitMediaTask = (taskId: string, since: number, signal?: AbortSignal) =>
  json<MediaTaskWait>(`/api/media/tasks/${encodeURIComponent(taskId)}/wait`,
    { method: 'POST', body: JSON.stringify({ since, timeoutMs: 4000 }), signal });
