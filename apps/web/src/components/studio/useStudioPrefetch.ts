import { useEffect } from 'react';
import { isCloudAccountAvailable, useOpenPixoAccount } from '../../hooks/useOpenPixoAccount';
import { useProjectPreviewContext } from '../project-preview-context';
import { prefetchStudioProject, studioServices } from './studio-cache';

const IDLE_TIMEOUT_MS = 2000;
const NO_IDLE_CALLBACK_DELAY_MS = 200;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function whenIdle(run: () => void): () => void {
  const target = window as IdleWindow;
  if (typeof target.requestIdleCallback === 'function') {
    const handle = target.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => target.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(run, NO_IDLE_CALLBACK_DELAY_MS);
  return () => clearTimeout(timer);
}

/**
 * Fills the Generate sheet's cache when a project opens, while nothing else is
 * going on, so the first click on Generate already has its content. A failed
 * read stays silent here; the sheet asks again when it opens.
 */
export function useStudioPrefetch(projectId: string | null) {
  const { projectResourceAuthority } = useProjectPreviewContext();
  const readable = projectResourceAuthority !== 'pending' && projectResourceAuthority !== 'denied';
  const hosted = isCloudAccountAvailable(useOpenPixoAccount().status);
  useEffect(() => {
    if (!readable || !projectId) return;
    return whenIdle(() => { void prefetchStudioProject(projectId); });
  }, [projectId, readable]);
  useEffect(() => {
    if (!hosted) return;
    return whenIdle(() => { void studioServices().refresh(); });
  }, [hosted]);
}
