
// SQLite-backed persistence for projects, conversations, messages, and the
// per-project set of open workspace tabs. The on-disk project folder under
// .pixo/projects/<id>/ is still the single owner of the user's actual files
// (HTML artifacts, sketches, uploads); this database tracks the metadata
// that used to live in localStorage.

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { ChatMessage, ProjectBrowserWorkspaceTab, ProjectTabsState } from '@openpixo/contracts';
import {
  eventsEndedWithUnfinishedWork,
  isTodoWriteToolName,
  latestTodoWriteInputFromEvents,
  stripArtifactFocusMarkers,
  stripDoneMarkers,
  stripNextStepMarkers,
} from '@openpixo/contracts';


import { scrubDsmlToolProtocolTail } from './artifacts/text-suppression.js';
import {
  listMessageArtifactRows,
  migrateChatArtifacts,
  replaceMessageArtifacts,
} from './chat-artifacts/store.js';
import {
  projectChatArtifactRefs,
  projectConversationChatArtifactRefs,
} from './chat-artifacts/refs.js';
import type { ChatArtifactRef } from './chat-artifacts/types.js';
import { migrateMediaTasks } from './media/tasks.js';
import { migrateOpenPixoCloudJobs } from './media/openpixo-hosted.js';
import { migrateProjectAssets } from './assets/store.js';
import { migrateArtBudget } from './game/art-budget.js';
import { migrateOpenPixoAutoModel } from './openpixo-agent/auto-model.js';
import { migratePlugins } from './plugins/persistence.js';
import { migrateProjectScenarioBindings } from './plugins/scenario-binding.js';
import { emittedRenderableQuestionForm } from './question-form-detect.js';
import {
  RUN_EVENT_JSON_BUDGET_BYTES,
  boundPersistedAgentEvent,
  boundPersistedAgentEvents,
  serializeRunEventsForStorage,
} from './runtimes/run-event-payload-budget.js';
import { observeRead } from './services/daemon-health.js';

type SqliteDb = Database.Database;
type DbRow = Record<string, any>;
type ChatSessionMode = 'design' | 'chat' | 'plan';

let dbInstance: SqliteDb | null = null;
let dbFile: string | null = null;

function row(value: unknown): DbRow | null {
  return value && typeof value === 'object' ? value as DbRow : null;
}

function rows(value: unknown[]): DbRow[] {
  return value.map((item) => row(item) ?? {});
}

export function openDatabase(projectRoot: string, { dataDir }: { dataDir?: string } = {}): SqliteDb {
  const dir = dataDir ? path.resolve(dataDir) : path.join(projectRoot, '.pixo');
  const file = path.join(dir, 'app.sqlite');
  if (dbInstance && dbFile === file) return dbInstance;
  if (dbInstance) closeDatabase();
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  dbInstance = db;
  dbFile = file;
  return db;
}

export function closeDatabase() {
  if (!dbInstance) return;
  dbInstance.close();
  dbInstance = null;
  dbFile = null;
}

