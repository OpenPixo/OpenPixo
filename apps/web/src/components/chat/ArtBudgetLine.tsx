/**
 * The small line near the composer once planning is over: how much of the art budget
 * is used, and a way to change it between turns. Only the user changes it, and the
 * daemon refuses while a run is active, so the control says so instead of failing.
 *
 * The spending mode is changed in the same place, as one switch: on = "Ask me before
 * each spend" (the agent shows an art card and waits for Approve), off = spend within
 * the budget. Collapsed it is one line with a progress bar; "Change" opens the rows.
 * Both go through
 * `POST /api/projects/:id/art-budget`, sending only what changed.
 *
 * Lives in `ChatPane`'s `composerNode` like `GamePlanBar`, so it is on the pane's
 * ResizeObserver list already. Always mounted so the collapse animates.
 */
import { useState, type FormEvent } from 'react';
import { Button, Input } from '@openpixo/components';
import { gamePlanIsPending, type ArtSpendingMode, type GamePlanState, type SetArtBudgetRequest } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { artBudgetLine, artSpendingMode, budgetDraft, unclaimedApprovalCredits } from '../../runtime/chat/art-budget';
import { setArtBudget } from '../../state/art-budget';
import { ProgressBar, budgetTone } from './primitives/ProgressBar';
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

  const askDraft = (modeDraft ?? mode) === 'ask';

  return (
    <div
      className={`${styles.collapsible} accordion-collapsible${open ? ' open' : ''}`}
      aria-hidden={!open}
      data-testid="art-budget-line"
    >
      <div className="accordion-collapsible-inner">
        <div className={`${styles.block}${editing ? ` ${styles.expanded}` : ''}`}>
          <div className={styles.line}>
            <span className={styles.summary} data-testid="art-budget-summary">
              {line.kind === 'usage'
                ? t('chat.artBudget.usage', { used: line.used, limit: line.limit })
                : t('chat.artBudget.unset')}
            </span>
            {line.kind === 'usage' ? (
              <ProgressBar
                className={styles.bar}
                value={line.used}
                max={line.limit}
                tone={budgetTone(line.used, line.limit)}
                label={t('chat.artBudget.progressLabel')}
                data-testid="art-budget-bar"
              />
            ) : null}
            {line.kind === 'usage' && !editing ? (
              <span className={styles.mode} data-testid="art-budget-mode">
                {t(mode === 'ask' ? 'chat.artBudget.modeAsk' : 'chat.artBudget.modeAuto')}
              </span>
            ) : null}
            {!editing ? (
              <Button
                size="sm"
                variant="secondary"
                className={styles.change}
                disabled={busy}
                tabIndex={open ? 0 : -1}
                aria-expanded={false}
                data-testid="art-budget-change"
                onClick={startEditing}
              >
                {line.kind === 'usage' ? t('chat.artBudget.change') : t('chat.artBudget.set')}
              </Button>
            ) : null}
          </div>
          {approvedCredits !== null && !editing ? (
            <p className={styles.hint} data-testid="art-budget-approved">{t('chat.artBudget.approvedWaiting', { credits: approvedCredits })}</p>
          ) : null}
          {busy ? <p className={styles.hint} data-testid="art-budget-busy">{t('chat.artBudget.busy')}</p> : null}
          {failed ? <p className={styles.hint} role="status">{t('chat.artBudget.failed')}</p> : null}
          {editing ? (
            <form className={styles.form} onSubmit={(event) => { void save(event); }}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t('chat.artBudget.label')}</span>
                <span className={styles.rowControl}>
                  <Input
                    className={styles.input}
                    inputMode="numeric"
                    aria-label={t('chat.artBudget.inputLabel')}
                    value={draft}
                    data-testid="art-budget-input"
                    onChange={(event) => setDraft(budgetDraft(event.target.value, maxCredits))}
                  />
                  <span>{t('chat.artBudget.credits')}</span>
                </span>
              </div>
              <label className={styles.row}>
                <span className={styles.rowText}>
                  <span className={styles.rowLabel}>{t('chat.artBudget.askToggle')}</span>
                  <span className={styles.modeHint} data-testid="art-budget-mode-hint">
                    {t(askDraft ? 'chat.artBudget.modeAskHint' : 'chat.artBudget.modeAutoHint')}
                  </span>
                </span>
                {/* On = ask first (`ask`), off = spend within the budget (`auto`). */}
                <input
                  type="checkbox"
                  role="switch"
                  className={styles.switch}
                  checked={askDraft}
                  data-testid="art-budget-mode-toggle"
                  onChange={(event) => setModeDraft(event.target.checked ? 'ask' : 'auto')}
                />
              </label>
              <div className={styles.foot}>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t('chat.artBudget.cancel')}</Button>
                <Button size="sm" variant="primary" type="submit" disabled={saving} data-testid="art-budget-save">{t('chat.artBudget.save')}</Button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
