import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, ConfirmDialog, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, Input, VisuallyHidden } from '@openpixo/components';
import type { PublishedGame, PublishJob } from '@openpixo/contracts';
import { Check, Copy, ExternalLink, LoaderCircle, Share2 } from 'lucide-react';

import { useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { useI18n, useT } from '../../i18n';
import { copyToClipboard } from '../../lib/copy-to-clipboard';
import { fetchProjectEngine, fetchPublishStatus } from '../../providers/publish';
import { openExternalUrl } from '../../providers/registry';
import { queueProjectComposerPrefill } from '../../state/composer-prefill';
import { formatCredits } from '../account/account-format';
import { SignInDialog } from '../account/SignInDialog';
import { PLAN_TIER_NAMES, planTier } from '../onboarding/setup-readiness';
import { shareErrorMessage } from './share-errors';
import { extraGameShort, formatPlanMegabytes, isShareableEngine, publishSteps, safeHttpUrl, uploadFraction, type ExtraGameOffer } from './share-state';
import { SharePlayTogether } from './SharePlayTogether';
import { useShareState } from './useShareState';
import styles from './ShareDialog.module.css';

const COPIED_MS = 1_500;
/** The publish route refuses longer titles. */
const TITLE_MAX = 80;

/** A folder with a root index.html detects as `unknown`; only the publish route can say it is still a web game. */
async function readShareAvailable(projectId: string, signal: AbortSignal): Promise<boolean> {
  const engine = await fetchProjectEngine(projectId, signal);
  if (engine !== 'unknown') return isShareableEngine(engine);
  return (await fetchPublishStatus(projectId, signal)).unavailableReason !== 'engine_unsupported';
}

/**
 * Whether this project gets a Share button. Re-read as files change, because a
 * new project only becomes a web game once it has files. Once yes it stays yes
 * for this project, so a read during a file change cannot take an open dialog away.
 */
export function useShareAvailable(projectId: string, enabled: boolean, refreshKey: number): boolean {
  const [webProjectId, setWebProjectId] = useState<string | null>(null);
  const known = webProjectId === projectId;
  useEffect(() => {
    if (!enabled || known) return undefined;
    const controller = new AbortController();
    readShareAvailable(projectId, controller.signal).then(
      web => { if (web && !controller.signal.aborted) setWebProjectId(projectId); },
      () => { /* No answer: no button yet. */ },
    );
    return () => controller.abort();
  }, [projectId, enabled, known, refreshKey]);
  return enabled && known;
}

export function ShareButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <Button size="sm" variant="secondary" className={styles.shareButton} aria-haspopup="dialog" data-testid="game-share" onClick={onClick}>
      <Share2 size={13} aria-hidden="true" />{t('gameShare.open')}
    </Button>
  );
}

/**
 * The game's public link and live rooms (specs/current/publish-and-rooms.md).
 * Stays mounted so its exit animation runs; it reads nothing while closed.
 */
