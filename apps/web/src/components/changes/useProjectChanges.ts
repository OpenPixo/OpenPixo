import { useEffect, useMemo, useRef, useState } from 'react';
import type { CheckpointFileChange, ListProjectCheckpointsResponse, ProjectCheckpoint } from '@openpixo/contracts';
import type { ChatMessage } from '../../types';
import { CHECKPOINTS_CHANGED, getProjectCheckpoint, listProjectCheckpoints } from '../checkpoints/client';
import { fetchCheckpointDiff } from './client';
import { checkpointForRun, latestRunMessage, runChangeList, runRows, sessionRows, type ChangeRow } from './changes-model';

export interface ProjectChangesInput {
  projectId: string;
  conversationId: string | null | undefined;
  messages: readonly ChatMessage[];
  /** A run of this conversation is writing right now. */
  runInFlight: boolean;
  /** Bumped by the daemon's file events; refreshes a running run's live list. */
  refreshKey: number;
}

export interface LineCounts { additions: number | null; deletions: number | null }

export interface ProjectChanges {
  list: ListProjectCheckpointsResponse | null;
  failed: boolean;
  runMessage: ChatMessage | null;
  runCheckpoint: ProjectCheckpoint | null;
  /** The live run's files are being followed (no frozen list yet). */
  live: boolean;
  runRows: ChangeRow[];
  sessionRows: ChangeRow[];
  /** Line counts of the selected run's files, once its end state is frozen. */
  counts: ReadonlyMap<string, LineCounts>;
  /** Paths the latest run changed so far (the badge's universe). */
  runPaths: readonly string[];
}

const LIVE_REFRESH_DELAY_MS = 600;
const countsCache = new Map<string, Map<string, LineCounts>>();

/** A run's per-file line counts: one all-files diff, cached once its end state is frozen. */
export async function loadRunLineCounts(projectId: string, checkpointId: string, signal?: AbortSignal): Promise<Map<string, LineCounts>> {
  const key = `${projectId}:${checkpointId}`;
  const cached = countsCache.get(key);
  if (cached) return cached;
  const result = await fetchCheckpointDiff(projectId, checkpointId, signal);
  const counts = new Map(result.files.map((file) => [file.path, { additions: file.additions, deletions: file.deletions }]));
  if (result.target === 'run_end') countsCache.set(key, counts);
  return counts;
}

/**
 * The checkpoint data behind 改动. The list is re-read when the latest run
 * starts or stops (its checkpoint appears, then its frozen changes), keeps
 * polling while the project is busy, and follows `CHECKPOINTS_CHANGED`. While
 * the latest run has no frozen list, its live changes come from the checkpoint
 * `show` call, re-read shortly after each file event.
 */
export function useProjectChanges({ projectId, conversationId, messages, runInFlight, refreshKey }: ProjectChangesInput): ProjectChanges {
  const runMessage = useMemo(() => latestRunMessage(messages), [messages]);
  const runId = runMessage?.runId ?? null;
  const [listState, setListState] = useState<{ projectId: string; data: ListProjectCheckpointsResponse | null; failed: boolean }>({ projectId, data: null, failed: false });

  useEffect(() => {
    let active = true;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      const requestGeneration = ++generation;
      try {
        const data = await listProjectCheckpoints(projectId, true);
        if (!active || requestGeneration !== generation) return;
        setListState({ projectId, data, failed: false });
        if (data.status === 'available' && data.busy) timer = setTimeout(() => void refresh(), 1_000);
      } catch {
        if (active && requestGeneration === generation) setListState((current) => ({ projectId, data: current.projectId === projectId ? current.data : null, failed: true }));
      }
    };
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail.projectId === projectId) void refresh();
    };
    void refresh();
    window.addEventListener(CHECKPOINTS_CHANGED, onChanged);
    return () => { active = false; clearTimeout(timer); window.removeEventListener(CHECKPOINTS_CHANGED, onChanged); };
  }, [projectId, runId, runInFlight]);

  const list = listState.projectId === projectId ? listState.data : null;
  const checkpoints = list?.status === 'available' ? list.checkpoints : EMPTY_CHECKPOINTS;
  const runCheckpoint = checkpointForRun(checkpoints, runId);
  const liveCheckpointId = runCheckpoint && runCheckpoint.runChanges === null ? runCheckpoint.id : null;

  const [liveState, setLiveState] = useState<{ checkpointId: string; changes: CheckpointFileChange[] } | null>(null);
  // The first read of a run is immediate; later file events are coalesced.
  const lastLiveId = useRef<string | null>(null);
  useEffect(() => {
    if (!liveCheckpointId) return;
    const controller = new AbortController();
    const delay = lastLiveId.current === liveCheckpointId ? LIVE_REFRESH_DELAY_MS : 0;
    lastLiveId.current = liveCheckpointId;
    const timer = setTimeout(() => {
      void getProjectCheckpoint(projectId, liveCheckpointId, controller.signal).then(
        (result) => { if (!controller.signal.aborted) setLiveState({ checkpointId: liveCheckpointId, changes: result.currentChanges }); },
        () => { /* Keep the last live list; the next file event retries. */ },
      );
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [projectId, liveCheckpointId, refreshKey]);
  const live = liveCheckpointId && liveState?.checkpointId === liveCheckpointId ? liveState : null;

  // Line counts are cheap once the run's end state is frozen: one all-files
  // diff per checkpoint, cached for the session.
  const frozenId = runCheckpoint?.runChanges?.length ? runCheckpoint.id : null;
  const countsKey = frozenId ? `${projectId}:${frozenId}` : null;
  const [countsState, setCountsState] = useState<{ key: string; counts: Map<string, LineCounts> } | null>(null);
  useEffect(() => {
    if (!countsKey || !frozenId) return;
    const controller = new AbortController();
    void loadRunLineCounts(projectId, frozenId, controller.signal).then((counts) => {
      if (!controller.signal.aborted) setCountsState({ key: countsKey, counts });
    }, () => { /* Counts are optional. */ });
    return () => controller.abort();
  }, [projectId, frozenId, countsKey]);

  const selectedRunRows = useMemo(() => runRows(runCheckpoint, live?.changes ?? null), [runCheckpoint, live]);
  const conversationRows = useMemo(() => sessionRows(checkpoints, conversationId, live), [checkpoints, conversationId, live]);
  const runPaths = useMemo(
    () => (runCheckpoint ? (runChangeList(runCheckpoint, live?.changes ?? null) ?? []).map((change) => change.path) : EMPTY_PATHS),
    [runCheckpoint, live],
  );
  return {
    list,
    failed: listState.projectId === projectId && listState.failed && !list,
    runMessage,
    runCheckpoint,
    live: Boolean(liveCheckpointId),
    runRows: selectedRunRows,
    sessionRows: conversationRows,
    counts: countsState && countsState.key === countsKey ? countsState.counts : EMPTY_COUNTS,
    runPaths,
  };
}

const EMPTY_CHECKPOINTS: ProjectCheckpoint[] = [];
const EMPTY_PATHS: string[] = [];
const EMPTY_COUNTS = new Map<string, LineCounts>();
