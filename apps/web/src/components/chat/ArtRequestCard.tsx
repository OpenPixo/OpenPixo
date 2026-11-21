/**
 * The art card: the agent's list of art it wants to pay for from the art budget, drawn
 * inside its reply when the project asks before spending. Only the user's click
 * approves it (`POST /api/projects/:id/art-budget/approve`); the agent never can.
 * After approving, the answer goes back as an ordinary user message through the same
 * send a question-form answer uses, so the next turn starts and the record shows it.
 *
 * Syntax and parser: `@openpixo/contracts` `api/art-request`. Whether it can be
 * approved: `runtime/chat/art-request.ts` `artRequestStatus`.
 */
import { useId, useState } from 'react';
import { Button, Tag, VisuallyHidden } from '@openpixo/components';
import type { ArtRequestCard as ArtRequestCardData } from '@openpixo/contracts';
import type { Dict } from '../../i18n/types';
import { useT } from '../../i18n';
import { artSpendingMode } from '../../runtime/chat/art-budget';
import { artRequestStatus } from '../../runtime/chat/art-request';
import { ArtBudgetRequestError, approveArt, setArtSpendingMode } from '../../state/art-budget';
import { StatusMark } from './primitives/StatusMark';
import { useArtBudget } from './useArtBudget';
import styles from './ArtRequestCard.module.css';

/** Pairs the answer with this card, like a question form's id does. */
export const ART_REQUEST_FORM_ID = 'art-request';

export type ArtRequestSend = (
  text: string,
  attachments?: undefined,
  context?: undefined,
  sourceAssistantMessageId?: string,
  formId?: string,
) => boolean | void | Promise<boolean | void>;

function errorKey(error: unknown): keyof Dict {
  const code = error instanceof ArtBudgetRequestError ? error.code : null;
  if (code === 'RUN_ACTIVE') return 'chat.artRequest.errorBusy';
  if (code === 'ART_APPROVAL_OVER_BUDGET') return 'chat.artRequest.errorOverBudget';
  return 'chat.artRequest.errorFailed';
}

