import type {
  StoreCatalogQuery, StoreCatalogResponse, StoreInstallRequest, StoreInstallResponse, StoreItemDetail,
  StorePurchaseRequest, StorePurchaseResponse,
} from '@openpixo/contracts';
import { navigate } from '../router';

export const WORKSHOP_KINDS = ['skill', 'mcp', 'project-template', 'asset-pack'] as const;
export type WorkshopKind = typeof WORKSHOP_KINDS[number];

export function isWorkshopItem<T extends { kind: string }>(item: T): item is T & { kind: WorkshopKind } {
  return WORKSHOP_KINDS.some(kind => kind === item.kind);
}

export function isGenerateKind(kind: string): boolean {
  return kind === 'style' || kind === 'recipe' || kind === 'character-card';
}

interface WorkshopProject { id: string; name: string; updatedAt?: number | string; createdAt?: number | string }

export function mostRecentStoreProject<T extends WorkshopProject>(projects: T[]): T | undefined {
  return projects.reduce<T | undefined>((latest, project) => {
    if (!latest) return project;
    const updatedValue = project.updatedAt ?? project.createdAt;
    const updated = typeof updatedValue === 'number' ? updatedValue : Date.parse(updatedValue ?? '') || 0;
    const previousValue = latest.updatedAt ?? latest.createdAt;
    const previous = typeof previousValue === 'number' ? previousValue : Date.parse(previousValue ?? '') || 0;
    return updated > previous ? project : latest;
  }, undefined);
}

export function openProjectGenerate(project: Pick<WorkshopProject, 'id'>, replace = false): void {
  navigate({ kind: 'project', projectId: project.id, fileName: null, workspaceTab: 'generate' }, { replace });
}

/** A failed Workshop request, carrying the daemon's error code so the UI can pick a state instead of parsing text. */
export class StoreRequestError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number) {
    super(message);
    this.name = 'StoreRequestError';
  }
}

export function storeErrorCode(error: unknown): string | null {
  return error instanceof StoreRequestError ? error.code : null;
}

async function storeRequest<T>(route: string, body?: StoreInstallRequest | StorePurchaseRequest): Promise<T> {
  const response = await fetch(route, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  const result = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } | string } | null;
  if (!response.ok) {
    const error = typeof result?.error === 'object' ? result.error : undefined;
    const message = typeof error?.message === 'string' ? error.message
      : typeof result?.error === 'string' ? result.error : 'Request failed (' + response.status + ')';
    throw new StoreRequestError(message, typeof error?.code === 'string' ? error.code : null, response.status);
  }
  return result as T;
}

export function fetchStoreCatalog(query: StoreCatalogQuery, locale?: string): Promise<StoreCatalogResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  if (locale) params.set('locale', locale);
  return storeRequest('/api/store/catalog' + (params.size ? '?' + params : ''));
}

export function fetchStoreItem(name: string, locale?: string): Promise<StoreItemDetail> {
  return storeRequest('/api/store/items/' + encodeURIComponent(name) + (locale ? '?locale=' + encodeURIComponent(locale) : ''));
}

export function installStoreItem(body: StoreInstallRequest): Promise<StoreInstallResponse> {
  return storeRequest('/api/store/install', body);
}

/** Spends credits on a paid item. The daemon prices it; the client never sends an amount. */
export function purchaseStoreItem(body: StorePurchaseRequest): Promise<StorePurchaseResponse> {
  return storeRequest('/api/store/purchase', body);
}
