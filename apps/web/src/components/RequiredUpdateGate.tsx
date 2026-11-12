import { useCallback, useEffect, useState } from 'react';
import { Button } from '@openpixo/components';
import { PRODUCT_DOWNLOAD_URL } from '@openpixo/contracts';

import { useI18n } from '../i18n';
import { openExternalUrl } from '../providers/registry';
import {
  checkForUpdaterUpdate,
  deriveUpdaterModel,
  openUpdaterInstaller,
  quitAfterUpdaterInstallerOpen,
  readUpdaterRestartSafety,
  readUpdaterStatus,
  restartSafetyFromActionResult,
  restartSafetyFromUpdaterStatus,
  subscribeToUpdaterStatus,
  type UpdaterModel,
  type UpdaterRestartSafety,
} from '../lib/updater';
import styles from './RequiredUpdateGate.module.css';

const SOURCE = 'required-update';
const RUN_POLL_MS = 3000;

/** The publisher's own words in the user's language, when they wrote any. */
function publisherMessage(model: UpdaterModel, locale: string): string | null {
  const message = model.required?.message;
  if (message == null) return null;
  return message[locale] ?? message[locale.split('-')[0] ?? ''] ?? message.en ?? null;
}

/**
 * Shown when the publisher says this version must not be used any more.
 *
 * It covers the app only once nothing would be lost: while a task is still
 * running it stays a strip at the top so the task can finish, and it never
 * restarts on its own. It must also never strand anyone. The requirement only
 * exists while the update feed answers, so being offline never reaches here; and
 * once a download has failed the user gets a retry, the manual download page, and
 * a way to keep working for now.
 */
export function RequiredUpdateGate() {
  const { locale, t } = useI18n();
  const [model, setModel] = useState<UpdaterModel>(() => deriveUpdaterModel(null));
  const [safety, setSafety] = useState<UpdaterRestartSafety | null>(null);
  const [busy, setBusy] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);
  const [continuedForNow, setContinuedForNow] = useState(false);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeToUpdaterStatus((status) => {
      if (mounted) setModel(deriveUpdaterModel(status, { hostAvailable: true }));
    });
    void readUpdaterStatus({ payload: { source: `${SOURCE}:mount` } }).then((result) => {
      if (mounted && result.ok) setModel(result.model);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const required = model.required != null;
  useEffect(() => {
    if (!required) {
      setSafety(null);
      return;
    }
    let mounted = true;
    const read = () => {
      void readUpdaterRestartSafety().then((next) => {
        if (mounted) setSafety(next);
      });
    };
    read();
    const timer = setInterval(read, RUN_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [required]);

  const ready = model.hasDownloadedInstaller && (model.canApplyInPlace || model.canOpenInstaller);
  const failed = !ready && !model.busy && model.status?.error != null;
  // Keeping going was only ever offered because the update could not be fetched.
  useEffect(() => {
    if (ready) setContinuedForNow(false);
  }, [ready]);

  const restart = useCallback(async (force: boolean) => {
    setBusy(true);
    setRestartFailed(false);
    const options = { payload: { force, source: SOURCE } };
    try {
      const installed = await openUpdaterInstaller(options);
      if (!installed.ok) {
        setRestartFailed(true);
        return;
      }
      const denied = restartSafetyFromUpdaterStatus(installed.status);
      if (denied != null) {
        setSafety(denied);
        return;
      }
      setModel(installed.model);
      if (installed.model.errorMessage != null) {
        setRestartFailed(true);
        return;
      }
      const quit = await quitAfterUpdaterInstallerOpen(options);
      const quitDenied = restartSafetyFromActionResult(quit);
      if (quitDenied != null) setSafety(quitDenied);
      else if (!quit.ok) setRestartFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const retry = useCallback(async () => {
    setBusy(true);
    try {
      const result = await checkForUpdaterUpdate({ payload: { autoDownload: true, source: SOURCE } });
      if (result.ok) setModel(result.model);
    } finally {
      setBusy(false);
    }
  }, []);

  if (model.environment !== 'desktop' || model.required == null || continuedForNow) return null;

  const manualUrl = model.required.url ?? PRODUCT_DOWNLOAD_URL;
  const version = model.availableVersion ?? model.required.minVersion;

  if (safety?.state === 'blocked') {
    return (
      <div className={styles.strip} data-testid="required-update-strip" role="status">
        <strong>{t('updater.requiredTitle')}</strong>
        <span>{t('updater.requiredWaitingForRuns', { count: safety.activeRunCount })}</span>
      </div>
    );
  }

  const progress = model.downloadProgress?.percent ?? null;
  const statusText = (() => {
    if (restartFailed) return t('updater.requiredRestartFailed');
    if (safety?.state === 'unknown') return t('updater.activeRunsUnknownBody');
    if (failed) return t('updater.requiredDownloadFailed');
    if (ready) return t('updater.requiredReady', { version });
    if (progress != null) return t('settings.updateStatusDownloadingPercent', { percent: progress });
    return t('updater.requiredPreparing');
  })();
  const message = publisherMessage(model, locale);
  const restartLabel = model.updateKind === 'payload' ? t('updater.installRestart') : t('updater.openInstaller');

  return (
    <div className={styles.backdrop} data-testid="required-update-gate">
      <section
        aria-describedby="required-update-reason"
        aria-labelledby="required-update-title"
        aria-modal="true"
        className={styles.dialog}
        role="alertdialog"
      >
        <h2 className={styles.title} id="required-update-title">{t('updater.requiredTitle')}</h2>
        <p className={styles.reason} id="required-update-reason">
          {t('updater.requiredReason', { current: model.currentVersion ?? '' })}
        </p>
        {message != null ? <p className={styles.message} data-testid="required-update-message">{message}</p> : null}
        <p className={styles.keeps}>{t('updater.requiredKeeps')}</p>
        <p className={styles.status} aria-live="polite" data-testid="required-update-status">{statusText}</p>
        {progress != null ? (
          <div className={styles.progress} aria-hidden>
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        <div className={styles.actions}>
          {failed ? (
            <Button
              data-testid="required-update-continue"
              disabled={busy}
              variant="ghost"
              onClick={() => setContinuedForNow(true)}
            >
              {t('updater.requiredContinue')}
            </Button>
          ) : null}
          {failed || restartFailed ? (
            <Button
              data-testid="required-update-manual"
              disabled={busy}
              variant="secondary"
              onClick={() => void openExternalUrl(manualUrl)}
            >
              {t('updater.manualDownload')}
            </Button>
          ) : null}
          {failed ? (
            <Button data-testid="required-update-retry" disabled={busy} variant="primary" onClick={() => void retry()}>
              {t('updater.requiredRetry')}
            </Button>
          ) : ready ? (
            <Button
              data-testid="required-update-restart"
              disabled={busy}
              variant={safety?.state === 'unknown' ? 'danger' : 'primary'}
              onClick={() => void restart(safety?.state === 'unknown')}
            >
              {safety?.state === 'unknown' ? t('updater.restartAnyway') : restartLabel}
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
