import type { AssetGridRequest, AssetListQuery, AssetListResponse, AssetOpReport, AssetOpRequest, AssetProvenanceResponse, AssetTagsRequest, AssetWaveform, ChatRunStatusResponse, EditProjectImageRequest, ProjectAsset } from '@openpixo/contracts';


const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export function assetListQuery(query: AssetListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...({}), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? body?.message ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function listProjectAssets(projectId: string, query: AssetListQuery, signal?: AbortSignal) {
  return request<AssetListResponse>(`${base(projectId)}/assets?${assetListQuery(query)}`, { signal });
}

export function fetchAssetDetail(projectId: string, path: string, signal?: AbortSignal) {
  const suffix = `?${new URLSearchParams({ path })}`;
  return Promise.all([
    request<ProjectAsset>(`${base(projectId)}/assets/info${suffix}`, { signal }),
    request<AssetProvenanceResponse>(`${base(projectId)}/assets/provenance${suffix}`, { signal }),
  ]);
}

/** One indexed asset (dimensions + sprite / grid semantics), without its provenance history. */
export function fetchAssetInfo(projectId: string, path: string, signal?: AbortSignal) {
  return request<ProjectAsset>(`${base(projectId)}/assets/info?${new URLSearchParams({ path })}`, { signal });
}

export function assetThumbnailUrl(projectId: string, asset: Pick<ProjectAsset, 'relPath' | 'mtime'>, size: 256 | 1024) {
  return `${base(projectId)}/assets/thumb?${new URLSearchParams({ path: asset.relPath, size: String(size), v: String(asset.mtime) })}`;
}

export function fetchAssetWaveform(projectId: string, path: string, signal?: AbortSignal) {
  return request<AssetWaveform>(`${base(projectId)}/assets/waveform?${new URLSearchParams({ path })}`, { signal });
}

export function updateAssetTags(projectId: string, body: AssetTagsRequest) {
  return request<AssetListResponse>(`${base(projectId)}/assets/tags`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateAssetGrid(projectId: string, body: AssetGridRequest) {
  return request<ProjectAsset>(`${base(projectId)}/assets/grid`, { method: 'PUT', body: JSON.stringify(body) });
}

export function processProjectAssets(projectId: string, body: AssetOpRequest) {
  return request<AssetOpReport>(`${base(projectId)}/asset-ops`, { method: 'POST', body: JSON.stringify(body) });
}

export function editProjectImage(projectId: string, body: EditProjectImageRequest) {
  return request<ProjectAsset>(`${base(projectId)}/assets/edit`, { method: 'POST', body: JSON.stringify(body) });
}

export function fetchAssetRun(runId: string, signal?: AbortSignal) {
  return request<ChatRunStatusResponse>(`/api/runs/${encodeURIComponent(runId)}`, { signal });
}