export function ArtRequestCard({
  card,
  projectId,
  latest,
  streaming,
  nextUserContent,
  sendDisabled,
  onSend,
}: {
  card: ArtRequestCardData;
  projectId: string | null | undefined;
  /** The reply's last valid card, on the latest assistant turn. */
  latest: boolean;
  streaming: boolean;
  nextUserContent: string | undefined;
  /** The conversation cannot take a message now (viewer, loading, …). */
  sendDisabled: boolean;
  onSend: ArtRequestSend | undefined;
}) {
  const t = useT();
  const open = latest && nextUserContent === undefined && Boolean(projectId);
  const { state, setState, refresh } = useArtBudget(projectId, { enabled: open, streaming });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<keyof Dict | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const approvalMessage = t('chat.artRequest.message', { credits: card.credits });
  const status = artRequestStatus({ card, latest, nextUserContent, approvalMessage, busy: streaming, budget: state });
  const asks = artSpendingMode(state) === 'ask';
  const disabled = status.kind !== 'ready' || working || sendDisabled || !onSend || !projectId;
  const answered = status.kind === 'approved';

  async function approve(always: boolean) {
    if (disabled || !projectId || !onSend) return;
    setWorking(true);
    setError(null);
    try {
      if (always) setState(await setArtSpendingMode(projectId, 'auto'));
      setState(await approveArt(projectId, card.credits));
    } catch (failure) {
      console.warn('Failed to approve the art', failure);
      setError(errorKey(failure));
      setWorking(false);
      void refresh();
      return;
    }
    let sent: boolean | void;
    try {
      sent = await onSend(approvalMessage, undefined, undefined, undefined, ART_REQUEST_FORM_ID);
    } catch {
      sent = false;
    }
    if (sent === false) setError('chat.artRequest.errorNotSent');
    setWorking(false);
  }

  const remaining = state?.budget?.remainingCredits ?? null;
  const leftAfter = remaining !== null && open && status.kind !== 'over-budget' ? remaining - card.credits : null;
  const count = card.items.length + card.hiddenItems;
  const detailsId = useId();

  /* Answered or passed: history, one quiet line with its mark. */
  if (status.kind === 'approved' || status.kind === 'stale') {
    return (
      <section
        className={`${styles.card} ${styles.settled}`}
        aria-label={t('chat.artRequest.title')}
        data-testid="art-request-card"
        data-status={status.kind}
      >
        {answered ? <StatusMark status="ok" /> : <span className={styles.staleMark} aria-hidden />}
        <span className={styles.settledTitle}>{heading(t, count)}</span>
        {answered
          ? <span className={styles.settledNote} data-testid="art-request-approved">{t('chat.artRequest.approved', { credits: card.credits })}</span>
          : <span className={styles.settledNote} data-testid="art-request-status">{t('chat.artRequest.stale')}</span>}
        {/* The list stays in the page for reading back, out of sight. */}
        <VisuallyHidden>
          <ul>{card.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        </VisuallyHidden>
      </section>
    );
  }

  return (
    <section
      className={styles.card}
      aria-label={t('chat.artRequest.title')}
      data-testid="art-request-card"
      data-status={status.kind}
    >
      <div className={styles.head}>
        <span className={styles.title}>{heading(t, count)}</span>
        <Tag className={styles.tag}>{t('chat.artRequest.tag')}</Tag>
      </div>
      <dl className={styles.info}>
        <div className={styles.infoRow}>
          <dt>{t('chat.artRequest.costLabel')}</dt>
          <dd data-testid="art-request-total">{t('chat.artRequest.total', { credits: card.credits })}</dd>
        </div>
        <div className={styles.infoRow}>
          <dt>{t('chat.artRequest.fromLabel')}</dt>
          <dd>{t('chat.artRequest.fromBudget')}</dd>
        </div>
        {leftAfter !== null ? (
          <div className={styles.infoRow}>
            <dt>{t('chat.artRequest.afterLabel')}</dt>
            <dd data-testid="art-request-left">{t('chat.artRequest.leftAfter', { left: Math.max(0, leftAfter) })}</dd>
          </div>
        ) : null}
      </dl>
      <div className={styles.details}>
        <button
          type="button"
          className={styles.detailsToggle}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          data-testid="art-request-details"
          onClick={() => setDetailsOpen((value) => !value)}
        >
          <span>{t(detailsOpen ? 'chat.artRequest.hideDetails' : 'chat.artRequest.details')}</span>
          <svg className={styles.chev} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        <div id={detailsId} className={`accordion-collapsible${detailsOpen ? ' open' : ''}`} aria-hidden={!detailsOpen}>
          <div className="accordion-collapsible-inner">
            <ul className={styles.items}>
              {card.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
              {card.hiddenItems > 0 ? <li className={styles.more}>{t('chat.artRequest.more', { count: card.hiddenItems })}</li> : null}
            </ul>
          </div>
        </div>
      </div>
      <StatusLine status={status} t={t} />
      {error ? <p className={styles.error} role="status" data-testid="art-request-error">{t(error)}</p> : null}
      <div className={styles.foot}>
        <p className={styles.quiet}>{t('chat.artRequest.orReply')}</p>
        <div className={styles.actions}>
          {asks ? (
            <Button size="sm" variant="secondary" disabled={disabled} data-testid="art-request-approve-always" onClick={() => { void approve(true); }}>
              {t('chat.artRequest.approveAlways')}
            </Button>
          ) : null}
          <Button size="sm" variant="primary" disabled={disabled} data-testid="art-request-approve" onClick={() => { void approve(false); }}>
            {t('chat.artRequest.approve', { credits: card.credits })}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** One line saying what the card buys. */
function heading(t: ReturnType<typeof useT>, count: number): string {
  return count === 1 ? t('chat.artRequest.headingOne') : t('chat.artRequest.heading', { count });
}

function StatusLine({ status, t }: { status: ReturnType<typeof artRequestStatus>; t: ReturnType<typeof useT> }) {
  const text = status.kind === 'over-budget' ? t('chat.artRequest.overBudget', { needed: status.needed, left: status.left })
    : status.kind === 'busy' ? t('chat.artRequest.busy')
      : status.kind === 'loading' ? t('chat.artRequest.loading')
        : status.kind === 'stale' ? t('chat.artRequest.stale')
          : null;
  if (!text) return null;
  return <p className={styles.note} data-testid="art-request-status">{text}</p>;
}
