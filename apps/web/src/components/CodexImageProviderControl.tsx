import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@openpixo/components';
import type { MediaProviderAvailability } from '@openpixo/contracts';
import { useI18n } from '../i18n';
import { codexImageReasonKey } from '../media/codex-image-errors';
import styles from './CodexImageProviderControl.module.css';

export function CodexImageProviderControl({ onStatus }: {
  onStatus: (status: MediaProviderAvailability) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MediaProviderAvailability | null>(null);
  const [checking, setChecking] = useState(true);
  const request = useRef<AbortController | null>(null);
  const detect = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    let next: MediaProviderAvailability;
    try {
      const response = await fetch('/api/media/config', {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('status unavailable');
      const body = await response.json();
      const provider = body.providers?.['codex-cli'];
      next = provider?.available === true
        ? { available: true, keyless: true }
        : { available: false, keyless: true, reasonCode: provider?.reasonCode ?? 'CODEX_CLI_AUTH_UNKNOWN' };
    } catch {
      next = { available: false, keyless: true, reasonCode: 'CODEX_CLI_AUTH_UNKNOWN' };
    }
    if (controller.signal.aborted) return;
    setStatus(next);
    onStatus(next);
    setChecking(false);
  }, [onStatus]);
  useEffect(() => {
    void detect();
    return () => request.current?.abort();
  }, [detect]);
  return (
    <div className={styles.control}>
      <p role="status" className={styles.message}>
        {checking ? t('settings.codexImageChecking')
          : status?.available ? t('settings.codexImageReady') : t(codexImageReasonKey(status?.reasonCode))}
      </p>
      <Button disabled={checking} onClick={() => void detect()}>{t('settings.codexImageDetect')}</Button>
    </div>
  );
}
