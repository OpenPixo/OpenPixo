import { useEffect, useState } from 'react';
import type { ListProjectCheckpointsResponse } from '@openpixo/contracts';
import { CHECKPOINTS_CHANGED, lastProjectCheckpoints, listProjectCheckpoints } from './client';

/**
 * Deduplicated project reads; only an active run keeps the list polling.
 * `poll: false` reads once and follows `CHECKPOINTS_CHANGED` only; `refreshKey`
 * re-reads when it changes (a run starting or stopping).
 */
export function useProjectCheckpoints(
  projectId: string,
  enabled = true,
  { poll = true, refreshKey }: { poll?: boolean; refreshKey?: string | null | undefined } = {},
): { projectId: string; data?: ListProjectCheckpointsResponse; failed?: boolean } {
  // Start from the project's last answer (if any) so a remount draws its final
  // layout at once; the read below still replaces it.
  const [state, setState] = useState<{ projectId: string; data?: ListProjectCheckpointsResponse; failed?: boolean }>(
    () => ({ projectId, data: enabled ? lastProjectCheckpoints(projectId) : undefined }),
  );
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async (fresh: boolean) => {
      clearTimeout(timer);
      const requestGeneration = ++generation;
      try {
        const data = await listProjectCheckpoints(projectId, fresh);
        if (!active || requestGeneration !== generation) return;
        setState({ projectId, data });
        if (poll && data.status === 'available' && data.busy) timer = setTimeout(() => void refresh(true), 1_000);
      } catch { if (active && requestGeneration === generation) setState({ projectId, failed: true }); }
    };
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail.projectId === projectId) void refresh(true);
    };
    void refresh(poll);
    window.addEventListener(CHECKPOINTS_CHANGED, onChanged);
    return () => { active = false; clearTimeout(timer); window.removeEventListener(CHECKPOINTS_CHANGED, onChanged); };
  }, [projectId, enabled, poll, refreshKey]);
  return state.projectId === projectId ? state : { projectId, data: enabled ? lastProjectCheckpoints(projectId) : undefined };
}
