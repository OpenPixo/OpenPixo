import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, ConfirmDialog, VisuallyHidden } from '@openpixo/components';
import type { OnlineStatusResponse, OnlineUsage } from '@openpixo/contracts';

import { useI18n, useT } from '../../i18n';
import type { Dict, Locale } from '../../i18n/types';
import { clearHostedOnlineData, fetchOnlineStatus, resetOnlineTestData, seedOnlinePlayers, startOnlineTest } from '../../providers/online';
import { openExternalUrl } from '../../providers/registry';
import { previewUrl } from './GameRun';
import { shareErrorMessage } from './share-errors';
import { shareActionError } from './useShareState';
import dialogStyles from './ShareDialog.module.css';
import styles from './ShareOnline.module.css';

/** "Add 20 test players" adds this many. */
export const ONLINE_SEED_PLAYERS = 20;

const PRESETS = [
  { id: 'leaderboard', label: 'gameOnline.presetLeaderboard', prompt: 'gameOnline.promptLeaderboard' },
  { id: 'ghosts', label: 'gameOnline.presetGhosts', prompt: 'gameOnline.promptGhosts' },
  { id: 'battles', label: 'gameOnline.presetBattles', prompt: 'gameOnline.promptBattles' },
] as const satisfies readonly { id: string; label: keyof Dict; prompt: keyof Dict }[];

type Busy = 'test' | 'seed' | 'clear-test' | 'clear-hosted' | null;

const formatCount = (value: number, locale: Locale) => new Intl.NumberFormat(locale).format(value);

