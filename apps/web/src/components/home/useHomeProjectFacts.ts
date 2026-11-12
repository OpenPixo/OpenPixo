import { useEffect, useState } from 'react';
import { assetThumbnailUrl, listProjectAssets } from '../../providers/project-assets';
import { STARTER_FACTS_CHANGED_EVENT } from '../project-start/events';

interface Facts {
  projectId: string | null;
  thumbnail?: string;
}

/** The first image in the project is its picture on Home. */
async function readThumbnail(projectId: string, signal: AbortSignal): Promise<string | undefined> {
  const result = await listProjectAssets(projectId, { kind: 'all', limit: 500 }, signal);
  const image = Array.isArray(result?.assets) ? result.assets.find(asset => asset.kind === 'image') : undefined;
  return image && assetThumbnailUrl(projectId, image, 256);
}

export function useHomeProjectFacts(projectId: string | null, updatedAt?: number): Facts {
  const [facts, setFacts] = useState<Facts>({ projectId });
  useEffect(() => {
    if (!projectId) return;
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setFacts({ projectId });
      void readThumbnail(projectId, request.signal).then(thumbnail => {
        if (!request.signal.aborted) setFacts({ projectId, thumbnail });
      }).catch(() => {});
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(STARTER_FACTS_CHANGED_EVENT, changed);
    return () => {
      controller?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener(STARTER_FACTS_CHANGED_EVENT, changed);
    };
  }, [projectId, updatedAt]);
  return facts.projectId === projectId ? facts : { projectId };
}
