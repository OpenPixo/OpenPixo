import type Database from 'better-sqlite3';
import {
  ART_SPENDING_MODE_DEFAULT,
  gamePlanIsPending,
  parseArtSpendingMode,
  renderArtBudgetTurnNote,
  type ArtBudgetApproval,
  type ArtSpendingMode,
  type ProjectArtBudget,
  type ProjectMetadata,
} from '@openpixo/contracts';

/**
 * The art budget ledger: per project, how many credits the user lets an agent
 * spend on hosted images, and every charge made against that.
 *
 * It lives in its own tables, not in project metadata: metadata is read, changed
 * and written back from many places, and one stale write would silently reset what
 * was spent. A charge counts as used from the moment it is reserved until the cloud
 * proves it kept nothing, so a crash or an unknown outcome can only make the budget
 * look more used than it is, never less.
 *
 * The spending mode and the latest art-card approval sit beside it for the same
 * reason. In `ask` mode a charge also needs that approval, checked and claimed in
 * the same transaction as the budget.
 */

export type ArtBudgetChargeStatus = 'reserved' | 'spent' | 'released';

export interface ArtBudgetCharge {
  requestId: string;
  projectId: string;
  runId: string | null;
  fingerprint: string;
  quoteId: string;
  service: string;
  credits: number;
  status: ArtBudgetChargeStatus;
}

interface ChargeRow {
  request_id: string; project_id: string; run_id: string | null; fingerprint: string;
  quote_id: string; service: string; credits: number; status: ArtBudgetChargeStatus;
}

export interface ReserveArtBudgetCharge {
  projectId: string;
  runId: string | null;
  /** Identifies the exact request, so a retry finds the charge it belongs to. */
  fingerprint: string;
  quoteId: string;
  service: string;
  credits: number;
  /** The cloud idempotency key, minted by the daemon. */
  requestId: string;
  /**
   * The project asks before spending: the charge must fit an approval no other run
   * has claimed, and claims it for this run.
   */
  requireApproval?: boolean | undefined;
}

export type ReserveArtBudgetResult =
  | { ok: true; charge: ArtBudgetCharge; reused: boolean }
  | { ok: false; reason: 'budget'; budget: ProjectArtBudget | null }
  | { ok: false; reason: 'approval'; budget: ProjectArtBudget; approval: ArtBudgetApproval | null };

/** Whether this run may spend from the approval at all, before any price is known. */
export function approvalUsableBy(approval: ArtBudgetApproval | null, runId: string | null): approval is ArtBudgetApproval {
  return approval !== null && runId !== null && (approval.runId === null || approval.runId === runId) && approval.remainingCredits > 0;
}