export function ShareDialog({ projectId, projectName, open, onClose, onOpenAccount }: {
  projectId: string;
  projectName?: string;
  open: boolean;
  onClose: () => void;
  onOpenAccount?: () => void;
}) {
  const { locale, t } = useI18n();
  const titleId = useId();
  const fieldId = useId();
  const share = useShareState(projectId, open);
  const { view, status, busy, actionError } = share;
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  // Until the creator picks, a game that already has multiplayer code opens on that side.
  const [modeChoice, setModeChoice] = useState<'solo' | 'multi' | null>(null);
  const mode = modeChoice ?? (share.rooms?.sdkInstalled ? 'multi' : 'solo');
  const contentRef = useRef<HTMLDivElement>(null);
  // Work that must wait until this dialog has let go of focus.
  const afterClose = useRef<(() => void) | null>(null);

  // Publish and Remove replace the control that held focus. Keep it in the dialog.
  useEffect(() => {
    if (open && document.activeElement === document.body) contentRef.current?.focus();
  }, [open, view.kind]);

  const closeThen = (action: () => void) => { afterClose.current = action; onClose(); };
  const title = titleDraft ?? projectName ?? '';
  // The balance is read only while the extra-game offer is on screen.
  const offer = view.kind === 'form' ? view.extraGame ?? null : null;
  const credits = useOpenPixoCredits(offer !== null);
  const balance = credits.credits?.available ?? null;
  const offerShort = offer !== null && extraGameShort(offer, balance);
  const publish = (publishTitle: string | undefined, payExtraGame = false) => void share.publish({
    ...(publishTitle ? { title: publishTitle } : {}),
    ...(termsChecked ? { acceptTerms: true } : {}),
    ...(payExtraGame ? { payExtraGame: true } : {}),
  });
  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    if (view.kind !== 'form' || busy || !title.trim() || (view.needsTerms && !termsChecked)) return;
    // Pressing the offer's button is the creator's agreement to the one-time charge.
    if (offer && offerShort && onOpenAccount) return;
    publish(title.trim(), offer !== null);
  };
  const terms = <TermsCheckbox termsUrl={status?.termsUrl} checked={termsChecked} onChange={setTermsChecked} />;

  return (
    <Dialog open={open} onClose={onClose} ariaLabelledBy={titleId} layout="sectioned" data-testid="share-dialog"
      onAfterClose={() => { const action = afterClose.current; afterClose.current = null; action?.(); }}>
      <DialogHeader><DialogTitle id={titleId}>{t('gameShare.title')}</DialogTitle></DialogHeader>
      <DialogBody>
        <div className={styles.modes} role="group" aria-label={t('gameShare.modeLabel')} data-testid="share-modes">
          <ModeButton selected={mode === 'solo'} title={t('gameShare.modeSolo')} hint={t('gameShare.modeSoloHint')} testId="share-mode-solo" onClick={() => setModeChoice('solo')} />
          <ModeButton selected={mode === 'multi'} title={t('gameShare.modeMulti')} hint={t('gameShare.modeMultiHint')} testId="share-mode-multi" onClick={() => setModeChoice('multi')} />
        </div>
        <div ref={contentRef} tabIndex={-1} className={styles.content} data-share-view={view.kind} hidden={mode !== 'solo'}>
          {view.kind === 'loading' ? <p className={styles.muted} role="status">{t('gameShare.loading')}</p> : null}
          {view.kind === 'unreachable' ? <>
            <p className={styles.text} role="alert">{t('gameShare.unreachable')}</p>
            <div className={styles.actions}><Button size="sm" variant="secondary" onClick={share.reload}>{t('gameShare.retry')}</Button></div>
          </> : null}
          {view.kind === 'signed-out' ? <>
            <p className={styles.text}>{t('gameShare.signedOut')}</p>
            <div className={styles.actions}><Button size="sm" variant="primary" onClick={() => setSignInOpen(true)}>{t('gameShare.signIn')}</Button></div>
          </> : null}
          {view.kind === 'closed' ? <p className={styles.text}>{t('gameShare.closed')}</p> : null}
          {view.kind === 'unsupported' ? <p className={styles.text}>{t('gameShare.unsupported')}</p> : null}
          {view.kind === 'plan-required' ? <div className={styles.notice} data-testid="share-plan-required">
            <p className={styles.stateTitle}>{t('gameShare.planTitle')}</p>
            <p className={styles.text}>{t('gameShare.planBody')}</p>
            <ul className={styles.tiers}>
              <li>{t('gameShare.planTierStarter')}</li>
              <li>{t('gameShare.planTierPro')}</li>
              <li>{t('gameShare.planTierMax')}</li>
            </ul>
            {onOpenAccount ? <div className={styles.actions}>
              <Button size="sm" variant="primary" data-testid="share-plan-cta" onClick={() => closeThen(onOpenAccount)}>{t('gameShare.planCta')}</Button>
            </div> : null}
          </div> : null}
          {view.kind === 'form' ? (
            <form className={styles.content} onSubmit={submitForm}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={fieldId}>{t('gameShare.titleLabel')}</label>
                <Input id={fieldId} value={title} maxLength={TITLE_MAX} autoComplete="off" onChange={event => setTitleDraft(event.target.value)} />
              </div>
              <p className={styles.text}>{t('gameShare.whatHappens')}</p>
              {view.needsTerms ? terms : null}
              {offer ? (
                <ExtraGameOfferPanel offer={offer} balance={balance} balanceLoading={credits.loading} short={offerShort}
                  publishing={busy === 'publish'} canPublish={!busy && Boolean(title.trim()) && !(view.needsTerms && !termsChecked)}
                  onOpenAccount={onOpenAccount ? () => closeThen(onOpenAccount) : undefined} />
              ) : (
                <div className={styles.actions}>
                  <Button type="submit" size="sm" variant="primary" data-testid="share-publish"
                    disabled={busy === 'publish' || !title.trim() || (view.needsTerms && !termsChecked)}>
                    {t(busy === 'publish' ? 'gameShare.publishing' : 'gameShare.publish')}
                  </Button>
                </div>
              )}
            </form>
          ) : null}
          {view.kind === 'publishing' ? <PublishProgress job={view.job} refreshFailed={share.loadFailed} /> : null}
          {view.kind === 'live' || view.kind === 'under-review' ? <>
            {view.kind === 'under-review' ? <div className={styles.notice} data-testid="share-under-review">
              <p className={styles.stateTitle}>{t('gameShare.reviewTitle')}</p>
              <p className={styles.text}>{t('gameShare.reviewBody')}</p>
              <RemovalReason game={view.game} />
            </div> : null}
            <ShareLink game={view.game} />
            <p className={styles.muted}>{t('gameShare.reminder')}</p>
            {view.game.extraPaid ? <p className={styles.muted} data-testid="share-extra-paid">{t('gameShare.extraPaid')}</p> : null}
            {view.planLapsed ? <p className={styles.muted} data-testid="share-plan-lapsed">{t('gameShare.planLapsed')}</p>
              : view.updatesPaused ? <p className={styles.muted}>{t('gameShare.updatesPaused')}</p> : null}
            {!view.updatesPaused && view.needsTerms ? terms : null}
            <div className={styles.actions}>
              {view.updatesPaused ? null : (
                <Button size="sm" variant="secondary" data-testid="share-update"
                  disabled={busy !== null || (view.needsTerms && !termsChecked)} onClick={() => publish(view.game.title)}>
                  {t(busy === 'publish' ? 'gameShare.publishing' : 'gameShare.update')}
                </Button>
              )}
              <Button size="sm" variant="ghost" data-testid="share-remove" disabled={busy !== null} onClick={() => setConfirmRemove(true)}>
                {t('gameShare.remove')}
              </Button>
            </div>
            {view.updatesPaused ? null : <p className={styles.muted}>{t('gameShare.updateHint')}</p>}
          </> : null}
          {view.kind === 'removed' ? <div className={styles.notice} data-testid="share-removed">
            <p className={styles.stateTitle}>{t('gameShare.removedTitle')}</p>
            <p className={styles.text}>{t('gameShare.removedBody')}</p>
            <RemovalReason game={view.game} />
          </div> : null}
          {view.kind === 'failed' ? <>
            <div className={styles.alert} role="alert" data-testid="share-failed">
              <p className={styles.stateTitle}>{t('gameShare.failedTitle')}</p>
              <p className={styles.text}>{shareErrorMessage(view.job.error, t, locale) ?? t('gameShare.failedGeneric')}</p>
              <RefusedFiles files={view.job.refusedFiles} />
            </div>
            {view.game ? <>
              <ShareLink game={view.game} />
              <p className={styles.muted}>{t('gameShare.failedLinkWorks')}</p>
            </> : null}
            <div className={styles.actions}>
              {view.canRetry ? <Button size="sm" variant="primary" data-testid="share-retry" disabled={busy !== null}
                onClick={() => publish(view.game?.title ?? (title.trim() || undefined))}>{t('gameShare.retry')}</Button> : null}
              <Button size="sm" variant="ghost" onClick={share.dismissFailure}>{t('gameShare.back')}</Button>
            </div>
          </> : null}
          {status?.publishPlan && !status.publishPlan.planRequired && (view.kind === 'form' || view.kind === 'live' || view.kind === 'under-review') ? (
            <dl className={styles.stats} data-testid="share-quota">
              <div><dt>{t('gameShare.quotaLive')}</dt><dd>{status.publishPlan.liveGames} / {status.publishPlan.maxLiveGames}</dd></div>
              {status.publishPlan.extraGames ? <div><dt>{t('gameShare.quotaExtra')}</dt><dd>{status.publishPlan.extraGames}</dd></div> : null}
              <div><dt>{t('gameShare.quotaSize')}</dt><dd>{formatPlanMegabytes(status.publishPlan.maxGameBytes)} MB</dd></div>
              <div><dt>{t('gameShare.quotaPlays')}</dt><dd>{t('gameShare.quotaPlaysValue')}</dd></div>
            </dl>
          ) : null}
          {view.kind === 'form' || view.kind === 'live' || view.kind === 'under-review' ? <p className={styles.muted}>{t('gameShare.soloFree')}</p> : null}
          {actionError ? <div className={styles.alert} role="alert" data-testid="share-action-error">
            <p className={styles.text}>{shareErrorMessage(actionError, t, locale) ?? t('gameShare.actionFailed')}</p>
            <RefusedFiles files={actionError.refusedFiles} />
          </div> : null}
        </div>
        {view.kind === 'unsupported' || (view.kind === 'unreachable' && !share.rooms) ? null : (
          <SharePlayTogether
            hidden={mode !== 'multi'}
            link={view.kind === 'live' || view.kind === 'under-review' ? <ShareLink game={view.game} testIdPrefix="share-play" /> : null}
            projectId={projectId}
            rooms={share.rooms}
            failed={share.roomsFailed}
            published={view.kind === 'live' || view.kind === 'under-review'}
            pausedKnown={view.kind !== 'signed-out' && view.kind !== 'unreachable'}
            onRetry={() => void share.loadRooms()}
            onSaved={() => share.loadRooms()}
            onAskAi={prompt => closeThen(() => queueProjectComposerPrefill(projectId, prompt ?? t('gameShare.askAiPrompt')))}
            onGetCredits={onOpenAccount ? () => closeThen(onOpenAccount) : undefined}
          />
        )}
      </DialogBody>
      <DialogFooter>
        <Button size="sm" onClick={onClose}>{t('common.close')}</Button>
      </DialogFooter>
      <ConfirmDialog
        open={confirmRemove}
        destructive
        busy={busy === 'remove'}
        title={t('gameShare.removeTitle')}
        confirmLabel={t('gameShare.remove')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => { void share.remove().finally(() => setConfirmRemove(false)); }}
      >
        <p className={styles.text}>{t('gameShare.removeBody')}</p>
      </ConfirmDialog>
      <SignInDialog open={signInOpen} onClose={() => { setSignInOpen(false); share.reload(); }} />
    </Dialog>
  );
}

