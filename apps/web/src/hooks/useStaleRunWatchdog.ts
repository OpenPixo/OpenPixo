import { useEffect, useRef } from 'react';
import type { ChatRunStatusResponse } from '@openpixo/contracts';
import { STALE_RUN_POLL_MS, staleRunVerdict } from '../runtime/chat/stale-run';

/**
 * Asks the daemon about `runId` every `intervalMs` while `watching`, and calls
 * `onStale` once the daemon has reported the run ended for longer than the grace
 * period. The rule lives in `runtime/chat/stale-run.ts`; this hook only times it.
 */
export function useStaleRunWatchdog({
  runId,
  watching,
  readStatus,
  onStale,
  intervalMs = STALE_RUN_POLL_MS,
}: {
  runId: string | null;
  watching: boolean;
  readStatus: (runId: string) => Promise<ChatRunStatusResponse | null>;
  onStale: (runId: string, status: ChatRunStatusResponse) => void;
  intervalMs?: number;
}): void {
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;
  const readStatusRef = useRef(readStatus);
  readStatusRef.current = readStatus;

  useEffect(() => {
    if (!watching || !runId) return undefined;
    let cancelled = false;
    let terminalSeenAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const status = await Promise.resolve()
        .then(() => readStatusRef.current(runId))
        .catch(() => null);
      if (cancelled) return;
      const verdict = staleRunVerdict({ status: status?.status ?? null, terminalSeenAt, now: Date.now() });
      if (verdict.kind === 'settle' && status) {
        onStaleRef.current(runId, status);
        return;
      }
      terminalSeenAt = verdict.kind === 'keep' ? verdict.terminalSeenAt : null;
      timer = setTimeout(() => { void tick(); }, intervalMs);
    };
    timer = setTimeout(() => { void tick(); }, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [watching, runId, intervalMs]);
}
