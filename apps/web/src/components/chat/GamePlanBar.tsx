/**
 * The user's approval of a new game's plan. It sits with the composer so it is
 * in reach whenever the agent finishes a turn, and it belongs to the host, not
 * the model: the agent can ask for approval but cannot grant it, and a form the
 * model failed to write cannot leave the user stuck in planning.
 *
 * Signed in, the user approves an art budget with the plan: credits the agent may
 * then spend on images without asking for each one. Signed out, the bar is just the
 * notice and the button, because there is nothing to spend. The budget can also be
 * saved on its own before approval, so the agent can pay for the style samples
 * planning shows (owner decision 2026-11-10); only the user sets it either way.
 *
 * Lives in `ChatPane`'s `composerNode`, like `RunStatusLine`: that slot is
 * already on the pane's ResizeObserver list, so opening and closing here keeps
 * the chat following. Always mounted so the collapse animates.
 */
import { useState } from 'react';
import { Button, Input } from '@openpixo/components';
import { gamePlanIsPending, type GamePlanState } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { budgetDraft, imagesForCredits } from '../../runtime/chat/art-budget';
import { setArtBudget } from '../../state/art-budget';
import { approveGamePlan } from '../../state/game-plan';
import type { Project } from '../../types';
import { useArtBudget } from './useArtBudget';
import styles from './GamePlanBar.module.css';

export function GamePlanBar({
  projectId,
  plan,
  hasReply,
  streaming,
  viewerOnly,
  onApproved,
}: {
  projectId: string | null | undefined;
  plan: GamePlanState | null | undefined;
  /** The agent has said something, so there is a plan or a question to act on. */
  hasReply: boolean;
  streaming: boolean;
  viewerOnly?: boolean | undefined;
  onApproved: (project: Project) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const open = Boolean(projectId) && gamePlanIsPending({ gamePlan: plan ?? undefined }) && hasReply && !streaming && !viewerOnly;
  const { state, setState } = useArtBudget(projectId, { enabled: open, streaming: false });
  const [saved, setSaved] = useState(false);
  const [budgetFailed, setBudgetFailed] = useState(false);
  const account = state?.account;
  const maxCredits = account?.maxCredits ?? null;
  // With no balance to show there is nothing to choose from, so no budget is sent either.
  const offersBudget = open && account?.signedIn === true && maxCredits !== null;
  const value = draft ?? String(state?.budget?.limitCredits ?? state?.suggestedCredits ?? 0);
  const credits = Math.min(Number(value || 0), maxCredits ?? 0);
  const images = imagesForCredits(credits, account?.imageCredits);

  /** The budget alone, for the style samples while planning; approval may change it again. */
  async function saveBudget() {
    if (!projectId || busy) return;
    setBusy(true);
    setBudgetFailed(false);
    try {
      setState(await setArtBudget(projectId, credits));
      setDraft(null);
      setSaved(true);
    } catch (error) {
      console.warn('Failed to save the art budget', error);
      setBudgetFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!projectId || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      onApproved(await approveGamePlan(projectId, offersBudget ? credits : undefined));
    } catch (error) {
      console.warn('Failed to approve the game plan', error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`${styles.collapsible} accordion-collapsible${open ? ' open' : ''}`}
      aria-hidden={!open}
      data-testid="game-plan-bar"
    >
      <div className="accordion-collapsible-inner">
        <div className={styles.bar}>
          <p className={styles.notice}>{failed ? <span role="alert">{t('chat.gamePlan.failed')}</span> : t('chat.gamePlan.notice')}</p>
          {offersBudget ? (
            <div className={styles.budget} data-testid="game-plan-art-budget">
              <div className={styles.field}>
                <label className={styles.field}>
                  <span>{t('chat.artBudget.label')}</span>
                  <Input
                    className={styles.input}
                    inputMode="numeric"
                    value={value}
                    tabIndex={open ? 0 : -1}
                    data-testid="game-plan-art-budget-input"
                    onChange={(event) => { setSaved(false); setDraft(budgetDraft(event.target.value, maxCredits)); }}
                  />
                  <span>{t('chat.artBudget.credits')}</span>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || (saved && draft === null)}
                  tabIndex={open ? 0 : -1}
                  data-testid="game-plan-art-budget-save"
                  onClick={() => { void saveBudget(); }}
                >
                  {t('chat.artBudget.save')}
                </Button>
              </div>
              <p className={styles.hint} data-testid="game-plan-art-budget-hint">
                {t('chat.artBudget.balance', { available: account?.availableCredits ?? 0 })}
                {' · '}
                {credits === 0
                  ? t(state?.ownImageTool ? 'chat.artBudget.ownTool' : 'chat.artBudget.zero')
                  : images === null ? null : t('chat.artBudget.estimate', { images })}
                {state?.budget && state.budget.usedCredits > 0
                  ? <>{' · '}{t('chat.artBudget.usage', { used: state.budget.usedCredits, limit: state.budget.limitCredits })}</>
                  : null}
                {budgetFailed ? <>{' · '}<span role="alert">{t('chat.artBudget.failed')}</span></> : null}
              </p>
            </div>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            tabIndex={open ? 0 : -1}
            data-testid="game-plan-approve"
            onClick={() => { void approve(); }}
          >
            {t('chat.gamePlan.approve')}
          </Button>
        </div>
      </div>
    </div>
  );
}