/**
 * The plan's public games are all in use: one click publishes this one for a
 * one-time charge. Too few credits turns that button into Buy credits.
 */
function ExtraGameOfferPanel({ offer, balance, balanceLoading, short, publishing, canPublish, onOpenAccount }: {
  offer: ExtraGameOffer;
  balance: number | null;
  balanceLoading: boolean;
  short: boolean;
  publishing: boolean;
  canPublish: boolean;
  onOpenAccount?: () => void;
}) {
  const { locale, t } = useI18n();
  const tier = offer.sku ? planTier(offer.sku) : null;
  const price = formatCredits(offer.credits, locale);
  const body = tier
    ? t('gameShare.extraBody', { plan: t(PLAN_TIER_NAMES[tier]), count: offer.maxLiveGames, credits: price })
    : t('gameShare.extraBodyNoPlan', { count: offer.maxLiveGames, credits: price });
  const balanceText = balance !== null
    ? short
      ? t('gameShare.extraShort', { balance: formatCredits(balance, locale), missing: formatCredits(offer.credits - balance, locale) })
      : t('gameShare.extraBalance', { balance: formatCredits(balance, locale) })
    : short ? t('gameShare.extraShortUnknown') : balanceLoading ? t('gameShare.extraBalanceLoading') : null;
  return (
    <div className={styles.offer} data-testid="share-extra-offer">
      <p className={styles.text}>{body}</p>
      {balanceText ? <p className={`${styles.muted} ${styles.offerBalance} ${short ? styles.offerShort : ''}`} data-testid="share-extra-balance">{balanceText}</p> : null}
      <div className={styles.actions}>
        {short && onOpenAccount ? (
          <Button size="sm" variant="primary" data-testid="share-extra-buy" onClick={onOpenAccount}>{t('gameShare.extraBuy')}</Button>
        ) : (
          <Button type="submit" size="sm" variant="primary" data-testid="share-extra-publish" disabled={publishing || !canPublish}>
            {publishing ? t('gameShare.publishing') : t('gameShare.extraPublish', { credits: price })}
          </Button>
        )}
        {onOpenAccount ? <Button size="sm" variant="secondary" data-testid="share-extra-upgrade" onClick={onOpenAccount}>{t('gameShare.extraUpgrade')}</Button> : null}
      </div>
    </div>
  );
}