function migrate(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      skill_id TEXT,
      pending_prompt TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source_project_id TEXT,
      files_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT,
      session_mode TEXT NOT NULL DEFAULT 'design',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conv_project
      ON conversations(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_sessions (
      conversation_id TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      stable_prompt_hash TEXT,
      -- Per-section digests of the stable prefix inputs behind
      -- stable_prompt_hash, as JSON (see runtimes/stable-prompt-sections.ts). Purely
      -- diagnostic: when the hash moves, diffing this against the current turn
      -- names WHICH input drifted. Never gates a re-send -- stable_prompt_hash
      -- stays the only source of truth for that.
      stable_prompt_sections TEXT,
      -- Resume identity guard: the session is only safe to resume when the
      -- conversation has not changed shape under it. model/cwd are the runtime
      -- identity the upstream session was created with; a change forces a fresh
      -- session. last_message_id is the assistant message this session produced
      -- on its last turn -- if it is no longer the latest completed assistant
      -- turn (another agent ran in between, or it was edited away), the session
      -- is behind and we reseed the full transcript.
      model           TEXT,
      cwd             TEXT,
      last_message_id TEXT,
      -- Last provider-reported effective input usage for this exact session.
      -- Observability only: never used to admit, reject, compact, or roll over.
      last_input_tokens INTEGER,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, agent_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      agent_id TEXT,
      agent_name TEXT,
      result_delivery_state TEXT,
      events_json TEXT,
      attachments_json TEXT,
      produced_files_json TEXT,
      trace_object_files_json TEXT,
      feedback_json TEXT,
      pre_turn_file_names_json TEXT,
      session_mode TEXT,
      run_context_json TEXT,
      task_analytics_json TEXT,
      applied_plugin_snapshot_json TEXT,
      telemetry_finalized_at INTEGER,
      started_at INTEGER,
      ended_at INTEGER,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv
      ON messages(conversation_id, position);

    -- Agent streams write small immutable batches while a run is active. The
    -- batches are folded into messages.events_json once, at the terminal
    -- boundary, so a long thinking stream never rewrites its full history on
    -- every flush window.
    CREATE TABLE IF NOT EXISTS message_event_batches (
      id INTEGER PRIMARY KEY,
      message_id TEXT NOT NULL,
      events_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_message_event_batches_message
      ON message_event_batches(message_id, id);

    -- One row per one-time data maintenance pass that has run to completion
    -- (e.g. the heal of run events stored before the payload budget existed),
    -- so a finished pass is not re-scanned on every daemon start.
    CREATE TABLE IF NOT EXISTS daemon_maintenance_passes (
      name TEXT PRIMARY KEY,
      completed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tabs (
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(project_id, name),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tabs_state (
      project_id TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL,
      state_json TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tabs_project
      ON tabs(project_id, position);






  `);
  // Forward-compatible column add for databases created before metadata_json.
  // SQLite has no IF NOT EXISTS for ALTER, so we check pragma_table_info.
  const cols = db.prepare(`PRAGMA table_info(projects)`).all() as DbRow[];
  if (!cols.some((c: DbRow) => c.name === 'metadata_json')) {
    db.exec(`ALTER TABLE projects ADD COLUMN metadata_json TEXT`);
  }
  if (!cols.some((c: DbRow) => c.name === 'custom_instructions')) {
    db.exec(`ALTER TABLE projects ADD COLUMN custom_instructions TEXT`);
  }
  const conversationCols = db.prepare(`PRAGMA table_info(conversations)`).all() as DbRow[];
  if (!conversationCols.some((c: DbRow) => c.name === 'session_mode')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN session_mode TEXT NOT NULL DEFAULT 'design'`);
  }
  const messageCols = db.prepare(`PRAGMA table_info(messages)`).all() as DbRow[];
  if (!messageCols.some((c: DbRow) => c.name === 'agent_id')) {
    db.exec(`ALTER TABLE messages ADD COLUMN agent_id TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'agent_name')) {
    db.exec(`ALTER TABLE messages ADD COLUMN agent_name TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'run_id')) {
    db.exec(`ALTER TABLE messages ADD COLUMN run_id TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'run_status')) {
    db.exec(`ALTER TABLE messages ADD COLUMN run_status TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'result_delivery_state')) {
    db.exec(`ALTER TABLE messages ADD COLUMN result_delivery_state TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'last_run_event_id')) {
    db.exec(`ALTER TABLE messages ADD COLUMN last_run_event_id TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'feedback_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN feedback_json TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'pre_turn_file_names_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN pre_turn_file_names_json TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'trace_object_files_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN trace_object_files_json TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'session_mode')) {
    db.exec(`ALTER TABLE messages ADD COLUMN session_mode TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'run_context_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN run_context_json TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'task_analytics_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN task_analytics_json TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'applied_plugin_snapshot_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN applied_plugin_snapshot_json TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'telemetry_finalized_at')) {
    db.exec(`ALTER TABLE messages ADD COLUMN telemetry_finalized_at INTEGER`);
  }
  // Fork divider (delivered design, cell 38): the marker that says "this turn
  // was forked, and here is the title the new conversation inherited". It has
  // to be a stored column, not a client-side flag — the divider is only
  // honest if it is still there after a reload.
  if (!messageCols.some((c: DbRow) => c.name === 'forked_into_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN forked_into_json TEXT`);
  }
  // Who stopped this turn (delivered design, cell 81). `runStatus: 'canceled'`
  // alone cannot tell a user's Stop from a daemon shutdown / project cleanup,
  // so the pause line would lie after a daemon restart. The origin has to be a
  // stored column for the same reason the fork divider is: the line is only
  // honest if it still says the same thing after a reload.
  if (!messageCols.some((c: DbRow) => c.name === 'cancel_origin')) {
    db.exec(`ALTER TABLE messages ADD COLUMN cancel_origin TEXT`);
  }

  const agentSessionCols = db.prepare(`PRAGMA table_info(agent_sessions)`).all() as DbRow[];
  if (agentSessionCols.length > 0 && !agentSessionCols.some((c: DbRow) => c.name === 'stable_prompt_hash')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN stable_prompt_hash TEXT`);
  }
  // Drift attribution (see agent_sessions CREATE TABLE comment). Rows written
  // before this column exists read back null and report `unattributed` for one
  // turn, then self-heal on the next write.
  if (agentSessionCols.length > 0 && !agentSessionCols.some((c: DbRow) => c.name === 'stable_prompt_sections')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN stable_prompt_sections TEXT`);
  }
  // Resume identity guard columns (see agent_sessions CREATE TABLE comment).
  if (agentSessionCols.length > 0 && !agentSessionCols.some((c: DbRow) => c.name === 'model')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN model TEXT`);
  }
  if (agentSessionCols.length > 0 && !agentSessionCols.some((c: DbRow) => c.name === 'cwd')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN cwd TEXT`);
  }
  if (agentSessionCols.length > 0 && !agentSessionCols.some((c: DbRow) => c.name === 'last_message_id')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN last_message_id TEXT`);
  }
  if (agentSessionCols.length > 0 && !agentSessionCols.some((c: DbRow) => c.name === 'last_input_tokens')) {
    db.exec(`ALTER TABLE agent_sessions ADD COLUMN last_input_tokens INTEGER`);
  }
  const tabsStateCols = db.prepare(`PRAGMA table_info(tabs_state)`).all() as DbRow[];
  if (tabsStateCols.length > 0 && !tabsStateCols.some((c: DbRow) => c.name === 'state_json')) {
    db.exec(`ALTER TABLE tabs_state ADD COLUMN state_json TEXT`);
  }
  migrateMediaTasks(db);
  migrateOpenPixoCloudJobs(db);
  migrateProjectAssets(db);
  migrateArtBudget(db);
  migrateOpenPixoAutoModel(db);
  migratePlugins(db);
  migrateProjectScenarioBindings(db);
  migrateChatArtifacts(db);


}

// ---------- projects ----------

const PROJECT_COLS = `id, name, skill_id AS skillId,
  pending_prompt AS pendingPrompt,
  metadata_json AS metadataJson,
  applied_plugin_snapshot_id AS appliedPluginSnapshotId,
  custom_instructions AS customInstructions,
  created_at AS createdAt,
  updated_at AS updatedAt`;

export function listProjects(db: SqliteDb) {
  const rows = db
    .prepare(
      `SELECT ${PROJECT_COLS}
         FROM projects
        ORDER BY updated_at DESC`,
    )
    .all() as DbRow[];
  return rows.map(normalizeProject);
}

/**
 * Preserve the last user edit time when persisting background metadata.
 */
export const SYNC_KEEPS_UPDATED_AT = '__pixo.sync-keeps-updated-at__' as const;

/**
 * Resolve a patch's `updatedAt` for a row that already exists: an explicit
 * number wins, {@link SYNC_KEEPS_UPDATED_AT} keeps `existing`, and anything
 * else (a patch that simply omits it) stamps now.
 */
function nextUpdatedAt(patched: unknown, existing: unknown): number {
  if (typeof patched === 'number') return patched;
  if (patched === SYNC_KEEPS_UPDATED_AT && typeof existing === 'number') {
    return existing;
  }
  return Date.now();
}

/**
 * Each project's latest run status, for `GET /api/projects`.
 *
 * The latest run row per project is chosen in SQLite, so the listing never
 * loads any run's event log just to order rows; only a winning `succeeded` row
 * is then inspected, through {@link completenessEventsOfMessage}.
 */
export function listLatestProjectRunStatuses(db: SqliteDb) {
  // Low-frequency, historically the largest read (full-history events before
  // #8170): always leave an in-flight marker so an OOM inside it is attributable.
  return observeRead('project_run_statuses', () => listLatestProjectRunStatusesUnobserved(db), {
    mark: 'always',
    rows: (result) => result.size,
  });
}

function listLatestProjectRunStatusesUnobserved(db: SqliteDb) {
  const rows = db
    .prepare(
      `SELECT projectId, messageId, runId, status, updatedAt
         FROM (
           SELECT c.project_id AS projectId,
                  m.id AS messageId,
                  m.run_id AS runId,
                  m.run_status AS status,
                  COALESCE(m.ended_at, m.started_at, m.created_at) AS updatedAt,
                  ROW_NUMBER() OVER (
                    PARTITION BY c.project_id
                    ORDER BY COALESCE(m.ended_at, m.started_at, m.created_at) DESC
                  ) AS rn
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
            WHERE m.run_status IS NOT NULL
         )
        WHERE rn = 1`,
    )
    .all() as DbRow[];
  const latestByProject = new Map<string, DbRow>();
  const completenessEvents = completenessEventsStatement(db);
  for (const row of rows) {
    latestByProject.set(row.projectId, {
      value: projectDisplayStatusForRunRow(completenessEvents, row.status, String(row.messageId)),
      updatedAt: Number(row.updatedAt),
      runId: row.runId ?? undefined,
    });
  }
  return latestByProject;
}

// A terminal `succeeded` run whose PERSISTED events show unfinished declared
// work (a non-`completed` TodoWrite task) projects as `incomplete`, never
// `succeeded`, so the project pill can't read "Completed" for a run whose work
// is not actually done (#1247 / #1060). Derived from the same events the chat
// footer reads, so the two surfaces cannot disagree, and it survives reload
// because the events were persisted per-event as the run streamed.
function projectDisplayStatusForRunRow(
  completenessEvents: Database.Statement,
  status: unknown,
  messageId: string,
) {
  const normalized = normalizeProjectRunStatus(status);
  if (normalized !== 'succeeded') return normalized;
  const events = completenessEventsOfMessage(completenessEvents, messageId);
  return eventsEndedWithUnfinishedWork(events) ? 'incomplete' : normalized;
}

/**
 * The persisted events of one message that `eventsEndedWithUnfinishedWork`
 * can read, in order — and nothing else.
 *
 * Invariant: that predicate's verdict depends only on `usage` (stop reason),
 * `done_key`, `text` (done conclusion, question form) and TodoWrite-shaped
 * `tool_use` events; every other event — raw lines, tool results, statuses,
 * thinking — is skipped by it. So the verdict over this subset is the verdict
 * over the whole log, and selecting the subset inside SQLite keeps a run's tool
 * payloads out of JS entirely. The tool-name filter is a superset of
 * `isTodoWriteToolName` (every name it accepts contains `todo` or is
 * `update_plan`); the predicate itself still decides exactly.
 */
function completenessEventsStatement(db: SqliteDb): Database.Statement {
  return db.prepare(
    `SELECT event.value AS value
       FROM messages AS m,
            json_each(
              CASE
                WHEN json_valid(m.events_json) AND json_type(m.events_json) = 'array'
                  THEN m.events_json
                ELSE '[]'
              END
            ) AS event
      WHERE m.id = ?
        AND event.type = 'object'
        AND (
          json_extract(event.value, '$.kind') IN ('usage', 'done_key', 'text')
          OR (
            json_extract(event.value, '$.kind') = 'tool_use'
            AND (
              lower(json_extract(event.value, '$.name')) LIKE '%todo%'
              OR lower(json_extract(event.value, '$.name')) = 'update_plan'
            )
          )
        )
      ORDER BY CAST(event.key AS INTEGER)`,
  );
}

function completenessEventsOfMessage(statement: Database.Statement, messageId: string): unknown[] {
  const rows = statement.all(messageId) as Array<{ value: string }>;
  const events: unknown[] = [];
  for (const row of rows) {
    const event = parseJsonOrUndef(row.value);
    if (event !== undefined) events.push(event);
  }
  return events;
}

export function listLatestConversationRunStatuses(db: SqliteDb) {
  const rows = db
    .prepare(
      `SELECT m.conversation_id AS conversationId,
              m.run_id AS runId,
              m.run_status AS status,
              COALESCE(m.ended_at, m.started_at, m.created_at) AS updatedAt,
              m.position AS position
         FROM messages m
        WHERE m.run_status IS NOT NULL
        ORDER BY updatedAt DESC, m.position DESC`,
    )
    .all() as DbRow[];
  const latestByConversation = new Map<string, DbRow>();
  for (const row of rows) {
    if (!latestByConversation.has(row.conversationId)) {
      latestByConversation.set(row.conversationId, {
        value: normalizeProjectRunStatus(row.status),
        updatedAt: Number(row.updatedAt),
        runId: row.runId ?? undefined,
      });
    }
  }
  return latestByConversation;
}

export function listFirstConversationRunStatuses(db: SqliteDb) {
  const rows = db
    .prepare(
      `SELECT m.conversation_id AS conversationId,
              m.run_id AS runId,
              m.run_status AS status,
              COALESCE(m.ended_at, m.started_at, m.created_at) AS updatedAt,
              m.position AS position
         FROM messages m
        WHERE m.run_status IS NOT NULL
          AND m.run_id IS NOT NULL
        ORDER BY m.position ASC`,
    )
    .all() as DbRow[];
  const firstByConversation = new Map<string, DbRow>();
  for (const row of rows) {
    if (!firstByConversation.has(row.conversationId)) {
      firstByConversation.set(row.conversationId, {
        value: normalizeProjectRunStatus(row.status),
        updatedAt: Number(row.updatedAt),
        runId: row.runId ?? undefined,
      });
    }
  }
  return firstByConversation;
}

export function listLatestRunStatuses(db: SqliteDb) {
  const rows = db
    .prepare(
      `SELECT m.run_id AS runId,
              m.run_status AS status,
              COALESCE(m.ended_at, m.started_at, m.created_at) AS updatedAt,
              m.position AS position
         FROM messages m
        WHERE m.run_status IS NOT NULL
          AND m.run_id IS NOT NULL
        ORDER BY updatedAt DESC, m.position DESC`,
    )
    .all() as DbRow[];
  const latestByRun = new Map<string, DbRow>();
  for (const row of rows) {
    if (!latestByRun.has(row.runId)) {
      latestByRun.set(row.runId, {
        value: normalizeProjectRunStatus(row.status),
        updatedAt: Number(row.updatedAt),
        runId: row.runId ?? undefined,
      });
    }
  }
  return latestByRun;
}

/**
 * Cheap SQL prefilter for the awaiting-input latch.
 *
 * Only a prefilter: every renderable form necessarily contains one of these
 * substrings, so the predicate is a strict superset of the real answer and
 * cannot drop a genuine form. `ask-question` is an accepted alias for
 * `question-form` (UI parser + daemon detector), so an alias-form turn must be
 * a candidate too. The authoritative test is `emittedRenderableQuestionForm`,
 * applied to the candidate content in JS.
 */
const AWAITING_INPUT_MARKER_PREFILTER = `(
                LOWER(m.content) LIKE '%<question-form%'
                OR LOWER(m.content) LIKE '%<ask-question%'
              )`;

interface AwaitingInputCandidate {
  partitionKey: string;
  conversationId: string;
  createdAt: number;
  position: number;
  content: string;
}

type AwaitingInputWinner = Omit<AwaitingInputCandidate, 'partitionKey' | 'content'>;

/**
 * Which partitions are still waiting on an answer to a form the user can see?
 *
 * The invariant this preserves, unchanged from the single-statement query it
 * replaces: within each partition take the NEWEST form-bearing assistant
 * message (`created_at DESC, position DESC`), then report the partition only if
 * that message's own conversation has no later user message. A partition whose
 * newest form was already answered is not awaiting input, even when an older
 * unanswered form exists elsewhere in it.
 *
 * The strict check has to run BEFORE the newest-per-partition pick, not after
 * it. Post-filtering the winning rows would silently change which message is
 * considered latest: a stray, unrenderable marker emitted after a real
 * unanswered form would win the partition, fail the check, and drop a project
 * that is genuinely waiting on the user. So the pick happens here, over rows
 * already reduced to those that actually render.
 */
function listPartitionsAwaitingInput(
  db: SqliteDb,
  candidates: Iterable<AwaitingInputCandidate>,
): Set<string> {
  // Streamed, and the winner keeps no `content`: this runs on every
  // `GET /api/projects`, and the candidate set is every form-bearing assistant
  // message the database has ever stored. Materializing those turns' full text
  // would grow the cost of listing projects with the length of the history.
  const winners = new Map<string, AwaitingInputWinner>();
  for (const candidate of candidates) {
    if (winners.has(candidate.partitionKey)) continue;
    if (!emittedRenderableQuestionForm(candidate.content)) continue;
    winners.set(candidate.partitionKey, {
      conversationId: candidate.conversationId,
      createdAt: candidate.createdAt,
      position: candidate.position,
    });
  }
  // The loop above drains the row iterator before this point, so no statement
  // executes while it is still open.
  const laterUserReply = db.prepare(
    `SELECT 1
       FROM messages reply
      WHERE reply.conversation_id = ?
        AND reply.role = 'user'
        AND (
          reply.created_at > ?
          OR (reply.created_at = ? AND reply.position > ?)
        )
      LIMIT 1`,
  );
  const awaiting = new Set<string>();
  for (const [partitionKey, winner] of winners) {
    const answered = laterUserReply.get(
      winner.conversationId,
      winner.createdAt,
      winner.createdAt,
      winner.position,
    );
    if (!answered) awaiting.add(partitionKey);
  }
  return awaiting;
}

/**
 * With `projectId`, only that project's messages reach the marker prefilter: the
 * run-status feed asks once per subscribed project every few seconds, and
 * `idx_conv_project` then `idx_messages_conv` keep that read off everyone else's
 * history. The answer for that project is the same as the unscoped read's.
 */
export function listProjectsAwaitingInput(db: SqliteDb, projectId?: string) {
  const statement = db.prepare(
    `SELECT c.project_id AS partitionKey,
            m.conversation_id AS conversationId,
            m.created_at AS createdAt,
            m.position AS position,
            m.content AS content
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE ${projectId === undefined ? '' : 'c.project_id = ? AND '}m.role = 'assistant'
        AND ${AWAITING_INPUT_MARKER_PREFILTER}
      ORDER BY m.created_at DESC, m.position DESC`,
  );
  const rows = (
    projectId === undefined ? statement.iterate() : statement.iterate(projectId)
  ) as Iterable<AwaitingInputCandidate>;
  return listPartitionsAwaitingInput(db, rows);
}

/** Conversations whose last question to the user has no reply yet, optionally in one project. */
export function listConversationsAwaitingInput(db: SqliteDb, projectId?: string) {
  const statement = db.prepare(
    `SELECT m.conversation_id AS partitionKey,
            m.conversation_id AS conversationId,
            m.created_at AS createdAt,
            m.position AS position,
            m.content AS content
       FROM messages m
       ${projectId === undefined ? '' : 'JOIN conversations c ON c.id = m.conversation_id'}
      WHERE ${projectId === undefined ? '' : 'c.project_id = ? AND '}m.role = 'assistant'
        AND ${AWAITING_INPUT_MARKER_PREFILTER}
      ORDER BY m.created_at DESC, m.position DESC`,
  );
  const rows = (
    projectId === undefined ? statement.iterate() : statement.iterate(projectId)
  ) as Iterable<AwaitingInputCandidate>;
  return listPartitionsAwaitingInput(db, rows);
}

export function getProject(db: SqliteDb, id: string) {
  const row = db
    .prepare(`SELECT ${PROJECT_COLS} FROM projects WHERE id = ?`)
    .get(id) as DbRow | undefined;
  return row ? normalizeProject(row) : null;
}

export function insertProject(db: SqliteDb, p: DbRow) {
  db.prepare(
    `INSERT INTO projects
       (id, name, skill_id, pending_prompt,
        metadata_json, custom_instructions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.name,
    p.skillId ?? null,
    p.pendingPrompt ?? null,
    p.metadata ? JSON.stringify(p.metadata) : null,
    p.customInstructions ?? null,
    p.createdAt,
    p.updatedAt,
  );
  return getProject(db, p.id);
}

export function updateProject(db: SqliteDb, id: string, patch: DbRow) {
  const existing = getProject(db, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    updatedAt: nextUpdatedAt(patch.updatedAt, existing.updatedAt),
  };
  db.prepare(
    `UPDATE projects
        SET name = ?,
            skill_id = ?,
            pending_prompt = ?,
            metadata_json = ?,
            custom_instructions = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    merged.name,
    merged.skillId ?? null,
    merged.pendingPrompt ?? null,
    merged.metadata ? JSON.stringify(merged.metadata) : null,
    merged.customInstructions ?? null,
    merged.updatedAt,
    id,
  );
  return getProject(db, id);
}

export function deleteProject(db: SqliteDb, id: string) {
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
}

function normalizeProject(row: DbRow) {
  let metadata;
  if (row.metadataJson) {
    try {
      metadata = JSON.parse(row.metadataJson);
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: row.id,
    name: row.name,
    skillId: row.skillId,
    pendingPrompt: row.pendingPrompt ?? undefined,
    metadata,
    appliedPluginSnapshotId: row.appliedPluginSnapshotId ?? undefined,
    customInstructions: row.customInstructions ?? undefined,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function normalizeProjectRunStatus(status: unknown) {
  if (status === 'starting') return 'running';
  if (status === 'cancelled') return 'canceled';
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'canceled'
  ) {
    return status;
  }
  return 'not_started';
}

// ---------- templates ----------

export function listTemplates(db: SqliteDb) {
  return (db
    .prepare(
      `SELECT id, name, description, source_project_id AS sourceProjectId,
              files_json AS filesJson, created_at AS createdAt
         FROM templates
        ORDER BY created_at DESC`,
    )
    .all() as DbRow[])
    .map(normalizeTemplate);
}

export function getTemplate(db: SqliteDb, id: string) {
  const row = db
    .prepare(
      `SELECT id, name, description, source_project_id AS sourceProjectId,
              files_json AS filesJson, created_at AS createdAt
         FROM templates WHERE id = ?`,
    )
    .get(id) as DbRow | undefined;
  return row ? normalizeTemplate(row) : null;
}

export function findTemplateByNameAndProject(
  db: SqliteDb,
  name: string,
  sourceProjectId: string,
) {
  const row = db
    .prepare(
      `SELECT id, name, description, source_project_id AS sourceProjectId,
              files_json AS filesJson, created_at AS createdAt
         FROM templates
        WHERE name = ? AND source_project_id = ?`,
    )
    .get(name, sourceProjectId) as DbRow | undefined;
  return row ? normalizeTemplate(row) : null;
}

export function insertTemplate(db: SqliteDb, t: DbRow) {
  db.prepare(
    `INSERT INTO templates (id, name, description, source_project_id, files_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id,
    t.name,
    t.description ?? null,
    t.sourceProjectId ?? null,
    JSON.stringify(t.files ?? []),
    t.createdAt,
  );
  return getTemplate(db, t.id);
}

export function updateTemplate(
  db: SqliteDb,
  id: string,
  t: { description: string | null; files: unknown[] },
) {
  db.prepare(
    `UPDATE templates SET description = ?, files_json = ? WHERE id = ?`,
  ).run(t.description, JSON.stringify(t.files), id);
  return getTemplate(db, id);
}

export function deleteTemplate(db: SqliteDb, id: string) {
  db.prepare(`DELETE FROM templates WHERE id = ?`).run(id);
}

function normalizeTemplate(row: DbRow) {
  let files = [];
  try {
    files = JSON.parse(row.filesJson || '[]');
  } catch {
    files = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    sourceProjectId: row.sourceProjectId ?? undefined,
    files,
    createdAt: Number(row.createdAt),
  };
}

// ---------- conversations ----------

export function listConversations(db: SqliteDb, projectId: string) {
  const listed = rows(db
    .prepare(
      `WITH project_conversations AS (
          SELECT id, project_id AS projectId, title, session_mode AS sessionMode,
                 created_at AS createdAt, updated_at AS updatedAt
           FROM conversations
           WHERE project_id = ?
             AND id NOT LIKE 'comment-anchor-%'
        ),
        latest_runs AS (
          SELECT conversation_id AS conversationId,
                 run_status AS latestRunStatus,
                 started_at AS latestRunStartedAt,
                 ended_at AS latestRunEndedAt,
                 agent_id AS latestRunAgentId,
                 id AS latestRunMessageId
            FROM (
              SELECT m.conversation_id,
                     m.run_status,
                     m.started_at,
                     m.ended_at,
                     m.agent_id,
                     m.id,
                     ROW_NUMBER() OVER (
                       PARTITION BY m.conversation_id
                       ORDER BY m.position DESC
                     ) AS rn
                FROM messages m
                JOIN project_conversations c ON c.id = m.conversation_id
               WHERE m.role = 'assistant'
                 AND m.run_status IS NOT NULL
            )
           WHERE rn = 1
        ),
        message_counts AS (
          SELECT m.conversation_id AS conversationId,
                 COUNT(*) AS messageCount
            FROM messages m
            JOIN project_conversations c ON c.id = m.conversation_id
           GROUP BY m.conversation_id
        ),
        total_run_durations AS (
          SELECT m.conversation_id AS conversationId,
                 SUM(${terminalRunDurationSql('m')}) AS totalDurationMs
            FROM messages m
            JOIN project_conversations c ON c.id = m.conversation_id
           WHERE m.role = 'assistant'
             AND m.run_status IN ('succeeded', 'failed', 'canceled')
           GROUP BY m.conversation_id
        )
        SELECT c.id, c.projectId, c.title, c.sessionMode, c.createdAt, c.updatedAt,
               COALESCE(mc.messageCount, 0) AS messageCount,
               lr.latestRunStatus, lr.latestRunStartedAt,
               lr.latestRunEndedAt, lr.latestRunMessageId, lr.latestRunAgentId,
               trd.totalDurationMs
          FROM project_conversations c
          LEFT JOIN latest_runs lr ON lr.conversationId = c.id
          LEFT JOIN message_counts mc ON mc.conversationId = c.id
          LEFT JOIN total_run_durations trd ON trd.conversationId = c.id
         ORDER BY c.updatedAt DESC`,
    )
    .all(projectId));
  return attachLatestRunEvents(db, listed).map(normalizeConversation);
}

/**
 * Resolve `latestRunEventsJson` for the rows that actually need it.
 *
 * The summary only reads the event log to recover a `durationMs` from the run's
 * last `usage` event, and only when the run's timestamps cannot supply one (see
 * `conversationRunSummaryFromRow`). Selecting `events_json` inside the
 * `latest_runs` window function instead forces SQLite to materialize the full
 * event log of every assistant message in the project just to order them —
 * unbounded work for a field the common path never looks at, since event logs
 * grow with tool output (image tool results carry inline base64).
 *
 * So the query carries only the message id, and the log is fetched here for the
 * few rows whose timestamps are incomplete. A project whose runs all ended
 * normally reads no event logs at all.
 */
function attachLatestRunEvents(db: SqliteDb, listed: DbRow[]): DbRow[] {
  // Mirror `conversationRunSummaryFromRow`'s own nullish handling exactly: it
  // maps a null timestamp to `undefined` before the finiteness check, so a null
  // column means "no duration available from timestamps". Testing
  // `Number.isFinite(Number(value))` instead would treat null as 0 — a finite
  // number — and silently skip the fetch for precisely the rows that need it.
  const hasBothTimestamps = (row: DbRow) =>
    row.latestRunStartedAt != null
    && row.latestRunEndedAt != null
    && Number.isFinite(Number(row.latestRunStartedAt))
    && Number.isFinite(Number(row.latestRunEndedAt));

  const pending = listed.filter(
    (row) => row.latestRunMessageId != null && !hasBothTimestamps(row),
  );
  if (pending.length === 0) return listed;

  const statement = db.prepare(
    `SELECT events_json AS eventsJson FROM messages WHERE id = ?`,
  );
  for (const row of pending) {
    const found = statement.get(row.latestRunMessageId) as DbRow | undefined;
    row.latestRunEventsJson = found?.eventsJson ?? null;
  }
  return listed;
}

/**
 * Return the conversation that was inserted first for a project.
 *
 * Project creation seeds this row before any side conversations exist.
 * `created_at` normally identifies it, while `rowid` preserves insertion
 * order when two conversations are created within the same millisecond.
 * Keep this separate from `listConversations`, whose updated-at ordering is a
 * user-facing recency contract.
 */
export function getFirstProjectConversation(db: SqliteDb, projectId: string) {
  const result = db
    .prepare(
      `SELECT id
         FROM conversations
        WHERE project_id = ?
        ORDER BY created_at ASC, rowid ASC
        LIMIT 1`,
    )
    .get(projectId) as { id?: unknown } | undefined;
  return typeof result?.id === 'string'
    ? getConversation(db, result.id)
    : null;
}

export function getConversation(db: SqliteDb, id: string) {
  const r = db
    .prepare(
      `SELECT id, project_id AS projectId, title, session_mode AS sessionMode,
              created_at AS createdAt, updated_at AS updatedAt,
              (SELECT agent_id FROM messages WHERE conversation_id = conversations.id
                 AND role = 'assistant' AND run_status IS NOT NULL ORDER BY position DESC LIMIT 1) AS latestRunAgentId,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) AS messageCount
         FROM conversations WHERE id = ?`,
    )
    .get(id) as DbRow | undefined;
  if (!r) return null;
  return {
    ...normalizeConversation(r),
    latestRun: latestConversationRunSummary(db, r.id) ?? undefined,
    ...numberProperty('totalDurationMs', totalConversationRunDurationMs(db, r.id)),
  };
}

function normalizeConversation(r: DbRow) {
  const latestRun = conversationRunSummaryFromRow({
    runStatus: r.latestRunStatus,
    startedAt: r.latestRunStartedAt,
    endedAt: r.latestRunEndedAt,
    eventsJson: r.latestRunEventsJson,
  });
  return {
    id: r.id,
    projectId: r.projectId,
    title: r.title ?? null,
    sessionMode: normalizeConversationSessionMode(r.sessionMode),
    messageCount: Number(r.messageCount ?? 0),
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    ...numberProperty('totalDurationMs', r.totalDurationMs),
    ...(typeof r.latestRunAgentId === 'string' && r.latestRunAgentId ? { latestRunAgentId: r.latestRunAgentId } : {}),
    latestRun: latestRun ?? undefined,
  };
}

export function normalizeConversationSessionMode(value: unknown): ChatSessionMode {
  return value === 'chat' || value === 'plan' ? value : 'design';
}

function numberProperty(key: string, value: unknown) {
  const n = value == null ? undefined : Number(value);
  return typeof n === 'number' && Number.isFinite(n) ? { [key]: n } : {};
}

function latestConversationRunSummary(db: SqliteDb, conversationId: string) {
  const row = db
    .prepare(
      `SELECT run_status AS runStatus,
              started_at AS startedAt,
              ended_at AS endedAt,
              events_json AS eventsJson
         FROM messages
        WHERE conversation_id = ?
          AND role = 'assistant'
          AND run_status IS NOT NULL
        ORDER BY position DESC
        LIMIT 1`,
    )
    .get(conversationId) as DbRow | undefined;
  return conversationRunSummaryFromRow(row);
}

function totalConversationRunDurationMs(db: SqliteDb, conversationId: string): number | undefined {
  const row = db
    .prepare(
      `SELECT SUM(${terminalRunDurationSql()}) AS totalDurationMs
         FROM messages
        WHERE conversation_id = ?
          AND role = 'assistant'
          AND run_status IN ('succeeded', 'failed', 'canceled')`,
    )
    .get(conversationId) as DbRow | undefined;
  return row?.totalDurationMs == null ? undefined : Number(row.totalDurationMs);
}

function terminalRunDurationSql(alias?: string) {
  const p = alias ? `${alias}.` : '';
  return `CASE
            WHEN ${p}started_at IS NOT NULL AND ${p}ended_at IS NOT NULL THEN
              CASE
                WHEN CAST(${p}ended_at AS INTEGER) >= CAST(${p}started_at AS INTEGER)
                  THEN CAST(${p}ended_at AS INTEGER) - CAST(${p}started_at AS INTEGER)
                ELSE 0
              END
            ELSE (
              SELECT CASE
                       WHEN json_extract(usage_event.value, '$.durationMs') >= 0
                         THEN json_extract(usage_event.value, '$.durationMs')
                       ELSE 0
                     END
                FROM json_each(
                  CASE
                    WHEN json_valid(${p}events_json) AND json_type(${p}events_json) = 'array'
                      THEN ${p}events_json
                    ELSE '[]'
                  END
                ) AS usage_event
               WHERE usage_event.type = 'object'
                 AND json_extract(usage_event.value, '$.kind') = 'usage'
                 AND json_type(usage_event.value, '$.durationMs') IN ('integer', 'real')
               ORDER BY CAST(usage_event.key AS INTEGER) DESC
               LIMIT 1
            )
          END`;
}

function conversationRunSummaryFromRow(row: DbRow | undefined) {
  if (!row || typeof row.runStatus !== 'string') return null;
  const startedAt = row.startedAt == null ? undefined : Number(row.startedAt);
  const endedAt = row.endedAt == null ? undefined : Number(row.endedAt);
  const usageDurationMs = latestUsageDurationMs(row.eventsJson);
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(endedAt)
      ? Math.max(0, (endedAt as number) - (startedAt as number))
      : usageDurationMs;
  return {
    status: row.runStatus,
    ...(Number.isFinite(startedAt) ? { startedAt } : {}),
    ...(Number.isFinite(endedAt) ? { endedAt } : {}),
    ...(typeof durationMs === 'number' && Number.isFinite(durationMs)
      ? { durationMs }
      : {}),
  };
}

function latestUsageDurationMs(eventsJson: unknown): number | undefined {
  if (typeof eventsJson !== 'string' || eventsJson.length === 0) return undefined;
  try {
    const events = JSON.parse(eventsJson);
    if (!Array.isArray(events)) return undefined;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (
        event &&
        typeof event === 'object' &&
        event.kind === 'usage' &&
        typeof event.durationMs === 'number' &&
        Number.isFinite(event.durationMs)
      ) {
        return Math.max(0, event.durationMs);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function insertConversation(db: SqliteDb, c: DbRow) {
  db.prepare(
    `INSERT INTO conversations
       (id, project_id, title, session_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    c.id,
    c.projectId,
    c.title ?? null,
    normalizeConversationSessionMode(c.sessionMode),
    c.createdAt,
    c.updatedAt,
  );
  return getConversation(db, c.id);
}

export function updateConversation(db: SqliteDb, id: string, patch: DbRow) {
  const existing = getConversation(db, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    sessionMode: Object.prototype.hasOwnProperty.call(patch, 'sessionMode')
      ? normalizeConversationSessionMode(patch.sessionMode)
      : existing.sessionMode,
    updatedAt: typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now(),
  };
  db.prepare(
    `UPDATE conversations
        SET title = ?, session_mode = ?, updated_at = ? WHERE id = ?`,
  ).run(merged.title ?? null, merged.sessionMode, merged.updatedAt, id);
  return getConversation(db, id);
}

export function deleteConversation(db: SqliteDb, id: string) {
  db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
}

// ---------- agent sessions ----------

export function getAgentSession(
  db: SqliteDb,
  conversationId: string,
  agentId: string,
): string | null {
  const row = db
    .prepare(
      `SELECT session_id FROM agent_sessions
        WHERE conversation_id = ? AND agent_id = ?`,
    )
    .get(conversationId, agentId) as DbRow | undefined;
  return row && typeof row.session_id === 'string' ? row.session_id : null;
}

export function upsertAgentSession(
  db: SqliteDb,
  input: {
    conversationId: string;
    agentId: string;
    sessionId: string;
    stablePromptHash?: string | null;
    stablePromptSections?: string | null;
    model?: string | null;
    cwd?: string | null;
    lastMessageId?: string | null;
    lastInputTokens?: number | null;
  },
): void {
  const lastInputTokens =
    typeof input.lastInputTokens === 'number' &&
    Number.isSafeInteger(input.lastInputTokens) &&
    input.lastInputTokens >= 0 &&
    input.lastInputTokens <= 1_000_000_000
      ? input.lastInputTokens
      : null;
  db.prepare(
    `INSERT INTO agent_sessions
       (conversation_id, agent_id, session_id, stable_prompt_hash, stable_prompt_sections,
        model, cwd, last_message_id, last_input_tokens, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id, agent_id)
       DO UPDATE SET session_id = excluded.session_id,
                     stable_prompt_hash = excluded.stable_prompt_hash,
                     stable_prompt_sections = excluded.stable_prompt_sections,
                     model = excluded.model,
                     cwd = excluded.cwd,
                     last_message_id = excluded.last_message_id,
                     last_input_tokens = CASE
                       WHEN excluded.session_id = agent_sessions.session_id
                         THEN COALESCE(excluded.last_input_tokens, agent_sessions.last_input_tokens)
                       ELSE excluded.last_input_tokens
                     END,
                     updated_at = excluded.updated_at`,
  ).run(
    input.conversationId,
    input.agentId,
    input.sessionId,
    input.stablePromptHash ?? null,
    input.stablePromptSections ?? null,
    input.model ?? null,
    input.cwd ?? null,
    input.lastMessageId ?? null,
    lastInputTokens,
    Date.now(),
  );
}

export function getAgentSessionRecord(
  db: SqliteDb,
  conversationId: string,
  agentId: string,
): {
  sessionId: string;
  stablePromptHash: string | null;
  stablePromptSections: string | null;
  model: string | null;
  cwd: string | null;
  lastMessageId: string | null;
  lastInputTokens: number | null;
} | null {
  const row = db
    .prepare(
      `SELECT session_id, stable_prompt_hash, stable_prompt_sections, model, cwd, last_message_id,
              last_input_tokens
         FROM agent_sessions
        WHERE conversation_id = ? AND agent_id = ?`,
    )
    .get(conversationId, agentId) as DbRow | undefined;
  if (!row || typeof row.session_id !== 'string') return null;
  return {
    sessionId: row.session_id,
    stablePromptHash:
      typeof row.stable_prompt_hash === 'string' ? row.stable_prompt_hash : null,
    stablePromptSections:
      typeof row.stable_prompt_sections === 'string' ? row.stable_prompt_sections : null,
    model: typeof row.model === 'string' ? row.model : null,
    cwd: typeof row.cwd === 'string' ? row.cwd : null,
    lastMessageId: typeof row.last_message_id === 'string' ? row.last_message_id : null,
    lastInputTokens:
      typeof row.last_input_tokens === 'number' &&
      Number.isSafeInteger(row.last_input_tokens) &&
      row.last_input_tokens >= 0 &&
      row.last_input_tokens <= 1_000_000_000
        ? row.last_input_tokens
        : null,
  };
}

// Conversation cursor for the resume identity guard: the id of the latest
// COMPLETED assistant message in the conversation, EXCLUDING the current run's
// in-flight placeholder (`excludeMessageId`). At resolve time the session is in
// sync iff this equals the assistant message the session last produced —
// otherwise another agent completed a turn in between, or the session's own last
// message was edited/removed, and the session is behind. Returns null when there
// is no prior completed assistant turn.
//
// "Completed" means run_status = 'succeeded' — a run stamps its assistant
// message with the terminal status on finish (server.ts), so an intervening
// agent run that FAILED or was CANCELED leaves a placeholder that produced no
// completed turn; counting it as advancement would force a needless cold reseed
// (silently disabling the resume perf path) even though the stored session is
// still the latest completed turn. In-flight placeholders have a null run_status
// and are likewise excluded.
//
// `resumableMessageId` is the one allowed exception: the resume-on-failure path
// persists a session whose own last assistant turn FAILED transiently (the CLI
// session already committed a tool/artifact block and is resumable). That stored
// id is admitted through the filter so the session it owns still matches its
// cursor — while a DIFFERENT later failed/canceled turn (a different id) stays
// excluded, so genuine advancement by a later succeeded turn is still detected.
export function latestCompletedAssistantMessageId(
  db: SqliteDb,
  conversationId: string,
  excludeMessageId: string,
  resumableMessageId: string | null = null,
): string | null {
  const row = db
    .prepare(
      // `excludeMessageId` keeps the caller's in-flight placeholder — which the
      // stored session has never seen — from counting as advancement. When that
      // placeholder IS the stored cursor (a daemon-internal restart re-entering
      // with the same message), the session did produce it, so the exclusion
      // must not apply: that is what `resumableMessageId` is for, and the
      // exclusion used to consume the row before the admission could.
      // Advancement detection is unaffected — any later `succeeded` message
      // still wins on `position DESC` and still fails the cursor comparison.
      `SELECT id FROM messages
        WHERE conversation_id = ? AND role = 'assistant'
          AND (id != ? OR id = ?)
          AND (run_status = 'succeeded' OR id = ?)
        ORDER BY position DESC LIMIT 1`,
    )
    .get(
      conversationId,
      excludeMessageId,
      resumableMessageId,
      resumableMessageId,
    ) as DbRow | undefined;
  return row && typeof row.id === 'string' ? row.id : null;
}

/**
 * The user request that produced `assistantMessageId` — i.e. what the upstream
 * session that ended on that assistant turn was working on.
 *
 * Anchored on the stored resume cursor rather than "the newest user message",
 * because by prompt-composition time the current turn's own user row is already
 * seeded (`seedRunUserMessage`) and would win a naive lookup. Returns null when
 * the anchor row is gone or nothing precedes it — the caller must then
 * synthesize no context at all rather than guess at one.
 */
export function userRequestBeforeAssistantMessage(
  db: SqliteDb,
  conversationId: string,
  assistantMessageId: string,
): string | null {
  const row = db
    .prepare(
      // A missing anchor makes the subquery NULL, so `position < NULL` matches
      // nothing and the caller correctly gets null instead of the latest turn.
      `SELECT content FROM messages
        WHERE conversation_id = ? AND role = 'user'
          AND position < (SELECT position FROM messages WHERE id = ?)
        ORDER BY position DESC LIMIT 1`,
    )
    .get(conversationId, assistantMessageId) as DbRow | undefined;
  const content = row && typeof row.content === 'string' ? row.content.trim() : '';
  return content.length > 0 ? content : null;
}

/**
 * How far back a run start looks for the conversation's last declared task
 * list. A plan is recalled from the RECENT past, not from the whole
 * conversation — and the bound is also the cost ceiling: 21 of the 27 runtimes
 * never emit a task list at all, so without it every one of their run starts
 * would read every assistant message's `events_json` blob in the conversation.
 */
const TODO_RECALL_MESSAGE_LOOKBACK = 8;

/**
 * The conversation's most recently declared task list — the raw TodoWrite
 * `input` — walking back from the newest assistant turn, or `null` when none of
 * the recent turns declared one.
 *
 * Deliberately NOT `latestCompletedAssistantMessageId`'s `run_status =
 * 'succeeded'` filter: a turn that was interrupted or failed is precisely the
 * turn most likely to have left work open, and it is the one we most want to
 * hand back. Only `excludeMessageId` — the current run's own in-flight
 * placeholder — is skipped.
 *
 * Walking PAST a turn that declared no list is intentional: an unrelated
 * question answered in between does not close the outstanding plan.
 */
export function latestTodoWriteInputForConversation(
  db: SqliteDb,
  conversationId: string,
  excludeMessageId: string,
): unknown | null {
  const rows = db
    .prepare(
      `SELECT id, events_json AS eventsJson FROM messages
        WHERE conversation_id = ? AND role = 'assistant' AND id != ?
        ORDER BY position DESC LIMIT ?`,
    )
    .all(conversationId, excludeMessageId, TODO_RECALL_MESSAGE_LOOKBACK) as DbRow[];
  for (const row of rows) {
    const events = materializeMessageAgentEvents(db, String(row.id), row.eventsJson).events;
    const input = latestTodoWriteInputFromEvents(events);
    if (input != null) return input;
  }
  return null;
}

export function updateAgentSessionStableHash(
  db: SqliteDb,
  conversationId: string,
  agentId: string,
  stablePromptHash: string,
): void {
  db.prepare(
    `UPDATE agent_sessions SET stable_prompt_hash = ?, updated_at = ?
      WHERE conversation_id = ? AND agent_id = ?`,
  ).run(stablePromptHash, Date.now(), conversationId, agentId);
}

export function clearAgentSession(
  db: SqliteDb,
  conversationId: string,
  agentId: string,
): void {
  db.prepare(
    `DELETE FROM agent_sessions WHERE conversation_id = ? AND agent_id = ?`,
  ).run(conversationId, agentId);
}

// ---------- messages ----------

/**
 * Number of messages in a conversation.
 *
 * For emptiness checks prefer this over `listMessages(...).length`: the latter
 * loads and parses every message's JSON columns — including the event log,
 * which grows with tool output — to answer a question `COUNT(*)` answers
 * without touching them.
 */
export function countMessages(db: SqliteDb, conversationId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?`)
    .get(conversationId) as DbRow | undefined;
  return Number(row?.count ?? 0);
}

/**
 * The `done_key` every OTHER assistant row of a conversation was recorded with
 * — the Run identities `excludeMessageId` must never be allowed to absorb (see
 * the PUT guard in `routes/project/conversations.ts`).
 *
 * Each physical Run mints exactly one key and emits it before any model output,
 * so a row's FIRST well-formed `done_key` event is that row's Run identity;
 * later keys in the same list are the damage the guard exists to stop, so only
 * the first one counts and an already-damaged sibling cannot re-export the key
 * it absorbed.
 *
 * Invariant: each sibling's key is read inside SQLite. This runs on every
 * message PUT, and a sibling's event log can hold any amount of tool output, so
 * no sibling event log is ever materialized or parsed in JS here.
 */
export function listSiblingRunDoneKeys(
  db: SqliteDb,
  conversationId: string,
  excludeMessageId: string,
): Set<string> {
  const rows = db
    .prepare(
      `SELECT (
          SELECT json_extract(event.value, '$.key')
            FROM json_each(m.events_json) AS event
           WHERE event.type = 'object'
             AND json_extract(event.value, '$.kind') = 'done_key'
             AND json_type(event.value, '$.key') = 'text'
             AND json_extract(event.value, '$.key') <> ''
           ORDER BY CAST(event.key AS INTEGER)
           LIMIT 1
        ) AS doneKey
         FROM messages AS m
        WHERE m.conversation_id = ?
          AND m.role = 'assistant'
          AND m.id <> ?
          AND m.events_json IS NOT NULL
          AND m.events_json LIKE '%"done_key"%'
          AND json_valid(m.events_json)
          AND json_type(m.events_json) = 'array'`,
    )
    .all(conversationId, excludeMessageId) as Array<{ doneKey: unknown }>;
  const keys = new Set<string>();
  for (const row of rows) {
    if (typeof row.doneKey === 'string' && row.doneKey) keys.add(row.doneKey);
  }
  return keys;
}

export function listMessages(db: SqliteDb, conversationId: string) {
  return observeRead('conversation_messages', () => listMessagesUnobserved(db, conversationId), {
    rows: (result) => result.length,
  });
}

function listMessagesUnobserved(db: SqliteDb, conversationId: string) {
  const messages = db
    .prepare(
      `SELECT id, role, content, agent_id AS agentId, agent_name AS agentName,
              run_id AS runId, run_status AS runStatus,
              result_delivery_state AS resultDeliveryState,
              last_run_event_id AS lastRunEventId,
              events_json AS eventsJson,
              attachments_json AS attachmentsJson,
              produced_files_json AS producedFilesJson,
              trace_object_files_json AS traceObjectFilesJson,
              feedback_json AS feedbackJson,
              pre_turn_file_names_json AS preTurnFileNamesJson,
              session_mode AS sessionMode,
              run_context_json AS runContextJson,
              task_analytics_json AS taskAnalyticsJson,
              applied_plugin_snapshot_json AS appliedPluginSnapshotJson,
              forked_into_json AS forkedIntoJson,
              cancel_origin AS cancelOrigin,
              created_at AS createdAt, started_at AS startedAt, ended_at AS endedAt,
              position
         FROM messages
        WHERE conversation_id = ?
        ORDER BY position ASC`,
    );
  const eventBatches = readConversationMessageEventBatches(db, conversationId);
  // One query for the whole conversation. A per-message lookup here would be a
  // straight N+1 on every transcript read.
  const artifactRefs = conversationChatArtifactRefs(db, conversationId);
  // Rows are normalized one at a time, so only one row's stored event log is
  // held at full size at once: rows written before the run-event payload
  // budget can be MBs each, and normalizing bounds them (see
  // `normalizeMessage`). Nothing below runs another statement while the
  // iterator is open — batches and artifact refs were read above. Lightweight
  // adapters that model only `all()` (see `hasMessageEventBatchStorage`) get
  // the same rows in one step.
  const rows = typeof messages.iterate === 'function'
    ? (messages.iterate(conversationId) as Iterable<DbRow>)
    : (messages.all(conversationId) as DbRow[]);
  const normalized = [];
  for (const message of rows) {
    normalized.push(normalizeMessage(
      db,
      message,
      eventBatches.get(String(message.id)) ?? [],
      artifactRefs.get(String(message.id)) ?? [],
    ));
  }
  return normalized;
}

function projectIdForConversation(db: SqliteDb, conversationId: string): string | null {
  const row = db
    .prepare(`SELECT project_id AS projectId FROM conversations WHERE id = ?`)
    .get(conversationId) as DbRow | undefined;
  return typeof row?.projectId === 'string' ? row.projectId : null;
}

function conversationChatArtifactRefs(
  db: SqliteDb,
  conversationId: string,
): Map<string, ChatArtifactRef[]> {
  try {
    const projectId = projectIdForConversation(db, conversationId);
    if (!projectId) return new Map();
    return projectConversationChatArtifactRefs(db, projectId, conversationId);
  } catch {
    // A snapshot store problem must never make a conversation unreadable.
    //
    // The owning-project lookup is INSIDE this guard, not in front of it. It
    // reads a different table than the refs themselves, so it can fail on its
    // own — and when it did, the throw travelled all the way out of
    // `listMessages` and the transcript came back empty. Artifact refs decorate
    // a conversation; nothing about them is worth losing its messages over.
    return new Map();
  }
}

export function getMessage(db: SqliteDb, id: string, conversationId?: string) {
  const row = db
    .prepare(
      `SELECT id, role, content, agent_id AS agentId, agent_name AS agentName,
              run_id AS runId, run_status AS runStatus,
              result_delivery_state AS resultDeliveryState,
              last_run_event_id AS lastRunEventId,
              events_json AS eventsJson,
              attachments_json AS attachmentsJson,
              produced_files_json AS producedFilesJson,
              trace_object_files_json AS traceObjectFilesJson,
              feedback_json AS feedbackJson,
              pre_turn_file_names_json AS preTurnFileNamesJson,
              session_mode AS sessionMode,
              run_context_json AS runContextJson,
              applied_plugin_snapshot_json AS appliedPluginSnapshotJson,
              forked_into_json AS forkedIntoJson,
              cancel_origin AS cancelOrigin,
              created_at AS createdAt, started_at AS startedAt, ended_at AS endedAt,
              position
         FROM messages
        WHERE id = ?${conversationId ? ' AND conversation_id = ?' : ''}`,
    )
    .get(conversationId ? [id, conversationId] : id) as DbRow | undefined;
  if (!row) return null;
  return normalizeMessage(db, row, undefined, messageChatArtifactRefs(db, String(row.id)));
}

function messageChatArtifactRefs(db: SqliteDb, messageId: string): ChatArtifactRef[] {
  const owner = db
    .prepare(
      `SELECT c.project_id AS projectId FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = ?`,
    )
    .get(messageId) as DbRow | undefined;
  if (typeof owner?.projectId !== 'string') return [];
  try {
    return projectChatArtifactRefs(db, owner.projectId, messageId);
  } catch {
    // A snapshot store problem must never make a message unreadable.
    return [];
  }
}

/**
 * Materialize artifact refs for a message that has none yet.
 *
 * This is what makes CONVERSATION FORK work: the fork copies each source
 * message under a fresh id, and the copy re-seeds its own `message_artifacts`
 * rows pointing at the SAME immutable snapshots. Blobs are shared, never
 * duplicated, and the two branches count independently — deleting one branch's
 * message cannot take the other branch's evidence with it.
 *
 * Refs are only seeded when the message has none. A browser PUT that echoes a
 * stale projection back must not be able to overwrite refs the daemon wrote at
 * the run's terminal chokepoint.
 */
function seedMessageArtifactRefsIfAbsent(
  db: SqliteDb,
  messageId: string,
  refs: unknown,
): void {
  if (!Array.isArray(refs) || refs.length === 0) return;
  try {
    if (listMessageArtifactRows(db, messageId).length > 0) return;
    const inputs = refs.flatMap((raw) => {
      const ref = raw as Partial<ChatArtifactRef>;
      if (
        typeof ref?.label !== 'string' ||
        typeof ref.kind !== 'string' ||
        (ref.displayPolicy !== 'immutable_snapshot' &&
          ref.displayPolicy !== 'latest_with_static_preview')
      ) return [];
      return [{
        label: ref.label,
        kind: ref.kind,
        displayPolicy: ref.displayPolicy,
        snapshotId: typeof ref.snapshotId === 'string' ? ref.snapshotId : null,
        workspaceArtifactId:
          typeof ref.workspaceArtifactId === 'string' ? ref.workspaceArtifactId : null,
        // `html_version_id` is daemon-internal lineage that never crosses the
        // wire, so a fork rebuilt from the DTO cannot carry it. It is optional
        // diagnostics; the snapshot itself is what the fork actually needs.
      }];
    });
    if (inputs.length === 0) return;
    replaceMessageArtifacts(db, messageId, inputs);
  } catch (error) {
    // A fork that cannot carry its refs still forks. The copy simply shows no
    // cards rather than blocking the branch.
    console.warn('[db] failed to seed message artifact refs', error);
  }
}

export function conversationTurnIndexForRun(
  db: SqliteDb,
  conversationId: string,
  runId: string,
): number | null {
  const row = db
    .prepare(
      `SELECT (
          SELECT COUNT(*)
            FROM messages AS previous
           WHERE previous.conversation_id = current.conversation_id
             AND previous.role = 'assistant'
             AND previous.run_id IS NOT NULL
             AND previous.position < current.position
        ) AS conversationTurnIndex
         FROM messages AS current
        WHERE current.conversation_id = ?
          AND current.role = 'assistant'
          AND current.run_id = ?
        ORDER BY current.position ASC
        LIMIT 1`,
    )
    .get(conversationId, runId) as DbRow | undefined;
  const index = row?.conversationTurnIndex;
  return typeof index === 'number' && Number.isInteger(index) && index >= 0
    ? index
    : null;
}

export function upsertMessage(db: SqliteDb, conversationId: string, m: DbRow) {
  const persistedEvents = Array.isArray(m.events)
    ? compactAdjacentMessageAgentEvents(m.events)
    : m.events;
  const eventBatchProjection = hasMessageEventBatchStorage(db)
    ? `EXISTS(
                SELECT 1 FROM message_event_batches AS batch
                 WHERE batch.message_id = messages.id
              )`
    : '0';
  const existing = db
    .prepare(
      `SELECT position, run_id AS runId, run_status AS runStatus,
              content, events_json AS eventsJson,
              task_analytics_json AS taskAnalyticsJson,
              ${eventBatchProjection} AS hasEventBatches
         FROM messages WHERE id = ?`,
    )
    .get(m.id) as DbRow | undefined;
  const now = Date.now();
  if (existing) {
    // While the daemon owns an active run, its append-only batches are the
    // event source of truth. Browser PUT snapshots can arrive between two
    // daemon flushes; writing that whole snapshot here would duplicate the
    // same events when the next batch is read or finalized.
    const incomingRunIsTerminal = isTerminalMessageRunStatus(m.runStatus);
    const preserveDaemonEventSnapshot =
      existing.hasEventBatches === 1 ||
      (typeof existing.runId === 'string' &&
        (existing.runStatus === 'queued' || existing.runStatus === 'running') &&
        !incomingRunIsTerminal);
    const nextEventsJson = preserveDaemonEventSnapshot
      ? existing.eventsJson ?? null
      : persistedEvents
        ? serializeRunEventsForStorage(persistedEvents)
        : null;
    const nextContent = preserveDaemonEventSnapshot
      ? existing.content ?? ''
      : m.content;
    // A turn's recovery lineage is written once, by whoever owns the turn. A
    // rewrite that carries no opinion about it — above all the run-create seed,
    // which rebuilds this row from the request that won the claim — must not
    // erase it, or an accepted answer loses the logical task it belongs to
    // after a reload. An explicit null still clears it.
    const nextTaskAnalyticsJson =
      m.taskAnalytics === undefined
        ? ((existing.taskAnalyticsJson as string | null) ?? null)
        : m.taskAnalytics
          ? JSON.stringify(m.taskAnalytics)
          : null;
    db.prepare(
      `UPDATE messages
          SET role = ?, content = ?, agent_id = ?, agent_name = ?,
              run_id = ?, run_status = ?, result_delivery_state = ?, last_run_event_id = ?,
              events_json = ?, attachments_json = ?,
              produced_files_json = ?, trace_object_files_json = ?, feedback_json = ?,
              pre_turn_file_names_json = ?,
              session_mode = ?, run_context_json = ?, task_analytics_json = ?,
              applied_plugin_snapshot_json = ?, forked_into_json = ?,
              cancel_origin = ?,
              telemetry_finalized_at = CASE
                WHEN ? THEN COALESCE(telemetry_finalized_at, ?)
                ELSE telemetry_finalized_at
              END,
              started_at = ?, ended_at = ?
        WHERE id = ?`,
    ).run(
      m.role,
      nextContent,
      m.agentId ?? null,
      m.agentName ?? null,
      m.runId ?? null,
      m.runStatus ?? null,
      normalizeResultDeliveryStateForStorage(m.resultDeliveryState),
      m.lastRunEventId ?? null,
      nextEventsJson,
      m.attachments ? JSON.stringify(m.attachments) : null,
      m.producedFiles ? JSON.stringify(m.producedFiles) : null,
      m.traceObjectFiles ? JSON.stringify(m.traceObjectFiles) : null,
      m.feedback ? JSON.stringify(m.feedback) : null,
      m.preTurnFileNames ? JSON.stringify(m.preTurnFileNames) : null,
      normalizeMessageSessionModeForStorage(m.sessionMode),
      m.runContext ? JSON.stringify(m.runContext) : null,
      nextTaskAnalyticsJson,
      m.appliedPluginSnapshot ? JSON.stringify(m.appliedPluginSnapshot) : null,
      normalizeForkedIntoForStorage(m.forkedInto),
      normalizeCancelOriginForStorage(m.cancelOrigin),
      m.telemetryFinalized === true ? 1 : 0,
      now,
      m.startedAt ?? null,
      m.endedAt ?? null,
      m.id,
    );
  } else {
    const max = db
      .prepare(
        `SELECT COALESCE(MAX(position), -1) AS m FROM messages WHERE conversation_id = ?`,
      )
      .get(conversationId) as DbRow | undefined;
    const position = (max?.m ?? -1) + 1;
    const createdAt = typeof m.createdAt === 'number' && Number.isFinite(m.createdAt)
      ? m.createdAt
      : now;
    // 27 values: id, conversation_id, role, content, agent_id, agent_name,
    // run_id, run_status, result_delivery_state, last_run_event_id, events_json, attachments_json,
    // produced_files_json, trace_object_files_json,
    // feedback_json, pre_turn_file_names_json, session_mode, run_context_json,
    // task_analytics_json, applied_plugin_snapshot_json, forked_into_json,
    // cancel_origin, telemetry_finalized_at, started_at, ended_at, position,
    // created_at.
    db.prepare(
      `INSERT INTO messages
         (id, conversation_id, role, content, agent_id, agent_name,
          run_id, run_status, result_delivery_state, last_run_event_id, events_json,
          attachments_json, produced_files_json,
          trace_object_files_json, feedback_json, pre_turn_file_names_json,
          session_mode, run_context_json, task_analytics_json,
          applied_plugin_snapshot_json, forked_into_json, cancel_origin,
          telemetry_finalized_at, started_at, ended_at, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      m.id,
      conversationId,
      m.role,
      m.content,
      m.agentId ?? null,
      m.agentName ?? null,
      m.runId ?? null,
      m.runStatus ?? null,
      normalizeResultDeliveryStateForStorage(m.resultDeliveryState),
      m.lastRunEventId ?? null,
      persistedEvents ? serializeRunEventsForStorage(persistedEvents) : null,
      m.attachments ? JSON.stringify(m.attachments) : null,
      m.producedFiles ? JSON.stringify(m.producedFiles) : null,
      m.traceObjectFiles ? JSON.stringify(m.traceObjectFiles) : null,
      m.feedback ? JSON.stringify(m.feedback) : null,
      m.preTurnFileNames ? JSON.stringify(m.preTurnFileNames) : null,
      normalizeMessageSessionModeForStorage(m.sessionMode),
      m.runContext ? JSON.stringify(m.runContext) : null,
      m.taskAnalytics ? JSON.stringify(m.taskAnalytics) : null,
      m.appliedPluginSnapshot ? JSON.stringify(m.appliedPluginSnapshot) : null,
      normalizeForkedIntoForStorage(m.forkedInto),
      normalizeCancelOriginForStorage(m.cancelOrigin),
      m.telemetryFinalized === true ? now : null,
      m.startedAt ?? null,
      m.endedAt ?? null,
      position,
      createdAt,
    );
  }
  seedMessageArtifactRefsIfAbsent(db, String(m.id), m.artifactRefs);
  // Bump conversation activity so the sidebar's recency sort works.
  db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
    now,
    conversationId,
  );
  const row = db
    .prepare(
      `SELECT id, role, content, agent_id AS agentId, agent_name AS agentName,
              run_id AS runId, run_status AS runStatus,
              result_delivery_state AS resultDeliveryState,
              last_run_event_id AS lastRunEventId,
              events_json AS eventsJson,
              attachments_json AS attachmentsJson,
              produced_files_json AS producedFilesJson,
              trace_object_files_json AS traceObjectFilesJson,
              feedback_json AS feedbackJson,
              pre_turn_file_names_json AS preTurnFileNamesJson,
              session_mode AS sessionMode,
              run_context_json AS runContextJson,
              task_analytics_json AS taskAnalyticsJson,
              applied_plugin_snapshot_json AS appliedPluginSnapshotJson,
              forked_into_json AS forkedIntoJson,
              cancel_origin AS cancelOrigin,
              created_at AS createdAt, started_at AS startedAt, ended_at AS endedAt,
              position
         FROM messages WHERE id = ?`,
    )
    .get(m.id) as DbRow | undefined;
  return row ? normalizeMessage(db, row) : null;
}

export function getMessageTelemetryFinalizationState(db: SqliteDb, messageId: string) {
  const row = db
    .prepare(
      `SELECT telemetry_finalized_at AS telemetryFinalizedAt
         FROM messages
        WHERE id = ?`,
    )
    .get(messageId) as DbRow | undefined;
  if (!row) {
    return {
      exists: false,
      finalizedAt: null,
    };
  }
  return {
    exists: true,
    finalizedAt:
      typeof row.telemetryFinalizedAt === 'number' ? row.telemetryFinalizedAt : null,
  };
}

export function appendMessageStatusEvent(db: SqliteDb, messageId: string, event: DbRow) {
  const label = typeof event?.label === 'string' ? event.label.trim() : '';
  const detail = typeof event?.detail === 'string' ? event.detail.trim() : '';
  if (!label) return null;
  // Status events are written outside the high-volume run stream (for
  // example, routine completion). Fold any crash-left batches first so this
  // update cannot strand or overwrite them.
  finalizeMessageAgentEvents(db, messageId);
  const row = db
    .prepare(`SELECT events_json AS eventsJson FROM messages WHERE id = ?`)
    .get(messageId) as DbRow | undefined;
  if (!row) return null;
  const parsed = parseJsonOrUndef(row.eventsJson);
  const events = Array.isArray(parsed) ? parsed : [];
  const last = events[events.length - 1];
  if (last?.kind === 'status' && last.label === label && (last.detail ?? '') === detail) {
    return events;
  }
  const nextEvent = detail
    ? { kind: 'status', label, detail }
    : { kind: 'status', label };
  const next = [...events, nextEvent];
  db.prepare(`UPDATE messages SET events_json = ? WHERE id = ?`)
    .run(serializeRunEventsForStorage(next), messageId);
  return next;
}

export function compactAdjacentMessageAgentEvents(
  incomingEvents: readonly DbRow[],
): DbRow[] {
  const events: DbRow[] = [];
  let lastNonDeltaJson: string | undefined;
  for (const event of incomingEvents) {
    const kind = typeof event?.kind === 'string' ? event.kind : '';
    const last = events[events.length - 1];
    const isMergeableDelta =
      (kind === 'text' || kind === 'thinking') && typeof event?.text === 'string';
    if (isMergeableDelta && last?.kind === kind && typeof last.text === 'string') {
      events[events.length - 1] = { ...last, text: last.text + event.text };
      lastNonDeltaJson = undefined;
      continue;
    }

    if (isMergeableDelta) {
      events.push(event);
      lastNonDeltaJson = undefined;
      continue;
    }

    // TodoWrite is a state-replacement snapshot, not an activity log. Stream
    // reconnects and whole-message browser snapshots can replay the exact same
    // state thousands of times; those byte-equal adjacent copies carry no UI
    // meaning. Ordinary tool/status/result events remain untouched even when
    // equal, and changed Todo snapshots still survive.
    const comparableSnapshots =
      last?.kind === 'tool_use'
      && kind === 'tool_use'
      && isTodoWriteToolName(last.name)
      && isTodoWriteToolName(event.name)
      && last.id === event.id
      && last.name === event.name;
    if (comparableSnapshots) {
      if (last === event) continue;
      const eventJson = JSON.stringify(event);
      const previousJson = lastNonDeltaJson ?? JSON.stringify(last);
      if (eventJson === previousJson) {
        lastNonDeltaJson = previousJson;
        continue;
      }
      events.push(event);
      lastNonDeltaJson = eventJson;
      continue;
    }
    events.push(event);
    lastNonDeltaJson = undefined;
  }
  return events;
}

function mergeMessageAgentEvents(
  existingEvents: readonly DbRow[],
  incomingEvents: readonly DbRow[],
): DbRow[] {
  const events = compactAdjacentMessageAgentEvents(existingEvents);
  for (const event of incomingEvents) {
    if (!event || typeof event !== 'object') continue;
    const kind = typeof event.kind === 'string' ? event.kind : '';
    if (!kind) continue;
    const last = events[events.length - 1];
    const isMergeableDelta =
      (kind === 'text' || kind === 'thinking') && typeof event.text === 'string';
    if (isMergeableDelta && last?.kind === kind && typeof last.text === 'string') {
      last.text += event.text;
      continue;
    }
    if (!isMergeableDelta && last && JSON.stringify(last) === JSON.stringify(event)) {
      continue;
    }
    events.push(event);
  }
  return events;
}

const messageEventBatchStorageByDb = new WeakMap<SqliteDb, boolean>();

function hasMessageEventBatchStorage(db: SqliteDb): boolean {
  const cached = messageEventBatchStorageByDb.get(db);
  if (cached !== undefined) return cached;
  let exists = false;
  try {
    exists = Boolean(
      db.prepare(
        `SELECT 1
           FROM sqlite_master
          WHERE type = 'table' AND name = 'message_event_batches'`,
      ).get(),
    );
  } catch {
    // A few integration boundaries deliberately expose only the prepared
    // statements they consume. Treat those lightweight DB adapters like a
    // pre-batch schema and preserve the legacy snapshot behavior.
  }
  messageEventBatchStorageByDb.set(db, exists);
  return exists;
}

export function clearMessageAgentEventBatches(db: SqliteDb, messageId: string): void {
  if (!hasMessageEventBatchStorage(db)) return;
  db.prepare(`DELETE FROM message_event_batches WHERE message_id = ?`).run(messageId);
}

function readMessageEventBatches(db: SqliteDb, messageId: string): DbRow[][] {
  if (!hasMessageEventBatchStorage(db)) return [];
  const rows = db.prepare(
    `SELECT events_json AS eventsJson
       FROM message_event_batches
      WHERE message_id = ?
      ORDER BY id ASC`,
  ).all(messageId) as DbRow[];
  return rows.flatMap((batch) => {
    const parsed = parseJsonOrUndef(batch.eventsJson);
    return Array.isArray(parsed) ? [parsed] : [];
  });
}

function readConversationMessageEventBatches(
  db: SqliteDb,
  conversationId: string,
): Map<string, DbRow[][]> {
  if (!hasMessageEventBatchStorage(db)) return new Map();
  const rows = db.prepare(
    `SELECT batch.message_id AS messageId, batch.events_json AS eventsJson
       FROM message_event_batches AS batch
       JOIN messages AS message ON message.id = batch.message_id
      WHERE message.conversation_id = ?
      ORDER BY batch.id ASC`,
  ).all(conversationId) as DbRow[];
  const batches = new Map<string, DbRow[][]>();
  for (const row of rows) {
    const parsed = parseJsonOrUndef(row.eventsJson);
    if (!Array.isArray(parsed)) continue;
    const messageId = String(row.messageId);
    const messageBatches = batches.get(messageId) ?? [];
    messageBatches.push(parsed);
    batches.set(messageId, messageBatches);
  }
  return batches;
}

function materializeMessageAgentEvents(
  db: SqliteDb,
  messageId: string,
  eventsJson: unknown,
  eventBatches?: DbRow[][],
): { events: DbRow[]; batchCount: number; baseEventCount: number; textDelta: string } {
  const parsed = parseJsonOrUndef(eventsJson);
  const baseEvents = Array.isArray(parsed) ? parsed : [];
  let events = compactAdjacentMessageAgentEvents(baseEvents);
  const batches = eventBatches ?? readMessageEventBatches(db, messageId);
  let textDelta = '';
  for (const batch of batches) {
    for (const event of batch) {
      /*
       * The turn-completion marker rides the text stream (that is how the chat
       * client finds the process/conclusion boundary) but must not survive into
       * the message body. `content` is what copy-to-clipboard, exports, title
       * fallbacks and the legacy events-less render path read, and a raw
       * `<pixo-done key="…"/>` in any of those is a protocol tag on screen — the
       * exact failure `<pixo-title>` already shipped once.
       */
      /*
       * `<pixo-next key="…" .../>` (or the legacy paired form) and `<pixo-focus key="…"/>` are stripped from the live stream before
       * anything is persisted, so this is belt-and-braces: the body is the one
       * surface a future path could reach without passing the stream stripper,
       * and the cost of being wrong there is a protocol tag in an export.
       */
      if (event?.kind === 'text' && typeof event.text === 'string') {
        textDelta += stripArtifactFocusMarkers(stripNextStepMarkers(stripDoneMarkers(event.text)));
      }
    }
    events = mergeMessageAgentEvents(events, batch);
  }
  return {
    events,
    batchCount: batches.length,
    baseEventCount: baseEvents.length,
    textDelta,
  };
}

export function appendMessageAgentEvents(
  db: SqliteDb,
  messageId: string,
  incomingEvents: readonly DbRow[],
): DbRow[] | null {
  if (incomingEvents.length === 0) return null;
  const events = mergeMessageAgentEvents([], incomingEvents);
  if (events.length === 0) return null;
  if (!hasMessageEventBatchStorage(db)) {
    const row = db
      .prepare(`SELECT events_json AS eventsJson FROM messages WHERE id = ?`)
      .get(messageId) as DbRow | undefined;
    if (!row) return null;
    const parsed = parseJsonOrUndef(row.eventsJson);
    const existingEvents = Array.isArray(parsed) ? parsed : [];
    const materializedEvents = mergeMessageAgentEvents(existingEvents, events);
    const textDelta = events
      .filter((event) => event?.kind === 'text' && typeof event.text === 'string')
      .map((event) => event.text)
      .join('');
    db.prepare(
      `UPDATE messages
          SET content = COALESCE(content, '') || ?, events_json = ?
        WHERE id = ?`,
    ).run(textDelta, serializeRunEventsForStorage(materializedEvents), messageId);
    return materializedEvents;
  }
  const inserted = db.prepare(
    `INSERT INTO message_event_batches (message_id, events_json, created_at)
     SELECT ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM messages WHERE id = ?)`,
  ).run(messageId, serializeRunEventsForStorage(events), Date.now(), messageId);
  return inserted.changes > 0 ? events : null;
}

export function finalizeMessageAgentEvents(
  db: SqliteDb,
  messageId: string,
): DbRow[] | null {
  return db.transaction(() => {
    const row = db.prepare(
      `SELECT events_json AS eventsJson FROM messages WHERE id = ?`,
    ).get(messageId) as DbRow | undefined;
    if (!row) return null;
    const materialized = materializeMessageAgentEvents(db, messageId, row.eventsJson);
    if (materialized.batchCount === 0 || !hasMessageEventBatchStorage(db)) {
      return materialized.events;
    }
    db.prepare(
      `UPDATE messages
          SET content = COALESCE(content, '') || ?, events_json = ?
        WHERE id = ?`,
    ).run(materialized.textDelta, serializeRunEventsForStorage(materialized.events), messageId);
    clearMessageAgentEventBatches(db, messageId);
    return materialized.events;
  })();
}

/**
 * Retire the unfinished prose an interrupted attempt left on this message.
 *
 * A turn only gets another attempt because the previous one never terminated,
 * so whatever text the superseded attempt streamed after its last committed
 * boundary was never closed upstream either — and the next attempt writes that
 * passage again. Appending it a second time is how one conclusion ends up in
 * the transcript twice (OPEND-2566): the event stream is append-only and
 * adjacent text is concatenated, so nothing downstream can tell a re-written
 * answer from a longer one.
 *
 * Only the trailing delta run goes. Prose that a tool row already closed is
 * committed in the agent's own session — a resumed attempt continues past it
 * instead of repeating it — so it has to survive, and the last tool row is the
 * boundary the resume itself is anchored on.
 *
 * `content` is corrected by removing exactly the suffix those deltas
 * contributed, and only when it really is that suffix; a row whose body came
 * from somewhere else is left alone rather than rewritten on a guess.
 *
 * Returns how many events were dropped.
 */
export function dropTrailingMessageAgentDeltas(
  db: SqliteDb,
  messageId: string,
): number {
  const events = finalizeMessageAgentEvents(db, messageId);
  if (!events || events.length === 0) return 0;
  // How the attempt ended is bookkeeping, not body: an interrupted attempt
  // signs off with its own `status` rows (the terminal error above all), and
  // they sit AFTER the passage that was cut off. Step over them to reach the
  // prose, then leave them where they are — they are what makes the seam
  // legible once the duplicate is gone.
  let end = events.length;
  while (end > 0 && events[end - 1]?.kind === 'status') end -= 1;
  let cut = end;
  while (cut > 0) {
    const event = events[cut - 1];
    const kind = typeof event?.kind === 'string' ? event.kind : '';
    if ((kind === 'text' || kind === 'thinking') && typeof event?.text === 'string') {
      cut -= 1;
      continue;
    }
    break;
  }
  if (cut === end) return 0;
  const dropped = events.slice(cut, end);
  const kept = [...events.slice(0, cut), ...events.slice(end)];
  const droppedText = dropped
    .filter((event) => event?.kind === 'text' && typeof event.text === 'string')
    .map((event) =>
      stripArtifactFocusMarkers(stripNextStepMarkers(stripDoneMarkers(String(event.text)))),
    )
    .join('');
  const row = db
    .prepare(`SELECT content FROM messages WHERE id = ?`)
    .get(messageId) as DbRow | undefined;
  if (!row) return 0;
  const content = typeof row.content === 'string' ? row.content : '';
  const nextContent =
    droppedText && content.endsWith(droppedText)
      ? content.slice(0, content.length - droppedText.length)
      : content;
  db.prepare(`UPDATE messages SET content = ?, events_json = ? WHERE id = ?`)
    .run(nextContent, serializeRunEventsForStorage(kept), messageId);
  return dropped.length;
}

export function appendMessageAgentEvent(
  db: SqliteDb,
  messageId: string,
  event: DbRow,
): DbRow[] | null {
  return appendMessageAgentEvents(db, messageId, [event]);
}

export function deleteMessage(db: SqliteDb, id: string) {
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
}

/** Return the most-recently updated local conversation for a project. */
export function getLatestConversationIdForProject(
  db: SqliteDb,
  projectId: string,
  excludeConversationId: string | null = null,
): string | null {
  const row = db
    .prepare(
      `SELECT id FROM conversations
        WHERE project_id = ?
          AND (? IS NULL OR id != ?)
        ORDER BY updated_at DESC, rowid DESC
        LIMIT 1`,
    )
    .get(
      projectId,
      excludeConversationId,
      excludeConversationId,
    ) as DbRow | undefined;
  return row && typeof row.id === 'string' ? row.id : null;
}

const LEGACY_MESSAGE_EVENT_COMPACTION_MIN_CHARS = 256 * 1024;
const MESSAGE_EVENT_MAINTENANCE_QUEUE_LIMIT = 1;

type MessageEventMaintenanceJob =
  | {
      kind: 'compact_legacy';
      messageId: string;
      expectedEventsJson: string;
      events: DbRow[];
    }
  | {
      kind: 'finalize_batches';
      messageId: string;
    }
  | {
      kind: 'heal_oversized_payloads';
      messageId: string;
    };

type MessageEventMaintenanceState = {
  queue: MessageEventMaintenanceJob[];
  queuedMessageIds: Set<string>;
  scheduled: boolean;
  running: boolean;
};

const messageEventMaintenanceStates = new WeakMap<SqliteDb, MessageEventMaintenanceState>();

function isTerminalMessageRunStatus(value: unknown): boolean {
  return value === 'succeeded' || value === 'failed' || value === 'canceled';
}

function scheduleMessageEventMaintenance(
  db: SqliteDb,
  job: MessageEventMaintenanceJob,
): void {
  let state = messageEventMaintenanceStates.get(db);
  if (!state) {
    state = {
      queue: [],
      queuedMessageIds: new Set(),
      scheduled: false,
      running: false,
    };
    messageEventMaintenanceStates.set(db, state);
  }
  if (
    state.queuedMessageIds.has(job.messageId) ||
    state.queuedMessageIds.size >= MESSAGE_EVENT_MAINTENANCE_QUEUE_LIMIT
  ) return;
  state.queue.push(job);
  state.queuedMessageIds.add(job.messageId);
  scheduleNextMessageEventMaintenance(db, state);
}

function scheduleNextMessageEventMaintenance(
  db: SqliteDb,
  state: MessageEventMaintenanceState,
): void {
  if (state.scheduled || state.running || state.queue.length === 0) return;
  state.scheduled = true;
  const immediate = setImmediate(() => {
    state.scheduled = false;
    const job = state.queue.shift();
    if (!job) return;
    state.running = true;
    try {
      if (!db.open) return;
      if (job.kind === 'finalize_batches') {
        finalizeMessageAgentEvents(db, job.messageId);
      } else if (job.kind === 'heal_oversized_payloads') {
        healOversizedMessageEvents(db, job.messageId);
      } else {
        const compactedJson = serializeRunEventsForStorage(job.events);
        if (compactedJson.length < job.expectedEventsJson.length) {
          const noPendingBatches = hasMessageEventBatchStorage(db)
            ? `AND NOT EXISTS (
                  SELECT 1 FROM message_event_batches AS batch
                   WHERE batch.message_id = messages.id
                )`
            : '';
          db.prepare(
            `UPDATE messages
                SET events_json = ?
              WHERE id = ?
                AND events_json = ?
                AND run_status IN ('succeeded', 'failed', 'canceled')
                ${noPendingBatches}`,
          ).run(compactedJson, job.messageId, job.expectedEventsJson);
        }
      }
    } catch (error) {
      console.warn('[db] message event maintenance failed', error);
    } finally {
      state.running = false;
      state.queuedMessageIds.delete(job.messageId);
      scheduleNextMessageEventMaintenance(db, state);
    }
  });
  immediate.unref?.();
}

// ---------- run event payload heal ----------
//
// I3 — rows written before the run-event payload budget existed are healed
// once. The pass itself (scheduling, yielding, reporting) lives in
// `storage/message-event-payload-heal.ts`; these are its row-level primitives.
// Each call rewrites at most ONE row, inside its own transaction, streaming the
// row's events out of SQLite one element at a time — a stored event log is
// never materialized whole in JS, and a crash leaves every row either as it was
// or fully healed.

export type RunEventPayloadHealOutcome =
  | { status: 'rewritten'; bytesBefore: number; bytesAfter: number }
  | { status: 'unchanged' | 'missing' | 'active' | 'malformed' };

function isActiveMessageRunStatus(value: unknown): boolean {
  return value === 'queued' || value === 'running';
}

/**
 * True when some stored event in `column` (a JSON array) is a record, is not
 * `text`/`thinking`, and exceeds the per-event budget — the exact shape
 * `boundPersistedAgentEvent` rewrites. Evaluated inside SQLite.
 */
function oversizedEventExistsSql(column: string): string {
  return `EXISTS (
            SELECT 1
              FROM json_each(${column}) AS event
             WHERE event.type = 'object'
               AND octet_length(event.value) > ${RUN_EVENT_JSON_BUDGET_BYTES}
               AND COALESCE(json_extract(event.value, '$.kind'), '') NOT IN ('text', 'thinking')
          )`;
}

function healedEventsJson(
  elements: Iterable<{ type: string; value: unknown }>,
): { json: string; changed: boolean } {
  const parts: string[] = [];
  let changed = false;
  for (const element of elements) {
    let value: unknown;
    switch (element.type) {
      case 'object':
      case 'array':
        value = JSON.parse(String(element.value));
        break;
      case 'true':
        value = true;
        break;
      case 'false':
        value = false;
        break;
      case 'null':
        value = null;
        break;
      default:
        value = element.value;
    }
    const bounded = boundPersistedAgentEvent(value);
    if (bounded !== value) changed = true;
    parts.push(JSON.stringify(bounded) ?? 'null');
  }
  return { json: `[${parts.join(',')}]`, changed };
}

/** Messages whose stored event log is larger than one event's budget, by rowid. */
export function listRunEventHealMessageCandidates(
  db: SqliteDb,
  afterRowid: number,
  limit: number,
): Array<{ rowid: number; id: string }> {
  return db
    .prepare(
      `SELECT rowid AS rowid, id
         FROM messages
        WHERE rowid > ?
          AND octet_length(events_json) > ?
        ORDER BY rowid
        LIMIT ?`,
    )
    .all(afterRowid, RUN_EVENT_JSON_BUDGET_BYTES, limit) as Array<{ rowid: number; id: string }>;
}

/** Event batches larger than one event's budget, by id. */
export function listRunEventHealBatchCandidates(
  db: SqliteDb,
  afterId: number,
  limit: number,
): Array<{ id: number }> {
  if (!hasMessageEventBatchStorage(db)) return [];
  return db
    .prepare(
      `SELECT id
         FROM message_event_batches
        WHERE id > ?
          AND octet_length(events_json) > ?
        ORDER BY id
        LIMIT ?`,
    )
    .all(afterId, RUN_EVENT_JSON_BUDGET_BYTES, limit) as Array<{ id: number }>;
}

/**
 * Rewrite one message's stored events so every event fits the payload budget.
 * Skips (`active`) a row whose run is still queued or running: its writer owns
 * it. A row that is already bounded is left untouched (`unchanged`), so
 * healing is idempotent.
 */
export function healOversizedMessageEvents(
  db: SqliteDb,
  messageId: string,
): RunEventPayloadHealOutcome {
  return db.transaction((): RunEventPayloadHealOutcome => {
    const row = db
      .prepare(
        `SELECT run_status AS runStatus,
                octet_length(events_json) AS bytes,
                (json_valid(events_json) AND json_type(events_json) = 'array') AS isArray
           FROM messages
          WHERE id = ?`,
      )
      .get(messageId) as DbRow | undefined;
    if (!row || row.bytes == null) return { status: 'missing' };
    if (isActiveMessageRunStatus(row.runStatus)) return { status: 'active' };
    if (Number(row.bytes) <= RUN_EVENT_JSON_BUDGET_BYTES) return { status: 'unchanged' };
    if (row.isArray !== 1) return { status: 'malformed' };
    const needsHeal = db
      .prepare(`SELECT ${oversizedEventExistsSql('m.events_json')} AS needed FROM messages AS m WHERE m.id = ?`)
      .get(messageId) as { needed: number } | undefined;
    if (needsHeal?.needed !== 1) return { status: 'unchanged' };
    const healed = healedEventsJson(
      db
        .prepare(
          `SELECT event.type AS type, event.value AS value
             FROM messages AS m, json_each(m.events_json) AS event
            WHERE m.id = ?
            ORDER BY CAST(event.key AS INTEGER)`,
        )
        .iterate(messageId) as Iterable<{ type: string; value: unknown }>,
    );
    if (!healed.changed) return { status: 'unchanged' };
    db.prepare(`UPDATE messages SET events_json = ? WHERE id = ?`).run(healed.json, messageId);
    return {
      status: 'rewritten',
      bytesBefore: Number(row.bytes),
      bytesAfter: Buffer.byteLength(healed.json, 'utf8'),
    };
  }).immediate();
}

/** {@link healOversizedMessageEvents} for one `message_event_batches` row. */
export function healOversizedMessageEventBatch(
  db: SqliteDb,
  batchId: number,
): RunEventPayloadHealOutcome {
  if (!hasMessageEventBatchStorage(db)) return { status: 'missing' };
  return db.transaction((): RunEventPayloadHealOutcome => {
    const row = db
      .prepare(
        `SELECT message.run_status AS runStatus,
                octet_length(batch.events_json) AS bytes,
                (json_valid(batch.events_json) AND json_type(batch.events_json) = 'array') AS isArray
           FROM message_event_batches AS batch
           LEFT JOIN messages AS message ON message.id = batch.message_id
          WHERE batch.id = ?`,
      )
      .get(batchId) as DbRow | undefined;
    if (!row || row.bytes == null) return { status: 'missing' };
    if (isActiveMessageRunStatus(row.runStatus)) return { status: 'active' };
    if (Number(row.bytes) <= RUN_EVENT_JSON_BUDGET_BYTES) return { status: 'unchanged' };
    if (row.isArray !== 1) return { status: 'malformed' };
    const needsHeal = db
      .prepare(
        `SELECT ${oversizedEventExistsSql('batch.events_json')} AS needed
           FROM message_event_batches AS batch WHERE batch.id = ?`,
      )
      .get(batchId) as { needed: number } | undefined;
    if (needsHeal?.needed !== 1) return { status: 'unchanged' };
    const healed = healedEventsJson(
      db
        .prepare(
          `SELECT event.type AS type, event.value AS value
             FROM message_event_batches AS batch, json_each(batch.events_json) AS event
            WHERE batch.id = ?
            ORDER BY CAST(event.key AS INTEGER)`,
        )
        .iterate(batchId) as Iterable<{ type: string; value: unknown }>,
    );
    if (!healed.changed) return { status: 'unchanged' };
    db.prepare(`UPDATE message_event_batches SET events_json = ? WHERE id = ?`).run(healed.json, batchId);
    return {
      status: 'rewritten',
      bytesBefore: Number(row.bytes),
      bytesAfter: Buffer.byteLength(healed.json, 'utf8'),
    };
  }).immediate();
}

export function hasCompletedDaemonMaintenancePass(db: SqliteDb, name: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM daemon_maintenance_passes WHERE name = ?`).get(name),
  );
}

export function recordCompletedDaemonMaintenancePass(
  db: SqliteDb,
  name: string,
  completedAt = Date.now(),
): void {
  db.prepare(
    `INSERT INTO daemon_maintenance_passes (name, completed_at) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET completed_at = excluded.completed_at`,
  ).run(name, completedAt);
}

function normalizeMessage(
  db: SqliteDb,
  row: DbRow,
  eventBatches?: DbRow[][],
  artifactRefs?: ChatArtifactRef[],
) {
  const eventsJson = typeof row.eventsJson === 'string' ? row.eventsJson : null;
  const materializedEvents = materializeMessageAgentEvents(
    db,
    String(row.id),
    eventsJson,
    eventBatches,
  );
  // I2: a loaded conversation never carries unbounded run-event payloads, even
  // for rows written before the payload budget existed and not yet healed by
  // the background pass. A row this small cannot hold an oversized event
  // (each UTF-16 unit is at most 3 UTF-8 bytes), so only larger rows pay for
  // the per-event check.
  const mayHoldOversizedEvents =
    materializedEvents.batchCount > 0
    || (eventsJson !== null && eventsJson.length * 3 > RUN_EVENT_JSON_BUDGET_BYTES);
  const boundedEvents = mayHoldOversizedEvents
    ? (boundPersistedAgentEvents(materializedEvents.events) as DbRow[])
    : materializedEvents.events;
  if (isTerminalMessageRunStatus(row.runStatus)) {
    if (materializedEvents.batchCount > 0) {
      // A terminal row with batches means the daemon stopped between its last
      // append and terminal folding. Recover only when that conversation is
      // actually read; startup never scans or parses every historical row.
      scheduleMessageEventMaintenance(db, {
        kind: 'finalize_batches',
        messageId: String(row.id),
      });
    } else if (
      eventsJson &&
      eventsJson.length >= LEGACY_MESSAGE_EVENT_COMPACTION_MIN_CHARS &&
      materializedEvents.events.length < materializedEvents.baseEventCount
    ) {
      scheduleMessageEventMaintenance(db, {
        kind: 'compact_legacy',
        messageId: String(row.id),
        expectedEventsJson: eventsJson,
        events: materializedEvents.events,
      });
    } else if (boundedEvents !== materializedEvents.events) {
      // The stored row predates the budget: rewrite it once, off the request
      // path, so the next read does not pay for bounding it again.
      scheduleMessageEventMaintenance(db, {
        kind: 'heal_oversized_payloads',
        messageId: String(row.id),
      });
    }
  }
  const scrubProtocolTail = row.role === 'assistant'
    ? scrubDsmlToolProtocolTail
    : (text: string) => text;
  const visibleEvents = row.role === 'assistant'
    ? scrubDsmlToolProtocolTailFromEvents(boundedEvents)
    : boundedEvents;
  return {
    id: row.id,
    role: row.role,
    content: scrubProtocolTail(
      `${typeof row.content === 'string' ? row.content : ''}${materializedEvents.textDelta}`,
    ),
    agentId: row.agentId ?? undefined,
    agentName: row.agentName ?? undefined,
    runId: row.runId ?? undefined,
    runStatus: row.runStatus ?? undefined,
    resultDeliveryState: normalizeResultDeliveryState(row.resultDeliveryState),
    lastRunEventId: row.lastRunEventId ?? undefined,
    events:
      eventsJson !== null || materializedEvents.batchCount > 0
        ? visibleEvents
        : undefined,
    attachments: parseJsonOrUndef(row.attachmentsJson),
    producedFiles: parseJsonOrUndef(row.producedFilesJson),
    // Normalized artifact refs. `producedFiles` stays exactly as it was for
    // transcripts and older clients; new cards read this instead.
    artifactRefs: artifactRefs && artifactRefs.length > 0 ? artifactRefs : undefined,
    traceObjectFiles: parseJsonOrUndef(row.traceObjectFilesJson),
    feedback: parseJsonOrUndef(row.feedbackJson),
    preTurnFileNames: parseJsonOrUndef(row.preTurnFileNamesJson),
    sessionMode: normalizeMessageSessionMode(row.sessionMode),
    runContext: parseJsonOrUndef(row.runContextJson),
    taskAnalytics: parseJsonOrUndef(row.taskAnalyticsJson),
    appliedPluginSnapshot: parseJsonOrUndef(row.appliedPluginSnapshotJson),
    forkedInto: normalizeForkedInto(parseJsonOrUndef(row.forkedIntoJson)),
    cancelOrigin: normalizeCancelOrigin(row.cancelOrigin),
    createdAt: row.createdAt ?? undefined,
    startedAt: row.startedAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
  };
}

const DSML_PROTOCOL_TAIL_EVENT_LOOKBACK = 512;

/**
 * Historical agent_message_chunk deltas can be separated by diagnostic or
 * tool events, so adjacent-text compaction is not sufficient. Treat only the
 * concatenated visible text suffix as a stream, then remove the matched tail
 * backwards from its source events while leaving non-text events untouched.
 */
function scrubDsmlToolProtocolTailFromEvents(events: readonly DbRow[]): DbRow[] {
  let suffix = '';
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind !== 'text' || typeof event.text !== 'string') continue;
    const remaining = DSML_PROTOCOL_TAIL_EVENT_LOOKBACK - suffix.length;
    if (remaining <= 0) break;
    suffix = `${event.text.slice(-remaining)}${suffix}`;
  }

  const visibleSuffix = scrubDsmlToolProtocolTail(suffix);
  let charsToRemove = suffix.length - visibleSuffix.length;
  if (charsToRemove <= 0) return [...events];

  const visibleEvents = [...events];
  const emptiedTextEventIndexes = new Set<number>();
  for (let index = visibleEvents.length - 1; index >= 0 && charsToRemove > 0; index -= 1) {
    const event = visibleEvents[index];
    if (event?.kind !== 'text' || typeof event.text !== 'string') continue;
    if (charsToRemove >= event.text.length) {
      charsToRemove -= event.text.length;
      emptiedTextEventIndexes.add(index);
      continue;
    }
    visibleEvents[index] = {
      ...event,
      text: event.text.slice(0, event.text.length - charsToRemove),
    };
    charsToRemove = 0;
  }
  return visibleEvents.filter((_, index) => !emptiedTextEventIndexes.has(index));
}

function normalizeMessageSessionMode(value: unknown): ChatSessionMode | undefined {
  return value === 'chat' || value === 'design' || value === 'plan' ? value : undefined;
}

function normalizeResultDeliveryState(
  value: unknown,
): 'delivered' | 'no_result' | 'delivery_failed' | undefined {
  return value === 'delivered' || value === 'no_result' || value === 'delivery_failed'
    ? value
    : undefined;
}

function normalizeResultDeliveryStateForStorage(
  value: unknown,
): 'delivered' | 'no_result' | 'delivery_failed' | null {
  return normalizeResultDeliveryState(value) ?? null;
}

function normalizeMessageSessionModeForStorage(value: unknown): ChatSessionMode | null {
  return value === 'chat' || value === 'design' || value === 'plan' ? value : null;
}

/**
 * The fork divider marker is only meaningful when it carries the title the
 * divider prints. A shape without a usable title would render an empty line
 * between two hairlines, so it is stored as "not forked" instead.
 */
function normalizeForkedInto(
  value: unknown,
): { title: string; conversationId?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { title?: unknown; conversationId?: unknown };
  if (typeof candidate.title !== 'string' || !candidate.title) return undefined;
  return {
    title: candidate.title,
    ...(typeof candidate.conversationId === 'string' && candidate.conversationId
      ? { conversationId: candidate.conversationId }
      : {}),
  };
}

function normalizeForkedIntoForStorage(value: unknown): string | null {
  const normalized = normalizeForkedInto(value);
  return normalized ? JSON.stringify(normalized) : null;
}

/**
 * Who cancelled this turn. Enum mirrors `RunCancelOrigin`; anything else is
 * dropped rather than stored verbatim, because the UI reads this field as
 * PROOF ("the user pressed Stop") and an unrecognized value must not be able
 * to masquerade as one of the four known origins.
 */
const CANCEL_ORIGINS = new Set([
  'user_stop',
  'project_cleanup',
  'daemon_shutdown',
  'unknown',
]);

function normalizeCancelOrigin(value: unknown): ChatMessage['cancelOrigin'] {
  return typeof value === 'string' && CANCEL_ORIGINS.has(value)
    ? (value as NonNullable<ChatMessage['cancelOrigin']>)
    : undefined;
}

function normalizeCancelOriginForStorage(value: unknown): string | null {
  return normalizeCancelOrigin(value) ?? null;
}

function parseJsonOrUndef(s: unknown): any {
  if (typeof s !== 'string' || !s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}


// ---------- tabs ----------

function normalizeBrowserWorkspaceTab(value: unknown): ProjectBrowserWorkspaceTab | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  if (typeof record.label !== 'string' || !record.label.trim()) return null;
  const tab: ProjectBrowserWorkspaceTab = {
    id: record.id,
    label: record.label,
  };
  if (record.insertAfter === null) tab.insertAfter = null;
  else if (typeof record.insertAfter === 'string') tab.insertAfter = record.insertAfter;
  if (typeof record.title === 'string' && record.title.trim()) tab.title = record.title;
  if (typeof record.url === 'string' && record.url.trim()) tab.url = record.url;
  if (typeof record.iconUrl === 'string' && record.iconUrl.trim()) tab.iconUrl = record.iconUrl;
  return tab;
}

function normalizeProjectTabsState(value: unknown): ProjectTabsState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tabs) || !record.tabs.every((tab) => typeof tab === 'string')) {
    return null;
  }
  const browserTabs = Array.isArray(record.browserTabs)
    ? record.browserTabs
        .map(normalizeBrowserWorkspaceTab)
        .filter((tab): tab is ProjectBrowserWorkspaceTab => Boolean(tab))
    : [];
  const state: ProjectTabsState = {
    tabs: record.tabs.slice(),
    active: typeof record.active === 'string' ? record.active : null,
  };
  if (browserTabs.length > 0) state.browserTabs = browserTabs;
  return state;
}

function parseProjectTabsStateJson(value: unknown): ProjectTabsState | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return normalizeProjectTabsState(JSON.parse(value));
  } catch {
    return null;
  }
}

