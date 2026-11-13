import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecipeRun } from '@openpixo/contracts';
import { listStudioRuns } from '../../providers/studio';
import { studioRunIsActive } from '../studio/RecipeRunner';

const POLL_MS = 1500;

/** Newest first, one entry per run: a run the view just started replaces its older copy. */
export function mergeRuns(current: readonly RecipeRun[], incoming: readonly RecipeRun[]): RecipeRun[] {
  const byId = new Map(current.map(run => [run.id, run]));
  for (const run of incoming) byId.set(run.id, run);
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * This project's runs as the daemon lists them: the user's and the agent's, on this
 * machine only. Read while 生成 is showing, again when the window comes back, and
 * every 1.5 s while any run is still working.
 */
export function useRunHistory(projectId: string, active: boolean) {
  const [runs, setRuns] = useState<RecipeRun[] | null>(null);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const { runs: listed } = await listStudioRuns(projectId, current.signal);
      if (current.signal.aborted) return;
      setRuns(listed);
      setFailed(false);
    } catch (cause) {
      if (current.signal.aborted) return;
      console.warn('[generate] history read failed:', cause);
      setFailed(true);
    }
  }, [projectId]);

  useEffect(() => { setRuns(null); setFailed(false); }, [projectId]);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); controller.current?.abort(); };
  }, [active, refresh]);
  const working = runs?.some(studioRunIsActive) ?? false;
  useEffect(() => {
    if (!active || !working) return;
    const timer = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, working, refresh]);

  const add = useCallback((run: RecipeRun) => setRuns(previous => mergeRuns(previous ?? [], [run])), []);
  return { runs, failed, refresh, add };
}
