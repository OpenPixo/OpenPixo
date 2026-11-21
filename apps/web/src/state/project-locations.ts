import type {
  ProjectLocation,
  ProjectLocationRefusal,
  ProjectLocationRefusalReason,
  ProjectLocationsResponse,
  ScanProjectLocationsResponse,
  UpdateProjectLocationsRequest,
} from '@openpixo/contracts';

export async function fetchProjectLocations(): Promise<ProjectLocation[]> {
  try {
    const resp = await fetch('/api/project-locations');
    if (!resp.ok) return [];
    const json = (await resp.json()) as ProjectLocationsResponse;
    return Array.isArray(json.locations) ? json.locations : [];
  } catch {
    return [];
  }
}

export type UpdateProjectLocationsResult =
  | { ok: true; locations: ProjectLocation[] }
  | { ok: false; refusal: ProjectLocationRefusal | null };

const REFUSAL_REASONS: ReadonlySet<string> = new Set<ProjectLocationRefusalReason>([
  'not-absolute',
  'not-accessible',
  'not-a-folder',
  'drive-root',
  'system-folder',
  'openpixo-data',
]);

/** Reads the daemon's `ProjectLocationRefusal` from an error body; null when it has none. */
export function projectLocationRefusalFromBody(body: unknown): ProjectLocationRefusal | null {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  if (!details || typeof details !== 'object') return null;
  const { reason, path, systemCode } = details as Record<string, unknown>;
  if (typeof reason !== 'string' || !REFUSAL_REASONS.has(reason) || typeof path !== 'string') return null;
  return {
    reason: reason as ProjectLocationRefusalReason,
    path,
    ...(typeof systemCode === 'string' && systemCode ? { systemCode } : {}),
  };
}

export async function updateProjectLocations(
  locations: UpdateProjectLocationsRequest['locations'],
): Promise<UpdateProjectLocationsResult> {
  try {
    const resp = await fetch('/api/project-locations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations }),
    });
    if (!resp.ok) {
      const body: unknown = await resp.json().catch(() => null);
      return { ok: false, refusal: projectLocationRefusalFromBody(body) };
    }
    const json = (await resp.json()) as ProjectLocationsResponse;
    return { ok: true, locations: Array.isArray(json.locations) ? json.locations : [] };
  } catch {
    return { ok: false, refusal: null };
  }
}

export async function scanProjectLocations(): Promise<ScanProjectLocationsResponse | null> {
  try {
    const resp = await fetch('/api/project-locations/scan', { method: 'POST' });
    if (!resp.ok) return null;
    return (await resp.json()) as ScanProjectLocationsResponse;
  } catch {
    return null;
  }
}

export async function openProjectLocationFolderDialog(): Promise<string | null> {
  try {
    const resp = await fetch('/api/dialog/open-folder', { method: 'POST' });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { path?: string | null };
    return typeof json.path === 'string' && json.path.trim() ? json.path : null;
  } catch {
    return null;
  }
}
