import { useCallback, useEffect, useRef } from 'react';
import type { ProjectAsset, ProjectFile } from '@openpixo/contracts';
import { projectArtDimension } from './project-catalog';
import { studioProjectFacts, useCacheEntry } from './studio-cache';

const NO_ASSETS: ProjectAsset[] = [];

/** The project's engine and assets: shown from cache at once, re-read on open and when its files change. */
export function useStudioProject(projectId: string, files: ProjectFile[], enabled: boolean) {
  const entry = studioProjectFacts(projectId);
  const { value } = useCacheEntry(entry);
  const fileRevision = files.map(file => `${file.name}:${file.mtime}`).join('\n');
  const seenRevision = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    // A read already under way may predate the change, so it can't answer for it.
    const force = seenRevision.current !== null && seenRevision.current !== fileRevision;
    seenRevision.current = fileRevision;
    void entry.refresh({ force });
  }, [entry, enabled, fileRevision]);
  const retry = useCallback(() => { void entry.refresh({ force: true }); }, [entry]);
  const profile = value?.profile ?? null;
  const assets = value?.assets ?? NO_ASSETS;
  return {
    known: value !== null,
    loading: value === null,
    profile,
    assets,
    engineFailed: value?.engineFailed ?? false,
    dimension: projectArtDimension(profile, value?.templateId, assets),
    retry,
  };
}
