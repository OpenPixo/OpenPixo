import type { Request } from 'express';
import type { GameProjectSetup, GameVerifyResult, RecipeRun } from '@openpixo/contracts';
import { readAnalyticsContext, type AnalyticsContext, type AnalyticsService } from '../analytics.js';
import { readAppConfig } from '../app-config.js';

/**
 * The game funnel: how far a game gets, from creation to an approved plan to a
 * build that verifies, and which generated art is kept. It answers "how many
 * games get made, and where do they stop" without reading what a game is.
 *
 * Invariant: no event carries free text. Prompts, genres, titles, pitches, file
 * paths, messages and logs never leave the machine through this module.
 * `gameFunnelProperties` keeps only booleans, finite numbers and short
 * identifier-shaped strings (and lists of them), and drops everything else, so
 * a caller that passes the wrong field loses it instead of sending it.
 *
 * Consent is decided by `AnalyticsService.capture`, which re-reads the user's
 * `telemetry.metrics` choice on every event. A user who has not said yes sends
 * nothing, and a build without an analytics key sends nothing.
 */
export type GameFunnelEvent =
  | 'game_created'
  | 'game_plan_approved'
  | 'game_verified'
  | 'recipe_run_settled'
  | 'recipe_candidates_adopted';

export type GameFunnelActor = 'user' | 'agent';

export interface GameFunnelRecorder {
  record(req: Request | null, event: GameFunnelEvent, properties: Record<string, unknown>): void;
}

export const NOOP_GAME_FUNNEL: GameFunnelRecorder = { record: () => undefined };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const MAX_LIST = 16;

function identifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

/** Keeps only values that cannot carry user text; see the module invariant. */
export function gameFunnelProperties(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(key)) continue;
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (identifier(value)) out[key] = value;
    else if (Array.isArray(value) && value.length <= MAX_LIST && value.every(identifier)) out[key] = [...value];
  }
  return out;
}

export interface GameFunnelRecorderDeps {
  analytics: Pick<AnalyticsService, 'capture'>;
  dataDir: string;
  appVersion: () => string;
  newInsertId: () => string;
}

/**
 * A request from the app carries the app's analytics identity. One from `pixo`
 * (the user's or an agent's) carries none, so it is counted under the
 * installation id the user's yes created; without that id nothing is sent.
 */
async function contextFor(req: Request | null, dataDir: string): Promise<AnalyticsContext | null> {
  const fromApp = req ? readAnalyticsContext(req) : null;
  if (fromApp) return fromApp;
  const config = await readAppConfig(dataDir);
  const installationId = typeof config.installationId === 'string' && config.installationId ? config.installationId : null;
  if (!installationId) return null;
  return { deviceId: installationId, sessionId: installationId, clientType: 'desktop', locale: 'en', requestId: null, entrySurface: 'pixo_cli' };
}

export function createGameFunnelRecorder(deps: GameFunnelRecorderDeps): GameFunnelRecorder {
  return {
    record(req, event, properties) {
      // Fire and forget: the funnel never delays or fails the request it observes.
      void (async () => {
        try {
          const context = await contextFor(req, deps.dataDir);
          if (!context) return;
          await deps.analytics.capture({
            eventName: event,
            context,
            appVersion: deps.appVersion(),
            properties: gameFunnelProperties(properties),
            insertId: deps.newInsertId(),
          });
        } catch {
          // Analytics is best-effort.
        }
      })();
    },
  };
}

/* ---------- Property builders: the only shapes each event sends. ---------- */

const hoursSince = (from: number | undefined, now: number) =>
  typeof from === 'number' && Number.isFinite(from) ? Math.max(0, Math.round(((now - from) / 3_600_000) * 10) / 10) : undefined;

