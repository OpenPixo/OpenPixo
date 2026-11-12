/**
 * The small line near the composer once planning is over: how much of the art budget
 * is used, and a way to change it between turns. Only the user changes it, and the
 * daemon refuses while a run is active, so the control says so instead of failing.
 *
 * The spending mode is changed in the same place: "Ask me first" (the agent shows an
 * art card and waits for Approve) or "Spend within budget". Both go through
 * `POST /api/projects/:id/art-budget`, sending only what changed.
 *
 * Lives in `ChatPane`'s `composerNode` like `GamePlanBar`, so it is on the pane's
 * ResizeObserver list already. Always mounted so the collapse animates.
 */
import { useId, useState, type FormEvent } from 'react';
import { Button, Input } from '@openpixo/components';
import { ART_SPENDING_MODES, gamePlanIsPending, type ArtSpendingMode, type GamePlanState, type SetArtBudgetRequest } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { artBudgetLine, artSpendingMode, budgetDraft, unclaimedApprovalCredits } from '../../runtime/chat/art-budget';
import { setArtBudget } from '../../state/art-budget';
import { useArtBudget } from './useArtBudget';
import styles from './ArtBudgetLine.module.css';

export function ArtBudgetLine({
  projectId,
  plan,
  streaming,
  viewerOnly,
}: {
  projectId: string | null | undefined;
  plan: GamePlanState | null | undefined;
  streaming: boolean;
  viewerOnly?: boolean | undefined;
}) {
  const t = useT();
  const enabled = Boolean(projectId) && !gamePlanIsPending({ gamePlan: plan ?? undefined }) && !viewerOnly;
  const { state, setState } = useArtBudget(projectId, { enabled, streaming });
  const [draft, setDraft] = useState<string | null>(null);
  const [modeDraft, setModeDraft] = useState<ArtSpendingMode | null>(null);
  const modeGroup = useId();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const line = enabled ? artBudgetLine(state) : { kind: 'hidden' as const };
  const open = line.kind !== 'hidden';
  const busy = streaming || state?.runActive === true;
  const editing = open && draft !== null && !busy;
  const maxCredits = state?.account?.maxCredits ?? null;
  const mode = artSpendingMode(state);
  const approvedCredits = mode === 'ask' ? unclaimedApprovalCredits(state) : null;

  function startEditing() {
    setFailed(false);
    setModeDraft(mode);
    setDraft(String(line.kind === 'usage' ? line.limit : Math.min(state?.suggestedCredits ?? 0, maxCredits ?? Infinity)));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!projectId || saving || draft === null) return;
    const credits = Number(draft || 0);
    // Only what changed; a save that changed nothing re-saves the credits, as it always did.
    const modeChanged = modeDraft !== null && modeDraft !== mode;
    const change: SetArtBudgetRequest = {
      ...(!modeChanged || credits !== (state?.budget?.limitCredits ?? 0) ? { credits } : {}),
      ...(modeChanged ? { mode: modeDraft } : {}),
    };
    setSaving(true);
    setFailed(false);
    try {
      setState(await setArtBudget(projectId, change));
      setDraft(null);
    } catch (error) {
      console.warn('Failed to change the art budget', error);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`${styles.collapsible} accordion-collapsible${open ? ' open' : ''}`}
      aria-hidden={!open}
      data-testid="art-budget-line"
    >
      <div className="accordion-collapsible-inner">
        <div className={styles.line}>
          <span className={styles.summary} data-testid="art-budget-summary">
            {line.kind === 'usage'
              ? t('chat.artBudget.usage', { used: line.used, limit: line.limit })
              : t('chat.artBudget.unset')}
          </span>
          {line.kind === 'usage' && !editing ? (
            <span className={styles.mode} data-testid="art-budget-mode">
              {t(mode === 'ask' ? 'chat.artBudget.modeAsk' : 'chat.artBudget.modeAuto')}
            </span>
          ) : null}
          {approvedCredits !== null && !editing ? (
            <span className={styles.hint} data-testid="art-budget-approved">{t('chat.artBudget.approvedWaiting', { credits: approvedCredits })}</span>
          ) : null}
          {editing ? (
            <form className={styles.form} onSubmit={(event) => { void save(event); }}>
              <Input
                className={styles.input}
                inputMode="numeric"
                aria-label={t('chat.artBudget.inputLabel')}
                value={draft}
                data-testid="art-budget-input"
                onChange={(event) => setDraft(budgetDraft(event.target.value, maxCredits))}
              />
              <span>{t('chat.artBudget.credits')}</span>
              <fieldset className={styles.modes}>
                <legend className={styles.legend}>{t('chat.artBudget.modeLabel')}</legend>
                {ART_SPENDING_MODES.map((option) => (
                  <label key={option} className={styles.choice}>
                    <input
                      type="radio"
                      name={modeGroup}
                      value={option}
                      checked={(modeDraft ?? mode) === option}
                      data-testid={`art-budget-mode-${option}`}
                      onChange={() => setModeDraft(option)}
                    />
                    <span>{t(option === 'ask' ? 'chat.artBudget.modeAsk' : 'chat.artBudget.modeAuto')}</span>
                  </label>
                ))}
              </fieldset>
              <Button size="sm" variant="primary-ghost" type="submit" disabled={saving} data-testid="art-budget-save">{t('chat.artBudget.save')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t('chat.artBudget.cancel')}</Button>
              <span className={styles.modeHint} data-testid="art-budget-mode-hint">
                {t((modeDraft ?? mode) === 'ask' ? 'chat.artBudget.modeAskHint' : 'chat.artBudget.modeAutoHint')}
              </span>
            </form>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              tabIndex={open ? 0 : -1}
              data-testid="art-budget-change"
              onClick={startEditing}
            >
              {line.kind === 'usage' ? t('chat.artBudget.change') : t('chat.artBudget.set')}
            </Button>
          )}
          {busy ? <span className={styles.hint} data-testid="art-budget-busy">{t('chat.artBudget.busy')}</span> : null}
          {failed ? <span className={styles.hint} role="status">{t('chat.artBudget.failed')}</span> : null}
        </div>
      </div>
    </div>
  );
}
