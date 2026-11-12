import type { ArtStyle, ProjectArtStyleResponse, StylesResponse } from '@openpixo/contracts';
import type { Locale } from '../i18n';

export const PROJECT_ART_STYLE_CHANGED = 'openpixo:project-art-style-changed';

async function request<T>(url: string, init: RequestInit, locale?: Locale): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(locale ? { 'Accept-Language': locale } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? `HTTP ${response.status}`);
  return body as T;
}

export async function listArtStyles(signal?: AbortSignal, locale?: Locale): Promise<ArtStyle[]> {
  return (await request<StylesResponse>('/api/styles', { signal }, locale)).styles;
}

export function getProjectArtStyle(projectId: string, signal?: AbortSignal, locale?: Locale) {
  return request<ProjectArtStyleResponse>(`/api/projects/${encodeURIComponent(projectId)}/art-style`, { signal }, locale);
}

export async function setProjectArtStyle(projectId: string, styleId: string | null, signal?: AbortSignal, locale?: Locale) {
  const result = await request<ProjectArtStyleResponse>(`/api/projects/${encodeURIComponent(projectId)}/art-style`, {
    method: 'PUT', body: JSON.stringify({ styleId }), signal,
  }, locale);
  window.dispatchEvent(new CustomEvent(PROJECT_ART_STYLE_CHANGED, { detail: { projectId } }));
  return result;
}

/** Records the image new art should match, or clears it with null. */
export async function setProjectStyleReference(projectId: string, path: string | null, signal?: AbortSignal, locale?: Locale) {
  const result = await request<ProjectArtStyleResponse>(`/api/projects/${encodeURIComponent(projectId)}/style-reference`, {
    method: 'PUT', body: JSON.stringify({ path }), signal,
  }, locale);
  window.dispatchEvent(new CustomEvent(PROJECT_ART_STYLE_CHANGED, { detail: { projectId } }));
  return result;
}