function formatBytes(bytes: number, locale: Locale): string {
  const gigabytes = bytes / 1_073_741_824;
  if (gigabytes >= 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(gigabytes)} GB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: bytes < 10_485_760 ? 1 : 0 }).format(bytes / 1_048_576)} MB`;
}

const formatDate = (iso: string, locale: Locale) => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

/** Allowances run by calendar month in UTC, so read-only ends on the 1st of the next one. */
export function nextMonthStart(month: string): string {
  const [year, value] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, value, 1)).toISOString();
}

/** The notice for a game the backend is not fully serving, or null when it is. */
export function onlineStateNotice(usage: OnlineUsage): { key: keyof Dict; upgrade: boolean } | null {
  if (usage.state === 'ok') return null;
  const reason = usage.stateReason ?? (usage.state === 'paused' ? 'paused' : 'requests-cap');
  if (reason === 'paused') return { key: 'gameOnline.paused', upgrade: false };
  if (reason === 'no-plan') return { key: 'gameOnline.noPlan', upgrade: true };
  if (reason === 'storage-cap') return { key: 'gameOnline.storageCap', upgrade: true };
  return { key: 'gameOnline.requestsCap', upgrade: true };
}

/**
 * The Share dialog's online features (specs/current/online-features.md): what they are,
 * whether the game has them, a local test with fake players, and once published what
 * this month used. It mounts inside Play together, which stays mounted while the dialog
 * is closed, so it reads only when `refreshKey` changes and it is visible.
 */
export function ShareOnline({ projectId, hidden, refreshKey, published, onAskAi, onUpgrade }: {
  projectId: string;
  hidden: boolean;
  /** A new value re-reads the status; the dialog's rooms read is the signal that it opened. */
  refreshKey: unknown;
  published: boolean;
  onAskAi: (prompt: string) => void;
  onUpgrade?: () => void;
}) {
  const { locale, t } = useI18n();
  const headingId = useId();
  const [status, setStatus] = useState<OnlineStatusResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unopened, setUnopened] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // What the last read was for, so showing the section again does not read again.
  const readFor = useRef<{ projectId: string; refreshKey: unknown } | null>(null);
  const reads = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const read = ++reads.current;
    try {
      const next = await fetchOnlineStatus(projectId, signal);
      if (read === reads.current) { setStatus(next); setFailed(false); }
    } catch {
      if (read === reads.current && !signal?.aborted) setFailed(true);
    }
  }, [projectId]);

  useEffect(() => {
    const last = readFor.current;
    if (hidden || (last?.projectId === projectId && last.refreshKey === refreshKey)) return undefined;
    if (last && last.projectId !== projectId) setStatus(null);
    readFor.current = { projectId, refreshKey };
    const controller = new AbortController();
    let done = false;
    void load(controller.signal).then(() => { done = true; });
    // A read cut short still has to happen.
    return () => { controller.abort(); if (!done) readFor.current = null; };
  }, [hidden, projectId, refreshKey, load]);

  const act = async (kind: Exclude<Busy, null>, action: () => Promise<string | null>) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (caught) {
      setError(shareErrorMessage(shareActionError(caught), t, locale) ?? t('gameOnline.actionFailed'));
    } finally {
      setBusy(null);
    }
  };

  const test = () => act('test', async () => {
    setUnopened(null);
    const { url } = await startOnlineTest(projectId);
    // The test window is this computer's game: nothing else may open from here.
    const local = previewUrl(url);
    if (!local) throw new Error('not a local game');
    if (!await openExternalUrl(local).catch(() => false)) setUnopened(local);
    return null;
  });
  const seed = () => act('seed', async () => {
    const result = await seedOnlinePlayers(projectId, { players: ONLINE_SEED_PLAYERS });
    await load();
    return t('gameOnline.seeded', { players: formatCount(result.players, locale) });
  });
  const clearTest = () => act('clear-test', async () => {
    await resetOnlineTestData(projectId);
    await load();
    return t('gameOnline.cleared');
  });
  const clearHosted = () => act('clear-hosted', async () => {
    try { await clearHostedOnlineData(projectId); }
    finally { setConfirmClear(false); }
    await load();
    return t('gameOnline.clearedHosted');
  });

  const local = status?.local;
  const collections = Object.entries(local?.collections ?? {});
  const hasTestData = Boolean(local && (local.players > 0 || collections.length > 0));
  const usage = status?.usage ?? null;
  const showHosted = published || usage !== null;

  return (
    <div className={styles.online} role="group" aria-labelledby={headingId} data-testid="share-online">
      <h4 id={headingId} className={styles.heading}>{t('gameOnline.title')}</h4>
      <p className={dialogStyles.text}>{t('gameOnline.intro')}</p>
      {!status && !failed ? <p className={dialogStyles.muted} role="status">{t('gameOnline.loading')}</p> : null}
      {failed && !status ? <>
        {/* Not an alert: rooms and the link above still work, and they own the dialog's alerts. */}
        <p className={dialogStyles.text} data-testid="share-online-failed">{t('gameOnline.failed')}</p>
        <div className={dialogStyles.actions}><Button size="sm" variant="secondary" onClick={() => void load()}>{t('gameOnline.retry')}</Button></div>
      </> : null}
      {status ? <>
        <p className={dialogStyles.muted} data-testid="share-online-state">{t(status.sdkInstalled ? 'gameOnline.added' : 'gameOnline.notAdded')}</p>
        <div className={styles.presets} role="group" aria-label={t('gameOnline.askLabel')}>
          <span className={styles.presetLabel} aria-hidden="true">{t('gameOnline.askLabel')}</span>
          {PRESETS.map(preset => (
            <Button key={preset.id} size="sm" variant="secondary" data-testid={`share-online-ask-${preset.id}`} onClick={() => onAskAi(t(preset.prompt))}>
              {t(preset.label)}
            </Button>
          ))}
        </div>

        {showHosted && usage ? <OnlineUsagePanel usage={usage} onUpgrade={onUpgrade} /> : null}
        {showHosted && !usage && status.cloudUnknown ? <p className={dialogStyles.muted} data-testid="share-online-unknown">{t('gameOnline.unknown')}</p> : null}

        <div className={styles.local} data-testid="share-online-local">
          <p className={dialogStyles.stateTitle}>{t('gameOnline.localTitle')}</p>
          <p className={dialogStyles.muted}>{t('gameOnline.localHint')}</p>
          {hasTestData ? (
            <ul className={styles.counts} data-testid="share-online-counts">
              <li>{t('gameOnline.localPlayers', { count: formatCount(local!.players, locale) })}</li>
              {collections.map(([name, count]) => <li key={name}>{t('gameOnline.localCollection', { name, count: formatCount(count, locale) })}</li>)}
            </ul>
          ) : <p className={dialogStyles.muted}>{t('gameOnline.localEmpty')}</p>}
          <div className={dialogStyles.actions}>
            {status.sdkInstalled ? (
              <Button size="sm" variant="secondary" disabled={busy !== null} data-testid="share-online-test" onClick={() => void test()}>
                {t(busy === 'test' ? 'gameOnline.testOpening' : 'gameOnline.test')}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" disabled={busy !== null} data-testid="share-online-seed" onClick={() => void seed()}>
              {t(busy === 'seed' ? 'gameOnline.seeding' : 'gameOnline.seed')}
            </Button>
            {hasTestData ? (
              <Button size="sm" variant="ghost" disabled={busy !== null} data-testid="share-online-clear-test" onClick={() => void clearTest()}>
                {t('gameOnline.clearTest')}
              </Button>
            ) : null}
          </div>
          {unopened ? <div className={dialogStyles.alert} role="alert" data-testid="share-online-unopened">
            <p className={dialogStyles.text}>{t('gameOnline.testOpenFailed')}</p>
            <p className={styles.address}>{unopened}</p>
          </div> : null}
        </div>

        {showHosted ? (
          <div className={dialogStyles.actions}>
            <Button size="sm" variant="ghost" disabled={busy !== null} data-testid="share-online-clear-hosted" onClick={() => setConfirmClear(true)}>
              {t('gameOnline.clearHosted')}
            </Button>
          </div>
        ) : null}
        {error ? <p className={dialogStyles.errorText} role="alert" data-testid="share-online-error">{error}</p> : null}
        <VisuallyHidden role="status">{notice ?? ''}</VisuallyHidden>
        {notice ? <p className={dialogStyles.muted} aria-hidden="true" data-testid="share-online-notice">{notice}</p> : null}
      </> : null}
      <ConfirmDialog
        open={confirmClear}
        destructive
        busy={busy === 'clear-hosted'}
        title={t('gameOnline.clearHostedTitle')}
        confirmLabel={t('gameOnline.clearHosted')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void clearHosted()}
      >
        <p className={dialogStyles.text}>{t('gameOnline.clearHostedBody')}</p>
      </ConfirmDialog>
    </div>
  );
}

function OnlineUsagePanel({ usage, onUpgrade }: { usage: OnlineUsage; onUpgrade?: () => void }) {
  const { locale, t } = useI18n();
  const notice = onlineStateNotice(usage);
  const noticeText = notice ? t(notice.key, notice.key === 'gameOnline.requestsCap' ? { date: formatDate(nextMonthStart(usage.month), locale) } : {}) : null;
  return (
    <div className={styles.usage} data-testid="share-online-usage">
      <p className={dialogStyles.stateTitle}>{t('gameOnline.usageTitle')}</p>
      <dl className={dialogStyles.stats}>
        <div>
          <dt>{t('gameOnline.usageRequests')}</dt>
          <dd>{t('gameOnline.usageOf', { used: formatCount(usage.accountRequests, locale), max: formatCount(usage.maxRequests, locale) })}</dd>
        </div>
        <div>
          <dt>{t('gameOnline.usageStorage')}</dt>
          <dd>{t('gameOnline.usageOf', { used: formatBytes(usage.accountBytes, locale), max: formatBytes(usage.maxBytes, locale) })}</dd>
        </div>
        <div><dt>{t('gameOnline.usagePlayers')}</dt><dd>{formatCount(usage.players, locale)}</dd></div>
      </dl>
      {noticeText ? <div className={notice!.upgrade ? dialogStyles.alert : dialogStyles.notice} data-testid="share-online-state-notice">
        <p className={dialogStyles.text}>{noticeText}</p>
        {notice!.upgrade && onUpgrade ? <div className={dialogStyles.actions}>
          <Button size="sm" variant="primary" data-testid="share-online-upgrade" onClick={onUpgrade}>{t('gameOnline.upgrade')}</Button>
        </div> : null}
      </div> : <p className={dialogStyles.muted}>{t('gameOnline.included')}</p>}
      {usage.idleDeleteAt ? <p className={dialogStyles.muted} data-testid="share-online-idle">{t('gameOnline.idle', { date: formatDate(usage.idleDeleteAt, locale) })}</p> : null}
    </div>
  );
}
