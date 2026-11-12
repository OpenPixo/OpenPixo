import { ART_SPENDING_MODE_DEFAULT, type ArtBudgetResponse, type ArtSpendingMode } from '@openpixo/contracts';

/** How the agent may spend the budget. A daemon too old to say asks first. */
export function artSpendingMode(state: ArtBudgetResponse | null | undefined): ArtSpendingMode {
  return state?.mode ?? ART_SPENDING_MODE_DEFAULT;
}

/** Credits the user approved on an art card that no run has started spending yet. */
export function unclaimedApprovalCredits(state: ArtBudgetResponse | null | undefined): number | null {
  const approval = state?.approval;
  if (!approval || approval.runId !== null || approval.remainingCredits <= 0) return null;
  return approval.remainingCredits;
}

export type ArtBudgetLineState =
  | { kind: 'hidden' }
  /** Nothing is set, and credits are the only way this project can get art from the agent. */
  | { kind: 'offer' }
  | { kind: 'usage'; used: number; limit: number };

/**
 * What the line above the composer says once planning is over. A person with an own
 * image tool and no budget has no use for it, and neither has anyone signed out, so
 * they see nothing at all.
 */
export function artBudgetLine(state: ArtBudgetResponse | null): ArtBudgetLineState {
  if (!state?.account?.signedIn) return { kind: 'hidden' };
  if (state.budget && state.budget.limitCredits > 0) {
    return { kind: 'usage', used: state.budget.usedCredits, limit: state.budget.limitCredits };
  }
  return state.ownImageTool ? { kind: 'hidden' } : { kind: 'offer' };
}

/** What typing into a budget field means: digits only, never above what the balance can pay. */
export function budgetDraft(typed: string, maxCredits: number | null): string {
  const digits = typed.replace(/\D/gu, '');
  if (!digits) return '';
  const credits = Number(digits);
  return String(maxCredits === null ? credits : Math.min(credits, maxCredits));
}

/** Roughly how many images a budget buys, or null when the price is unknown. */
export function imagesForCredits(credits: number, imageCredits: number | null | undefined): number | null {
  return imageCredits ? Math.floor(credits / imageCredits) : null;
}
