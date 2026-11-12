import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaProviderAvailability } from '@openpixo/contracts';

const UNKNOWN: MediaProviderAvailability = { available: false, keyless: true, reasonCode: 'CODEX_CLI_AUTH_UNKNOWN' };

/** Reads Codex image readiness from `GET /api/media/config`, the same answer Settings › Media shows. */
export async function fetchCodexImageStatus(signal?: AbortSignal): Promise<MediaProviderAvailability> {
  try {
    const response = await fetch('/api/media/config', { credentials: 'same-origin', cache: 'no-store', signal });
    if (!response.ok) return UNKNOWN;
    const body = await response.json() as { providers?: Record<string, Partial<MediaProviderAvailability>> };
    const provider = body.providers?.['codex-cli'];
    return provider?.available === true
      ? { available: true, keyless: true }
      : { available: false, keyless: true, reasonCode: provider?.reasonCode ?? UNKNOWN.reasonCode };
  } catch (error) {
    if (signal?.aborted) throw error;
    return UNKNOWN;
  }
}

export interface CodexImageStatusState {
  /** `null` until the first answer arrives. */
  status: MediaProviderAvailability | null;
  checking: boolean;
  recheck: () => void;
}

/**
 * Live Codex image readiness. Rechecks when the window regains focus, so a
 * user who runs `codex login` in a terminal sees the step turn ready on return.
 */
export function useCodexImageStatus(enabled = true): CodexImageStatusState {
  const [status, setStatus] = useState<MediaProviderAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const recheck = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    fetchCodexImageStatus(controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setStatus(next);
      setChecking(false);
    }, () => undefined);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    recheck();
    const onFocus = () => { if (document.visibilityState !== 'hidden') recheck(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      request.current?.abort();
    };
  }, [enabled, recheck]);
  return { status, checking, recheck };
}
