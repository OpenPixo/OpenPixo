import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, VisuallyHidden } from '@openpixo/components';
import type { RoomsStatusResponse, RoomsUsage } from '@openpixo/contracts';
import { Check } from 'lucide-react';

import { useI18n, useT } from '../../i18n';
import { startRoomsTest, updateRoomsLimit } from '../../providers/publish';
import { openExternalUrl } from '../../providers/registry';
import { previewUrl } from './GameRun';
import { shareErrorMessage } from './share-errors';
import { ShareOnline } from './ShareOnline';
import { formatHours, freeMinutesLeft, limitReached, parseMonthlyLimit } from './share-state';
import { shareActionError } from './useShareState';
import styles from './ShareDialog.module.css';

/**
 * The Share dialog's lower section. Testing needs no account, so it shows in
 * every link state; usage and the limit only exist once the game has a link.
 */
export function SharePlayTogether({ hidden = false, link = null, projectId, rooms, failed, published, pausedKnown, onRetry, onSaved, onAskAi, onGetCredits }: {
  hidden?: boolean;
  /** Players join through the same public link, so this side needs it too. */
  link?: ReactNode;
  projectId: string;
  rooms: RoomsStatusResponse | null;
  failed: boolean;
  published: boolean;
  /** Signed out or offline, the rooms status says paused only because it cannot ask. */
  pausedKnown: boolean;
  onRetry: () => void;
  onSaved: () => Promise<void>;
  /**
   * Closes the dialog and leaves a draft in the chat composer. Called with a prompt by the
   * online presets; with none, the draft is the multiplayer one.
   */
  onAskAi: (prompt?: string) => void;
  onGetCredits?: () => void;
}) {
  const t = useT();
  const headingId = useId();
  const usage = rooms?.usage ?? null;
  return (
    <section className={styles.play} aria-labelledby={headingId} data-testid="share-play" hidden={hidden}>
      <h3 id={headingId} className={styles.heading}>{t('gameShare.playTitle')}</h3>
      {rooms ? <ol className={styles.checklist} data-testid="share-play-steps">
        <PlayStep done={published} label={t('gameShare.stepLink')} />
        <PlayStep done={rooms.sdkInstalled} label={t('gameShare.stepCode')} />
        <PlayStep done={false} label={t('gameShare.stepTest')} />
      </ol> : null}
      {link}
      {failed && !rooms ? <>
        <p className={styles.text} role="alert">{t('gameShare.roomsFailed')}</p>
        <div className={styles.actions}><Button size="sm" variant="secondary" onClick={onRetry}>{t('gameShare.retry')}</Button></div>
      </> : null}
      {rooms ? <>
        {rooms.sdkInstalled ? <TwoWindowTest projectId={projectId} /> : <>
          <p className={styles.text}>{t('gameShare.playIntro')}</p>
          <div className={styles.actions}>
            <Button size="sm" variant="secondary" data-testid="share-ask-ai" onClick={() => onAskAi()}>{t('gameShare.askAi')}</Button>
          </div>
        </>}
        {rooms.paused && pausedKnown ? <p className={styles.muted}>{t('gameShare.roomsPaused')}</p> : null}
        {rooms.sdkInstalled && published && usage ? <RoomsUsagePanel projectId={projectId} usage={usage} onSaved={onSaved} onGetCredits={onGetCredits} /> : null}
        <p className={styles.muted} data-testid="share-price">
          {usage
            ? t('gameShare.price', { free: formatHours(usage.freeMinutesTotal), credits: rooms.creditsPerPlayerHour })
            : t('gameShare.priceNoFree', { credits: rooms.creditsPerPlayerHour })}
        </p>
        <p className={styles.muted}>{t('gameShare.hostNote')}</p>
      </> : null}
      {/* Its own reads; the rooms read is what says the dialog opened. */}
      <ShareOnline projectId={projectId} hidden={hidden} refreshKey={rooms ?? failed} published={published}
        onAskAi={onAskAi} {...(onGetCredits ? { onUpgrade: onGetCredits } : {})} />
    </section>
  );
}

function PlayStep({ done, label }: { done: boolean; label: string }) {
  const t = useT();
  return (
    <li className={styles.checkItem} data-done={done || undefined}>
      <span className={styles.stepMark} aria-hidden="true">{done ? <Check size={13} /> : null}</span>
      <span>{label}</span>
      {done ? <VisuallyHidden>{t('gameShare.stepDone')}</VisuallyHidden> : null}
    </li>
  );
}

