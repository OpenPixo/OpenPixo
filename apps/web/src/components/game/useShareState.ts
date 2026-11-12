import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublishRequest, PublishStatusResponse, RoomsStatusResponse } from '@openpixo/contracts';

import { refreshOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { fetchPublishStatus, fetchRoomsStatus, PublishRequestError, removePublishedGame, startPublish } from '../../providers/publish';
import { deriveShareView, isJobRunning } from './share-state';

const POLL_MS = 1_000;

export interface ShareActionError {
  /** The API's code, which `shareErrorMessage` turns into words. */
  code: string | null;
  /** The API's own words when it gave any; null means "say something generic". */
  message: string | null;
  refusedFiles?: string[];
}

export function shareActionError(caught: unknown): ShareActionError {
  if (caught instanceof PublishRequestError && caught.code) {
    return { code: caught.code, message: caught.message, ...(caught.refusedFiles ? { refusedFiles: caught.refusedFiles } : {}) };
  }
  return { code: null, message: null };
}

/**
 * The dialog's link and rooms state. It reads only while the dialog is open: the
 * publish itself runs in the daemon, so closing the dialog just stops watching
 * and reopening picks the same job's progress back up.
 */
export function useShareState(projectId: string, open: boolean) {
  const [status, setStatus] = useState<PublishStatusResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rooms, setRooms] = useState<RoomsStatusResponse | null>(null);
  const [roomsFailed, setRoomsFailed] = useState(false);
  const [busy, setBusy] = useState<'publish' | 'remove' | null>(null);
  const [actionError, setActionError] = useState<ShareActionError | null>(null);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  // A read started before a newer read or a mutation cannot replace its result.
  const statusRead = useRef(0);
  const roomsRead = useRef(0);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    const read = ++statusRead.current;
    try {
      const next = await fetchPublishStatus(projectId, signal);
      if (read === statusRead.current) { setStatus(next); setLoadFailed(false); }
    } catch {
      if (read === statusRead.current && !signal?.aborted) setLoadFailed(true);
    }
  }, [projectId]);

  const loadRooms = useCallback(async (signal?: AbortSignal) => {
    const read = ++roomsRead.current;
    try {
      const next = await fetchRoomsStatus(projectId, signal);
      if (read === roomsRead.current) { setRooms(next); setRoomsFailed(false); }
    } catch {
      if (read === roomsRead.current && !signal?.aborted) setRoomsFailed(true);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    void loadStatus(controller.signal);
    void loadRooms(controller.signal);
    return () => controller.abort();
  }, [open, loadStatus, loadRooms]);

  const running = isJobRunning(status?.job);
  useEffect(() => {
    if (!open || !running) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await loadStatus(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, running, loadStatus]);

  // A finished publish is what makes usage readable: re-read rooms when it ends.
  // One that agreed to the extra-game charge has moved the balance, or was refused for it.
  const wasRunning = useRef(false);
  const paidPublish = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running && open) {
      void loadRooms();
      if (paidPublish.current) void refreshOpenPixoCredits();
    }
    if (!running && wasRunning.current) paidPublish.current = false;
    wasRunning.current = running;
  }, [running, open, loadRooms]);

  const publish = useCallback(async (request: PublishRequest) => {
    setBusy('publish');
    setActionError(null);
    paidPublish.current = request.payExtraGame === true;
    try {
      const { job } = await startPublish(projectId, request);
      statusRead.current += 1;
      setStatus(previous => previous ? { ...previous, job } : previous);
    } catch (caught) {
      setActionError(shareActionError(caught));
      // Refused for a reason the status can explain (rules, a publish already running).
      await loadStatus();
    } finally {
      setBusy(null);
    }
  }, [projectId, loadStatus]);

  const remove = useCallback(async () => {
    setBusy('remove');
    setActionError(null);
    try {
      await removePublishedGame(projectId);
      await Promise.all([loadStatus(), loadRooms()]);
    } catch (caught) {
      setActionError(shareActionError(caught));
    } finally {
      setBusy(null);
    }
  }, [projectId, loadStatus, loadRooms]);

  const view = deriveShareView(status, { loadFailed, dismissedJobId });
  const reload = useCallback(() => { void loadStatus(); void loadRooms(); }, [loadStatus, loadRooms]);
  const dismissFailure = useCallback(() => {
    if (view.kind === 'failed') setDismissedJobId(view.job.id);
    setActionError(null);
  }, [view]);

  return { status, view, loadFailed, rooms, roomsFailed, busy, actionError, publish, remove, reload, loadRooms, dismissFailure };
}
