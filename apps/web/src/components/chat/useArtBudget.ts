import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ArtBudgetResponse } from '@openpixo/contracts';
import { fetchArtBudget, isArtBudgetResponse } from '../../state/art-budget';

/** Often enough that the line visibly moves as images are made. */
const RUNNING_POLL_MS = 5_000;

/**
 * One budget per project, shared by every surface that shows it: the line above the
 * composer, the approve bar and the art cards in the chat. A change saved in one is
 * seen by the others at once, and they share one read in flight.
 *
 * The entry lives while anything shows the project, so a project left and reopened
 * reads afresh. `version` counts writes: a read that started before a write lands
 * after it would put the old budget back, so it is dropped.
 */
interface Entry {
  state: ArtBudgetResponse | null;
  listeners: Set<() => void>;
  inflight: Promise<void> | null;
  version: number;
}

const entries = new Map<string, Entry>();

function entryFor(projectId: string): Entry {
  let entry = entries.get(projectId);
  if (!entry) {
    entry = { state: null, listeners: new Set(), inflight: null, version: 0 };
    entries.set(projectId, entry);
  }
  return entry;
}

function write(projectId: string, state: ArtBudgetResponse): void {
  const entry = entries.get(projectId);
  if (!entry) return;
  entry.version += 1;
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

async function read(projectId: string): Promise<void> {
  const entry = entries.get(projectId);
  if (!entry) return;
  if (entry.inflight) return await entry.inflight;
  const startedAt = entry.version;
  const request = fetchArtBudget(projectId).then(
    (next) => {
      if (entries.get(projectId) === entry && entry.version === startedAt) write(projectId, next);
    },
    (error: unknown) => { console.warn('Failed to read the art budget', error); },
  ).finally(() => { entry.inflight = null; });
  entry.inflight = request;
  return await request;
}

function subscribe(projectId: string, listener: () => void): () => void {
  const entry = entryFor(projectId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entries.get(projectId) === entry) entries.delete(projectId);
  };
}

/**
 * The project's art budget as the daemon reports it. Loads when `enabled` turns on,
 * re-reads while a run is making art and once more when it ends. A failed read keeps
 * what was last known: this is a hint for the user, and the daemon decides spending.
 */
export function useArtBudget(projectId: string | null | undefined, { enabled, streaming }: { enabled: boolean; streaming: boolean }) {
  const state = useSyncExternalStore(
    useCallback((listener: () => void) => (projectId ? subscribe(projectId, listener) : () => {}), [projectId]),
    () => (projectId ? entries.get(projectId)?.state ?? null : null),
    () => null,
  );

  const refresh = useCallback(async () => {
    if (projectId) await read(projectId);
  }, [projectId]);

  /** Replace the state with a reply the daemon gave; anything else just re-reads. */
  const setState = useCallback((next: unknown) => {
    if (!projectId) return;
    if (isArtBudgetResponse(next)) write(projectId, next);
    else void read(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!enabled || !projectId) return undefined;
    void refresh();
    const timer = streaming ? setInterval(() => { void refresh(); }, RUNNING_POLL_MS) : null;
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [enabled, projectId, refresh, streaming]);

  return { state, setState, refresh };
}
