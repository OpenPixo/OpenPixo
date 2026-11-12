import { useEffect, useMemo, useState } from 'react';
import type { ProjectCheckpoint } from '@openpixo/contracts';
import { useProjectCheckpoints } from '../checkpoints/useProjectCheckpoints';
import { checkpointForRun } from './changes-model';
import { loadRunLineCounts, type LineCounts } from './useProjectChanges';

export interface RunChanges {
  checkpoint: ProjectCheckpoint | null;
  counts: ReadonlyMap<string, LineCounts>;
}

const EMPTY_COUNTS: ReadonlyMap<string, LineCounts> = new Map();

/**
 * One run's checkpoint and line counts, for a message in the conversation. Only
 * the live message keeps the list polling: a long conversation mounts many of
 * these, and an old run's checkpoint no longer changes.
 */
export function useRunChanges({ projectId, runId, live, refreshKey }: {
  projectId: string | null | undefined;
  runId: string | null | undefined;
  /** This is the conversation's latest message: follow the run's checkpoint until it settles. */
  live: boolean;
  /** Re-read when this changes (the run's status). */
  refreshKey: string | null | undefined;
}): RunChanges {
  const enabled = Boolean(projectId && runId);
  const { data } = useProjectCheckpoints(projectId ?? '', enabled, { poll: live, refreshKey: live ? refreshKey : null });
  const checkpoint = useMemo(
    () => (data?.status === 'available' ? checkpointForRun(data.checkpoints, runId) : null),
    [data, runId],
  );
  const frozenId = checkpoint?.runChanges?.length ? checkpoint.id : null;
  const key = projectId && frozenId ? `${projectId}:${frozenId}` : null;
  const [counts, setCounts] = useState<{ key: string; counts: ReadonlyMap<string, LineCounts> } | null>(null);
  useEffect(() => {
    if (!key || !projectId || !frozenId) return undefined;
    const controller = new AbortController();
    void loadRunLineCounts(projectId, frozenId, controller.signal).then(
      (loaded) => { if (!controller.signal.aborted) setCounts({ key, counts: loaded }); },
      () => { /* Counts are optional. */ },
    );
    return () => controller.abort();
  }, [frozenId, key, projectId]);
  return { checkpoint, counts: counts && counts.key === key ? counts.counts : EMPTY_COUNTS };
}