export function listTabs(db: SqliteDb, projectId: string) {
  const rows = db
    .prepare(
      `SELECT name, position, is_active AS isActive
         FROM tabs WHERE project_id = ? ORDER BY position ASC`,
    )
    .all(projectId) as DbRow[];
  const state = db
    .prepare(`SELECT project_id, updated_at AS updatedAt, state_json AS stateJson FROM tabs_state WHERE project_id = ? LIMIT 1`)
    .get(projectId) as DbRow | undefined;
  const savedState = parseProjectTabsStateJson(state?.stateJson);
  if (savedState) {
    return {
      ...savedState,
      hasSavedState: true,
      updatedAt: Number(state?.updatedAt ?? Date.now()),
    };
  }
  const active = (rows as DbRow[]).find((r: DbRow) => r.isActive) ?? null;
  return {
    tabs: (rows as DbRow[]).map((r: DbRow) => r.name),
    active: active ? active.name : null,
    hasSavedState: rows.length > 0 || Boolean(state),
    updatedAt: state ? Number(state.updatedAt ?? Date.now()) : undefined,
  };
}

export function setTabs(
  db: SqliteDb,
  projectId: string,
  stateOrNames: ProjectTabsState | string[],
  activeName: string | null = null,
) {
  const state = normalizeProjectTabsState(
    Array.isArray(stateOrNames)
      ? { tabs: stateOrNames, active: activeName }
      : stateOrNames,
  ) ?? { tabs: [], active: null };
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO tabs_state (project_id, updated_at, state_json)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         updated_at = excluded.updated_at,
         state_json = excluded.state_json`,
    ).run(projectId, Date.now(), JSON.stringify(state));
    db.prepare(`DELETE FROM tabs WHERE project_id = ?`).run(projectId);
    const ins = db.prepare(
      `INSERT INTO tabs (project_id, name, position, is_active)
       VALUES (?, ?, ?, ?)`,
    );
    state.tabs.forEach((name: string, i: number) => {
      ins.run(projectId, name, i, name === state.active ? 1 : 0);
    });
  });
  tx();
  return listTabs(db, projectId);
}