export function migrateArtBudget(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_art_budgets (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      limit_credits INTEGER NOT NULL CHECK (limit_credits >= 0),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_art_budget_charges (
      request_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT,
      fingerprint TEXT NOT NULL,
      quote_id TEXT NOT NULL,
      service TEXT NOT NULL,
      credits INTEGER NOT NULL CHECK (credits >= 0),
      status TEXT NOT NULL CHECK (status IN ('reserved','spent','released')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_art_budget_charges_project ON project_art_budget_charges(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_art_budget_charges_fingerprint ON project_art_budget_charges(project_id, fingerprint);
    -- Apart from the budget, so choosing a mode never makes an unset budget look set.
    CREATE TABLE IF NOT EXISTS project_art_spending_modes (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('ask','auto')),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_art_approvals (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      credits INTEGER NOT NULL CHECK (credits > 0),
      approved_at INTEGER NOT NULL,
      run_id TEXT
    );
  `);
}

const toCharge = (row: ChargeRow): ArtBudgetCharge => ({
  requestId: row.request_id, projectId: row.project_id, runId: row.run_id, fingerprint: row.fingerprint,
  quoteId: row.quote_id, service: row.service, credits: row.credits, status: row.status,
});

/**
 * What a run's prompt says about the budget. Whether hosted models are offered goes
 * into the stable media section, which only moves when that flips; the figures change
 * with every image, so they go in the per-turn note.
 *
 * A budget the user set while planning pays for the style samples planning asks for
 * (owner decision 2026-11-10); the plan gate in `routes/game-plan.ts` still holds a
 * planning agent to a few images and nothing else.
 */
export async function artBudgetRunFacts(input: {
  ledger: ArtBudgetLedger;
  hasSession: () => Promise<boolean>;
  projectId: unknown;
  metadata: ProjectMetadata | null | undefined;
}): Promise<{ budgetImages: boolean; budgetUnset: boolean; turnNote: string }> {
  const none = { budgetImages: false, budgetUnset: false, turnNote: '' };
  if (typeof input.projectId !== 'string' || !input.projectId) return none;
  const budget = input.ledger.read(input.projectId);
  // A budget of 0 is the user choosing no credits; only "never set" invites setting one.
  if (budget && budget.limitCredits === 0) return none;
  if (!await input.hasSession().catch(() => false)) return none;
  if (!budget) return { ...none, budgetUnset: true };
  const spending = { mode: input.ledger.readMode(input.projectId), approval: input.ledger.readApproval(input.projectId), planning: gamePlanIsPending(input.metadata) };
  return { budgetImages: budget.remainingCredits > 0, budgetUnset: false, turnNote: renderArtBudgetTurnNote(budget, spending) };
}

export class ArtBudgetLedger {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  /** Null until someone sets a budget for this project. */
  read(projectId: string): ProjectArtBudget | null {
    const row = this.db.prepare('SELECT limit_credits FROM project_art_budgets WHERE project_id = ?')
      .get(projectId) as { limit_credits: number } | undefined;
    if (!row) return null;
    const totals = this.db.prepare(`SELECT status, COALESCE(SUM(credits), 0) AS credits FROM project_art_budget_charges
      WHERE project_id = ? AND status IN ('reserved','spent') GROUP BY status`).all(projectId) as Array<{ status: ArtBudgetChargeStatus; credits: number }>;
    const spentCredits = totals.find(total => total.status === 'spent')?.credits ?? 0;
    const reservedCredits = totals.find(total => total.status === 'reserved')?.credits ?? 0;
    const usedCredits = spentCredits + reservedCredits;
    return { limitCredits: row.limit_credits, spentCredits, reservedCredits, usedCredits,
      remainingCredits: Math.max(0, row.limit_credits - usedCredits) };
  }

  setLimit(projectId: string, credits: number): void {
    this.db.prepare(`INSERT INTO project_art_budgets (project_id, limit_credits, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET limit_credits = excluded.limit_credits, updated_at = excluded.updated_at`)
      .run(projectId, credits, this.now());
  }

  /** Every project asks until the user says otherwise. */
  readMode(projectId: string): ArtSpendingMode {
    const row = this.db.prepare('SELECT mode FROM project_art_spending_modes WHERE project_id = ?').get(projectId) as { mode: string } | undefined;
    return parseArtSpendingMode(row?.mode) ?? ART_SPENDING_MODE_DEFAULT;
  }

  setMode(projectId: string, mode: ArtSpendingMode): void {
    this.db.prepare(`INSERT INTO project_art_spending_modes (project_id, mode, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`)
      .run(projectId, mode, this.now());
  }

  /**
   * The latest art card the user approved. What it used is what its claiming run
   * reserved or spent since the approval; a released charge gives its share back.
   */
  readApproval(projectId: string): ArtBudgetApproval | null {
    const row = this.db.prepare('SELECT credits, approved_at, run_id FROM project_art_approvals WHERE project_id = ?')
      .get(projectId) as { credits: number; approved_at: number; run_id: string | null } | undefined;
    if (!row) return null;
    const usedCredits = row.run_id === null ? 0 : (this.db.prepare(`SELECT COALESCE(SUM(credits), 0) AS credits FROM project_art_budget_charges
      WHERE project_id = ? AND run_id = ? AND status IN ('reserved','spent') AND created_at >= ?`)
      .get(projectId, row.run_id, row.approved_at) as { credits: number }).credits;
    return { approvedCredits: row.credits, usedCredits, remainingCredits: Math.max(0, row.credits - usedCredits),
      runId: row.run_id, approvedAt: row.approved_at };
  }

  /** Replaces any earlier approval, claimed or not. */
  approve(projectId: string, credits: number): void {
    this.db.prepare(`INSERT INTO project_art_approvals (project_id, credits, approved_at, run_id) VALUES (?, ?, ?, NULL)
      ON CONFLICT(project_id) DO UPDATE SET credits = excluded.credits, approved_at = excluded.approved_at, run_id = NULL`)
      .run(projectId, credits, this.now());
  }

  /**
   * The charge a repeat of this exact request belongs to, if any. An open outcome
   * is shared by every later attempt, in any run: the cloud answers the same id with
   * the same job. A settled image is shared only within the run that made it, so a
   * repeat of a lost reply is free, and a later turn asking again gets a new image.
   */
  reusable(projectId: string, fingerprint: string, runId: string | null): ArtBudgetCharge | null {
    const row = this.db.prepare(`SELECT * FROM project_art_budget_charges
      WHERE project_id = ? AND fingerprint = ? AND (status = 'reserved' OR (status = 'spent' AND run_id IS ?))
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(projectId, fingerprint, runId) as ChargeRow | undefined;
    return row ? toCharge(row) : null;
  }

  /**
   * The one place a charge is taken. Synchronous by construction: the check and the
   * insert share a transaction with no await between them, so two requests can never
   * both pass on a budget that covers one, and two runs can never both claim one
   * approval. An open charge is reused first: it was paid for already.
   */
  reserve(input: ReserveArtBudgetCharge): ReserveArtBudgetResult {
    return this.db.transaction((): ReserveArtBudgetResult => {
      const existing = this.reusable(input.projectId, input.fingerprint, input.runId);
      if (existing) return { ok: true, charge: existing, reused: true };
      const budget = this.read(input.projectId);
      if (!budget || budget.remainingCredits < input.credits) return { ok: false, reason: 'budget', budget };
      if (input.requireApproval) {
        const approval = this.readApproval(input.projectId);
        if (!approvalUsableBy(approval, input.runId) || approval.remainingCredits < input.credits) return { ok: false, reason: 'approval', budget, approval };
        if (approval.runId === null) {
          this.db.prepare('UPDATE project_art_approvals SET run_id = ? WHERE project_id = ? AND run_id IS NULL').run(input.runId, input.projectId);
        }
      }
      const at = this.now();
      this.db.prepare(`INSERT INTO project_art_budget_charges
        (request_id, project_id, run_id, fingerprint, quote_id, service, credits, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`)
        .run(input.requestId, input.projectId, input.runId, input.fingerprint, input.quoteId, input.service, input.credits, at, at);
      const { requireApproval: _requireApproval, ...charge } = input;
      return { ok: true, reused: false, charge: { ...charge, status: 'reserved' } };
    }).immediate();
  }

  /** The cloud settled this request; records what it really charged. A no-op for a request the budget did not pay. */
  charged(requestId: string, credits: number): void {
    this.db.prepare(`UPDATE project_art_budget_charges SET status = 'spent', credits = ?, updated_at = ? WHERE request_id = ?`)
      .run(credits, this.now(), requestId);
  }

  /** The cloud kept nothing. Never reverses a settled charge. */
  released(requestId: string): void {
    this.db.prepare(`UPDATE project_art_budget_charges SET status = 'released', updated_at = ? WHERE request_id = ? AND status = 'reserved'`)
      .run(this.now(), requestId);
  }

  /**
   * Releases a reservation that never got as far as the cloud. The hosted module
   * records a job before its first submit, so no record means nothing was sent.
   */
  releaseIfNeverSubmitted(requestId: string): void {
    this.db.prepare(`UPDATE project_art_budget_charges SET status = 'released', updated_at = ?
      WHERE request_id = ? AND status = 'reserved'
        AND NOT EXISTS (SELECT 1 FROM openpixo_cloud_jobs WHERE request_id = ?)`)
      .run(this.now(), requestId, requestId);
  }
}
