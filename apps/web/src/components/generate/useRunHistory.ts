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

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * Runs as the daemon lists them, the user's and the agent's, on this machine only: one
 * game's, or every run when no game is picked. Read while 生成 is showing, again when
 * the window comes back, and while any run is still working, 1.5 s after the last read
 * settled. A slow read is never cut off by the next poll, and a hidden page does not poll.
 */
export function useRunHistory(projectId: string | null, active: boolean) {
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

  const [visible, setVisible] = useState(pageVisible);
  useEffect(() => { setRuns(null); setFailed(false); }, [projectId]);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      const shown = pageVisible();
      setVisible(shown);
      if (shown) void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      controller.current?.abort();
    };
  }, [active, refresh]);
  const working = runs?.some(studioRunIsActive) ?? false;
  useEffect(() => {
    if (!active || !working || !visible) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = window.setTimeout(() => { void poll(); }, POLL_MS);
    };
    timer = window.setTimeout(() => { void poll(); }, POLL_MS);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [active, working, visible, refresh]);

  const add = useCallback((run: RecipeRun) => setRuns(previous => mergeRuns(previous ?? [], [run])), []);
  return { runs, failed, refresh, add };
}
