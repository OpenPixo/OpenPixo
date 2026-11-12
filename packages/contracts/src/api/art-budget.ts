// A per-project art budget: credits the user allows the agent to spend on hosted
// images without asking for each one. The user sets it; the daemon prices every
// request, reserves against it and keeps the ledger.

export const ART_BUDGET_EXHAUSTED = 'ART_BUDGET_EXHAUSTED';
export const ART_BUDGET_OVER_BALANCE = 'ART_BUDGET_OVER_BALANCE';
/** The project asks before spending and the user has not approved this art. */
export const ART_APPROVAL_REQUIRED = 'ART_APPROVAL_REQUIRED';
/** An art card asked for more than the budget has left. */
export const ART_APPROVAL_OVER_BUDGET = 'ART_APPROVAL_OVER_BUDGET';

/**
 * How the agent may spend the budget (owner decision 2026-11-11). `ask`: only what
 * the user approved on an art card, one click per list; `auto`: anything within the
 * budget. The budget is the hard limit either way. New projects ask.
 */
export const ART_SPENDING_MODES = ['ask', 'auto'] as const;
export type ArtSpendingMode = (typeof ART_SPENDING_MODES)[number];
export const ART_SPENDING_MODE_DEFAULT: ArtSpendingMode = 'ask';

/** Far above any real budget; it only keeps a typo out of the ledger. */
export const ART_BUDGET_MAX_CREDITS = 1_000_000;

/** What the approve bar offers when no own image tool is connected. */
export const ART_BUDGET_DEFAULT_CREDITS = 100;

/**
 * For the plan's written estimate only, which is made before there is a request to
 * price. Spending always goes by the cloud's quote for the exact request.
 */
export const ART_BUDGET_ESTIMATE_CREDITS = { image: 4, edit: 7 } as const;

export interface ProjectArtBudget {
  limitCredits: number;
  /** Charges the cloud settled. */
  spentCredits: number;
  /** Charges with no known outcome yet. They count as used until the cloud says otherwise. */
  reservedCredits: number;
  usedCredits: number;
  remainingCredits: number;
}

/** The account facts the budget control shows. Absent for an agent's token. */
export interface ArtBudgetAccountFacts {
  signedIn: boolean;
  /** Spendable balance; null when signed out or the cloud could not say. */
  availableCredits: number | null;
  /** The highest budget the balance can pay: what this budget used plus the balance. */
  maxCredits: number | null;
  /** Price of a text-to-image request before surcharges; null when the cloud could not say. */
  imageCredits: number | null;
}

/**
 * What the user approved on the latest art card. It pays for one run: the first run
 * that spends from it claims it, and no other run can. A new approval replaces it.
 */
export interface ArtBudgetApproval {
  approvedCredits: number;
  /** Charges the claiming run made against it, reserved or settled. */
  usedCredits: number;
  remainingCredits: number;
  /** Null until a run spends from it. */
  runId: string | null;
  approvedAt: number;
}

/** GET /api/projects/:id/art-budget, and the reply to changing it. */
export interface ArtBudgetResponse {
  /** Null until someone sets one. */
  budget: ProjectArtBudget | null;
  /** Absent from older daemons; read it as `ART_SPENDING_MODE_DEFAULT`. */
  mode?: ArtSpendingMode;
  /** The latest art card the user approved, or null. */
  approval?: ArtBudgetApproval | null;
  /** Changes wait while this project has an active run. */
  runActive: boolean;
  account?: ArtBudgetAccountFacts;
  /** An own image tool is connected; those are used first and cost nothing extra. */
  ownImageTool?: boolean;
  suggestedCredits?: number;
}

/**
 * POST /api/projects/:id/art-budget. 0 credits means the agent will not spend
 * credits. Either field may be left out, not both.
 */
export interface SetArtBudgetRequest {
  credits?: number;
  mode?: ArtSpendingMode;
}

/**
 * POST /api/projects/:id/art-budget/approve: the user clicked Approve on an art card.
 * The user's alone, like setting the budget. At most what the budget has left.
 */
export interface ApproveArtRequest {
  credits: number;
}

/** The default the approve bar offers. */
export function suggestedArtBudgetCredits(availableCredits: number | null, ownImageTool: boolean): number {
  if (ownImageTool || availableCredits === null) return 0;
  return Math.max(0, Math.min(ART_BUDGET_DEFAULT_CREDITS, availableCredits));
}

/** A whole number of credits a budget may be set to, or null for anything else. */
export function parseArtBudgetCredits(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= ART_BUDGET_MAX_CREDITS ? value : null;
}

export function parseArtSpendingMode(value: unknown): ArtSpendingMode | null {
  return typeof value === 'string' && (ART_SPENDING_MODES as readonly string[]).includes(value) ? value as ArtSpendingMode : null;
}

/** The credits an art card may ask for: a whole number above 0. */
export function parseArtApprovalCredits(value: unknown): number | null {
  const credits = parseArtBudgetCredits(value);
  return credits !== null && credits > 0 ? credits : null;
}