export function gameCreatedProperties(input: {
  projectKind: unknown;
  setup: GameProjectSetup | undefined;
  experience: unknown;
  fromTemplate: boolean;
  /** The game lives in a folder the user picked rather than one OpenPixo manages. */
  ownFolder: boolean;
}): Record<string, unknown> {
  const setup = input.setup;
  return {
    project_kind: input.projectKind,
    from_template: input.fromTemplate,
    own_folder: input.ownFolder,
    experience: input.experience,
    has_setup: Boolean(setup),
    scope: setup?.scope,
    perspective: setup?.perspective,
    players: setup?.players,
    platform_count: setup?.platforms?.length ?? 0,
    has_genre: Boolean(setup?.genre),
    has_pitch: Boolean(setup?.pitch),
    has_comparables: Boolean(setup?.comparables?.length),
    has_style: Boolean(setup?.art?.styleId),
    has_palette: Boolean(setup?.art?.palette?.length),
    steam_later: setup?.release?.steamLater === true,
    suggested_count: setup?.suggested?.length ?? 0,
  };
}

export function gamePlanApprovedProperties(input: {
  setup: GameProjectSetup | undefined;
  startedAt: number | undefined;
  now: number;
  recordedPlan: boolean;
  artBudgetCredits: number | undefined;
}): Record<string, unknown> {
  return {
    scope: input.setup?.scope,
    hours_planning: hoursSince(input.startedAt, input.now),
    plan_recorded: input.recordedPlan,
    art_budget_set: input.artBudgetCredits !== undefined,
    art_budget_credits: input.artBudgetCredits,
  };
}

export function gameVerifiedProperties(input: {
  result: GameVerifyResult;
  engine: unknown;
  actor: GameFunnelActor;
  mode: 'verify' | 'playtest';
}): Record<string, unknown> {
  const { result } = input;
  const step = (name: string) => {
    const found = result.steps.find(item => item.name === name);
    if (!found) return undefined;
    return found.status ?? (found.timedOut ? 'timed_out' : found.exitCode === 0 ? 'passed' : 'failed');
  };
  return {
    mode: result.playtest ? 'playtest' : input.mode,
    actor: input.actor,
    engine: input.engine,
    status: result.status,
    step_check: step('check'),
    step_build: step('build'),
    step_run: step('run'),
    duration_ms: result.steps.reduce((sum, item) => sum + (Number.isFinite(item.durationMs) ? item.durationMs : 0), 0),
    screenshot_count: result.screenshots.length,
    missing_tool_count: result.missingTools.length,
    ...(result.playtest ? { playtest_completed: result.playtest.completed === true, playtest_frame_count: result.playtest.frames.length } : {}),
  };
}

function recipeBase(run: RecipeRun): Record<string, unknown> {
  return {
    recipe_id: run.recipeId,
    recipe_version: run.recipeVersion,
    surface: run.surface,
    origin: run.origin,
    has_game: run.projectId !== null,
    has_style: Boolean(run.styleId),
    model_provider: run.model.provider,
    paid: Boolean(run.quote),
    candidate_count: run.candidates.length,
  };
}

export function recipeRunSettledProperties(run: RecipeRun, now: number): Record<string, unknown> {
  return {
    ...recipeBase(run),
    status: run.status,
    ready_count: run.candidates.filter(candidate => candidate.stagedFiles.length > 0 && !candidate.error).length,
    failed_count: run.candidates.filter(candidate => Boolean(candidate.error)).length,
    error_code: run.errorCode,
    duration_ms: Math.max(0, now - run.createdAt),
  };
}

export function recipeCandidatesAdoptedProperties(run: RecipeRun, candidateIds: readonly string[], now: number): Record<string, unknown> {
  const chosen = new Set(candidateIds);
  const indexes = run.candidates.filter(candidate => chosen.has(candidate.id)).map(candidate => candidate.index);
  return {
    ...recipeBase(run),
    adopted_count: indexes.length,
    adopted_first_index: indexes.length ? Math.min(...indexes) : undefined,
    adopted_all: indexes.length > 0 && indexes.length === run.candidates.filter(candidate => candidate.stagedFiles.length > 0 && !candidate.error).length,
    minutes_since_run: Math.max(0, Math.round((now - run.createdAt) / 60_000)),
  };
}
