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
import { useState } from 'react';
import { Button } from '@openpixo/components';
import type { ArtRequestCard as ArtRequestCardData } from '@openpixo/contracts';
import type { Dict } from '../../i18n/types';
import { useT } from '../../i18n';
import { artSpendingMode } from '../../runtime/chat/art-budget';
import { artRequestStatus } from '../../runtime/chat/art-request';
import { ArtBudgetRequestError, approveArt, setArtSpendingMode } from '../../state/art-budget';
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

  return (
    <section
      className={styles.card}
      aria-label={t('chat.artRequest.title')}
      data-testid="art-request-card"
      data-status={status.kind}
    >
      <div className={styles.head}>
        <span className={styles.title}>{t('chat.artRequest.title')}</span>
        <span className={styles.total} data-testid="art-request-total">{t('chat.artRequest.total', { credits: card.credits })}</span>
      </div>
      <ul className={styles.items}>
        {card.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        {card.hiddenItems > 0 ? <li className={styles.more}>{t('chat.artRequest.more', { count: card.hiddenItems })}</li> : null}
      </ul>
      {answered ? (
        <p className={styles.approved} data-testid="art-request-approved">{t('chat.artRequest.approved', { credits: card.credits })}</p>
      ) : (
        <div className={styles.foot}>
          {state?.budget && open ? (
            <p className={styles.note} data-testid="art-request-left">{t('chat.artRequest.left', { left: state.budget.remainingCredits })}</p>
          ) : null}
          <div className={styles.actions}>
            <Button size="sm" variant="primary" disabled={disabled} data-testid="art-request-approve" onClick={() => { void approve(false); }}>
              {t('chat.artRequest.approve')}
            </Button>
            {asks ? (
              <Button size="sm" variant="secondary" disabled={disabled} data-testid="art-request-approve-always" onClick={() => { void approve(true); }}>
                {t('chat.artRequest.approveAlways')}
              </Button>
            ) : null}
          </div>
          <StatusLine status={status} t={t} />
          {error ? <p className={styles.error} role="status" data-testid="art-request-error">{t(error)}</p> : null}
          {status.kind !== 'stale' ? <p className={styles.quiet}>{t('chat.artRequest.orReply')}</p> : null}
        </div>
      )}
    </section>
  );
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
