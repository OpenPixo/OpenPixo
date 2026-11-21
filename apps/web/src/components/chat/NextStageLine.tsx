/**
 * Offer to build a new game's next stage in a fresh conversation. A build
 * conversation carries planning and art iteration (160-230k tokens by the later
 * stages) into every request; a fresh one of the same project gets only the
 * approved plan and the project notes, which the daemon already sends.
 *
 * Shown under a finished build reply (`nextStageOffer`); the click asks the daemon
 * to open the conversation and sends its first message there, which names the stage.
 * Lives in `ChatPane`'s `composerNode` like `GamePlanBar`, so it is on the pane's
 * ResizeObserver list already. Always mounted so the collapse animates.
 */
import { useState } from 'react';
import { Button } from '@openpixo/components';
import type { GamePlanState } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { nextStageOffer } from '../../runtime/chat/next-stage';
import styles from './NextStageLine.module.css';

export function NextStageLine({
  plan,
  latestReply,
  streaming,
  viewerOnly,
  onStart,
}: {
  plan: GamePlanState | null | undefined;
  latestReply: string;
  streaming: boolean;
  viewerOnly?: boolean | undefined;
  onStart?: (() => Promise<boolean>) | undefined;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const offer = onStart && !viewerOnly ? nextStageOffer(plan, latestReply) : null;
  const open = Boolean(offer) && !streaming;

  async function start() {
    if (!onStart || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (!await onStart()) setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.collapsible} accordion-collapsible${open ? ' open' : ''}`} aria-hidden={!open} data-testid="next-stage-line">
      <div className="accordion-collapsible-inner">
        <div className={styles.line}>
          <p className={styles.hint} title={failed ? undefined : t('chat.nextStage.hint')}>
            {failed ? <span role="alert">{t('chat.nextStage.failed')}</span> : t('chat.nextStage.hint')}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !open}
            tabIndex={open ? 0 : -1}
            data-testid="next-stage-start"
            onClick={() => { void start(); }}
          >
            {offer?.total
              ? t('chat.nextStage.start', { stage: offer.stage, total: offer.total })
              : t('chat.nextStage.startFirst', { stage: offer?.stage ?? 1 })}
          </Button>
        </div>
      </div>
    </div>
  );
}