function TwoWindowTest({ projectId }: { projectId: string }) {
  const { locale, t } = useI18n();
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unopened, setUnopened] = useState<string[]>([]);
  const run = async () => {
    setTesting(true);
    setError(null);
    setUnopened([]);
    try {
      const { urls } = await startRoomsTest(projectId);
      // The test windows are this computer's game and relay: nothing else may open from here.
      const local = urls.map(url => previewUrl(url)).filter((url): url is string => url !== null);
      if (local.length !== urls.length) { setError(t('gameShare.actionFailed')); return; }
      const opened = await Promise.all(local.map(url => openExternalUrl(url).catch(() => false)));
      // The daemon may hand back one address for both windows.
      setUnopened([...new Set(local.filter((_, index) => !opened[index]))]);
    } catch (caught) {
      setError(shareErrorMessage(shareActionError(caught), t, locale) ?? t('gameShare.actionFailed'));
    } finally {
      setTesting(false);
    }
  };
  return <>
    <p className={styles.text}>{t('gameShare.testHint')}</p>
    <div className={styles.actions}>
      <Button size="sm" variant="secondary" disabled={testing} data-testid="share-test" onClick={() => void run()}>
        {t(testing ? 'gameShare.testOpening' : 'gameShare.test')}
      </Button>
    </div>
    {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
    {unopened.length ? <div className={styles.alert} role="alert" data-testid="share-test-unopened">
      <p className={styles.text}>{t('gameShare.testOpenFailed')}</p>
      <ul className={styles.refused}>{unopened.map(url => <li key={url}>{url}</li>)}</ul>
    </div> : null}
  </>;
}

function RoomsUsagePanel({ projectId, usage, onSaved, onGetCredits }: {
  projectId: string;
  usage: RoomsUsage;
  onSaved: () => Promise<void>;
  onGetCredits?: () => void;
}) {
  const t = useT();
  const freeLeft = freeMinutesLeft(usage);
  return (
    <div className={styles.usage} data-testid="share-usage">
      <dl className={styles.stats}>
        <div>
          <dt>{t('gameShare.usageFreeLeft')}</dt>
          <dd>{t('gameShare.usageFreeValue', { left: formatHours(freeLeft), total: formatHours(usage.freeMinutesTotal) })}</dd>
        </div>
        <div><dt>{t('gameShare.usageCredits')}</dt><dd>{usage.creditsCharged}</dd></div>
        <div><dt>{t('gameShare.usageRooms')}</dt><dd>{usage.openRooms}</dd></div>
      </dl>
      {freeLeft === 0 && onGetCredits ? (
        <div className={styles.actions}>
          <Button size="sm" variant="ghost" data-testid="share-get-credits" onClick={onGetCredits}>{t('gameShare.getCredits')}</Button>
        </div>
      ) : null}
      <LimitEditor projectId={projectId} limit={usage.monthlyCreditLimit} onSaved={onSaved} />
      {limitReached(usage) ? <p className={styles.errorText} data-testid="share-limit-reached">{t('gameShare.limitReached')}</p> : null}
    </div>
  );
}

function LimitEditor({ projectId, limit, onSaved }: { projectId: string; limit: number; onSaved: () => Promise<void> }) {
  const { locale, t } = useI18n();
  const id = useId();
  const [draft, setDraft] = useState(String(limit));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'invalid'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(String(limit)), [limit]);
  const invalid = state === 'invalid';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === 'saving') return;
    const value = parseMonthlyLimit(draft);
    setError(null);
    if (value === null) { setState('invalid'); return; }
    setState('saving');
    try {
      await updateRoomsLimit(projectId, value);
      await onSaved();
      setState('saved');
    } catch (caught) {
      setState('idle');
      setError(shareErrorMessage(shareActionError(caught), t, locale) ?? t('gameShare.actionFailed'));
    }
  };
  return (
    <form className={styles.limit} onSubmit={event => void submit(event)} noValidate>
      <label className={styles.label} htmlFor={id}>{t('gameShare.limitLabel')}</label>
      <div className={styles.limitRow}>
        <Input id={id} className={styles.limitInput} inputMode="numeric" autoComplete="off" value={draft} data-testid="share-limit"
          aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}
          onChange={event => { setDraft(event.target.value); setError(null); setState('idle'); }} />
        <Button type="submit" size="sm" variant="secondary" data-testid="share-limit-save"
          disabled={state === 'saving' || draft.trim() === String(limit)}>{t('common.save')}</Button>
      </div>
      <p id={`${id}-hint`} className={styles.muted}>{t('gameShare.limitHint')}</p>
      {invalid ? <p className={styles.errorText} role="alert" data-testid="share-limit-invalid">{t('gameShare.limitInvalid')}</p> : null}
      {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
      <VisuallyHidden role="status">{state === 'saved' ? t('gameShare.limitSaved') : ''}</VisuallyHidden>
    </form>
  );
}