function ModeButton({ selected, title, hint, testId, onClick }: { selected: boolean; title: string; hint: string; testId: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.mode} aria-pressed={selected} data-testid={testId} onClick={onClick}>
      <span className={styles.modeTitle}>{title}</span>
      <span className={styles.muted}>{hint}</span>
    </button>
  );
}

function TermsCheckbox({ termsUrl, checked, onChange }: { termsUrl?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const t = useT();
  const href = safeHttpUrl(termsUrl);
  return (
    <label className={styles.terms}>
      <input type="checkbox" checked={checked} data-testid="share-terms" onChange={event => onChange(event.target.checked)} />
      <span>
        {t('gameShare.termsBefore')}
        {href ? <a href={href} target="_blank" rel="noreferrer" onClick={event => { event.preventDefault(); void openExternalUrl(href); }}>{t('gameShare.termsLink')}</a> : t('gameShare.termsLink')}
        {t('gameShare.termsAfter')}
      </span>
    </label>
  );
}

function ShareLink({ game, testIdPrefix = 'share' }: { game: PublishedGame; testIdPrefix?: string }) {
  const t = useT();
  const id = useId();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [openFailed, setOpenFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const href = safeHttpUrl(game.url);
  const copyLink = async () => {
    clearTimeout(timer.current);
    const copied = await copyToClipboard(game.url);
    setCopy(copied ? 'copied' : 'failed');
    if (copied) timer.current = setTimeout(() => setCopy('idle'), COPIED_MS);
  };
  const openLink = async () => {
    if (!href) return;
    try { setOpenFailed(!await openExternalUrl(href)); } catch { setOpenFailed(true); }
  };
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{t('gameShare.linkLabel')}</label>
      <div className={styles.linkRow}>
        <Input id={id} className={styles.linkInput} readOnly value={game.url} data-testid={`${testIdPrefix}-link`} onFocus={event => event.currentTarget.select()} />
        <span className={styles.linkActions}>
          <Button size="sm" variant="primary" className={styles.iconLabel} data-testid={`${testIdPrefix}-copy`} onClick={() => void copyLink()}>
            {copy === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {t(copy === 'copied' ? 'gameShare.copied' : 'gameShare.copy')}
          </Button>
          {href ? <Button size="sm" variant="secondary" className={styles.iconLabel} data-testid={`${testIdPrefix}-open`} onClick={() => void openLink()}>
            <ExternalLink size={13} aria-hidden="true" />{t('gameShare.openLink')}
          </Button> : null}
        </span>
      </div>
      <VisuallyHidden role="status">{copy === 'copied' ? t('gameShare.copiedAnnounce') : ''}</VisuallyHidden>
      {copy === 'failed' ? <p className={styles.errorText} role="alert">{t('gameShare.copyFailed')}</p> : null}
      {openFailed ? <p className={styles.errorText} role="alert">{t('gameShare.openFailed')}</p> : null}
    </div>
  );
}

function PublishProgress({ job, refreshFailed }: { job: PublishJob; refreshFailed: boolean }) {
  const t = useT();
  const steps = publishSteps(job);
  const fraction = uploadFraction(job);
  const current = steps.find(step => step.state === 'current');
  return <>
    {/* Phase changes only: reading every uploaded file aloud would drown the screen reader. */}
    <VisuallyHidden role="status" data-testid="share-progress-live">{current ? t(`gameShare.phase.${current.phase}`) : ''}</VisuallyHidden>
    <ol className={styles.steps} aria-label={t('gameShare.progressLabel')} data-testid="share-progress">
      {steps.map(step => (
        <li key={step.phase} className={styles.step} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
          <span className={styles.stepMark} aria-hidden="true">
            {step.state === 'done' ? <Check size={13} /> : step.state === 'current' ? <LoaderCircle size={13} className={styles.spinner} /> : null}
          </span>
          <span className={styles.stepBody}>
            {step.state === 'current' && step.phase === 'uploading' && job.filesTotal > 0
              ? t('gameShare.phase.uploadingCount', { done: job.filesDone, total: job.filesTotal })
              : t(`gameShare.phase.${step.phase}`)}
            {step.state === 'done' ? <VisuallyHidden>{t('gameShare.stepDone')}</VisuallyHidden> : null}
            {step.state === 'current' && fraction !== null ? (
              <span className={styles.bar} aria-hidden="true"><span className={styles.barFill} style={{ transform: `scaleX(${fraction})` }} /></span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
    <p className={styles.muted}>{t('gameShare.progressHint')}</p>
    {refreshFailed ? <p className={styles.muted}>{t('gameShare.refreshFailed')}</p> : null}
  </>;
}

function RemovalReason({ game }: { game: PublishedGame }) {
  const t = useT();
  return game.removedReason ? <p className={styles.text}>{t('gameShare.reason', { reason: game.removedReason })}</p> : null;
}

function RefusedFiles({ files }: { files?: string[] }) {
  const t = useT();
  if (!files?.length) return null;
  return <>
    <p className={styles.text}>{t('gameShare.refusedTitle')}</p>
    <ul className={styles.refused} data-testid="share-refused">{files.map(file => <li key={file}>{file}</li>)}</ul>
  </>;
}
