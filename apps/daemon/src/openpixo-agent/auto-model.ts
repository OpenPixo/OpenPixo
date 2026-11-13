import type Database from 'better-sqlite3';
import {
  chooseOpenPixoAgentAutoModel, gamePlanStepOfReply, OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME,
  type OpenPixoAgentAutoChoice,
} from '@openpixo/contracts';

/**
 * Auto, the hosted choice a user gets when they picked nothing: Flash for every turn
 * except a new game's plan, which the plan model writes (owner decision, 2026-11-13).
 *
 * The plan turns a game had are counted in their own table, not in project metadata,
 * because metadata is read-modify-written in many places and a lost count would let a
 * game run past its cap. Counting and recording happen in one synchronous transaction.
 */

/** Newest assistant replies read for a step label; a reply that answered a side question has none. */
const LABEL_LOOKBACK_REPLIES = 6;

export function migrateOpenPixoAutoModel(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS openpixo_auto_plan_turns (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_openpixo_auto_plan_turns_project ON openpixo_auto_plan_turns(project_id);
  `);
}

/** The step label of the newest labelled planning reply in this conversation. */
export function latestGamePlanStep(db: Database.Database, conversationId: string | null | undefined): number | null {
  if (!conversationId) return null;
  const rows = db.prepare(
    `SELECT content FROM messages
      WHERE conversation_id = ? AND role = 'assistant' AND content <> ''
      ORDER BY position DESC LIMIT ?`,
  ).all(conversationId, LABEL_LOOKBACK_REPLIES) as Array<{ content: string }>;
  for (const row of rows) {
    const step = gamePlanStepOfReply(row.content);
    if (step !== null) return step;
  }
  return null;
}

export function autoPlanTurnsUsed(db: Database.Database, projectId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM openpixo_auto_plan_turns WHERE project_id = ?')
    .get(projectId) as { n: number };
  return row.n;
}

export interface OpenPixoAutoRunInput {
  runId: string;
  projectId: string | null | undefined;
  conversationId: string | null | undefined;
  planPending: boolean;
  planModelOffered: boolean;
}

/**
 * The real model for one Auto run. A plan turn is recorded under the run id before the
 * run starts, so a retry of the same run keeps its model and is not counted twice.
 */
export function chooseOpenPixoAutoRunModel(
  db: Database.Database,
  input: OpenPixoAutoRunInput,
  now: () => number = Date.now,
): OpenPixoAgentAutoChoice {
  const projectId = input.projectId || null;
  return db.transaction((): OpenPixoAgentAutoChoice => {
    if (projectId) {
      const recorded = db.prepare('SELECT model FROM openpixo_auto_plan_turns WHERE run_id = ?')
        .get(input.runId) as { model: string } | undefined;
      if (recorded) return { model: recorded.model, planTurn: true };
    }
    const choice = chooseOpenPixoAgentAutoModel({
      planPending: projectId !== null && input.planPending,
      lastPlanStep: latestGamePlanStep(db, input.conversationId),
      planTurnsUsed: projectId ? autoPlanTurnsUsed(db, projectId) : OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME,
      planModelOffered: input.planModelOffered,
    });
    if (choice.planTurn && projectId) {
      db.prepare('INSERT INTO openpixo_auto_plan_turns (run_id, project_id, model, created_at) VALUES (?, ?, ?, ?)')
        .run(input.runId, projectId, choice.model, now());
    }
    return choice;
  })();
}
