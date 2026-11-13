import type { OpenPixoAgentModel } from './openpixo-agent.js';

/**
 * Which hosted agent models a user can pick, and what each one costs compared with
 * the default. Shared by the daemon (catalogue, runs), the web picker and `pixo credits
 * agent-models`, so every surface agrees.
 */

/**
 * DeepSeek V4.1 Flash: the baseline every hosted model's cost is compared with, and
 * the model {@link OPENPIXO_AGENT_AUTO_MODEL} uses for every turn but the plan.
 */
export const OPENPIXO_AGENT_DEFAULT_MODEL = 'openpixo-agent-flash';

/**
 * Auto: what a user gets when nothing else was chosen. Not a cloud model: the daemon
 * picks a real one for each run (owner decision, 2026-11-13). A new game's plan is
 * written by {@link OPENPIXO_AGENT_AUTO_PLAN_MODEL}; everything else runs on Flash.
 */
export const OPENPIXO_AGENT_AUTO_MODEL = 'openpixo-agent-auto';

/**
 * Writes the plan under Auto. Flash planned weak games and read pictures badly; Sonnet
 * scored 38 of 38 where Flash scored 27 on a blind test of real game images.
 */
export const OPENPIXO_AGENT_AUTO_PLAN_MODEL = 'openpixo-agent-claude-sonnet-5-5';

/** Most plan turns one game gets on the plan model; the rest of the game stays on Flash. */
export const OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME = 3;

/**
 * The planning step whose confirmation hands the turn to the plan model: once the user
 * has seen the engine step (3 of 5), the next turns write the plan (4) and revise it.
 */
export const OPENPIXO_AGENT_AUTO_PLAN_FROM_STEP = 3;

export function isOpenPixoAgentAutoModel(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.trim().replace(/^openpixo\//u, '') === OPENPIXO_AGENT_AUTO_MODEL;
}

export interface OpenPixoAgentAutoInput {
  /** The project is a new game whose plan the user has not approved. */
  planPending: boolean;
  /** The step label of the newest planning reply in this conversation, 1-5; null when none has one. */
  lastPlanStep: number | null;
  /** Plan-model turns this game already had. */
  planTurnsUsed: number;
  /** The cloud currently offers the plan model. */
  planModelOffered: boolean;
}

export interface OpenPixoAgentAutoChoice {
  model: string;
  /** This run is one of the game's plan turns. */
  planTurn: boolean;
}

/** Which real model an Auto run uses. Without the plan model on offer, Auto is Flash. */
export function chooseOpenPixoAgentAutoModel(input: OpenPixoAgentAutoInput): OpenPixoAgentAutoChoice {
  const planTurn = input.planPending
    && input.planModelOffered
    && input.lastPlanStep !== null
    && input.lastPlanStep >= OPENPIXO_AGENT_AUTO_PLAN_FROM_STEP
    && input.planTurnsUsed < OPENPIXO_AGENT_AUTO_PLAN_TURNS_PER_GAME;
  return { model: planTurn ? OPENPIXO_AGENT_AUTO_PLAN_MODEL : OPENPIXO_AGENT_DEFAULT_MODEL, planTurn };
}

/**
 * Hosted models no longer offered to users, even while the cloud still lists them.
 * A saved choice of one of these moves to {@link OPENPIXO_AGENT_AUTO_MODEL}.
 */
export const RETIRED_OPENPIXO_AGENT_MODELS: readonly string[] = Object.freeze(['openpixo-agent-pro']);

export function isRetiredOpenPixoAgentModel(id: string | null | undefined): boolean {
  return typeof id === 'string' && RETIRED_OPENPIXO_AGENT_MODELS.includes(id.trim().replace(/^openpixo\//u, ''));
}

export type OpenPixoAgentPrices = OpenPixoAgentModel['creditsPerMillionTokens'];

/**
 * Share of each token kind in a typical agent turn on a coding task: most of every
 * request is the conversation the vendor already cached, a little is new input, and
 * very little is the reply.
 */
export const TYPICAL_AGENT_TURN_TOKEN_MIX = Object.freeze({ cachedInput: 0.85, newInput: 0.10, output: 0.05 });

function price(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Credits per million tokens of a typical turn. New input is billed at the cache-write
 * rate where the model has one, since that is what a new prompt prefix costs there.
 * Null when the prices are missing or malformed.
 */
export function typicalAgentTurnCreditsPerMillion(prices: Partial<OpenPixoAgentPrices> | null | undefined): number | null {
  if (!prices) return null;
  const newInput = prices.inputCacheWrite ?? prices.inputCacheMiss;
  if (!price(prices.inputCacheHit) || !price(newInput) || !price(prices.output)) return null;
  const mix = TYPICAL_AGENT_TURN_TOKEN_MIX;
  return mix.cachedInput * prices.inputCacheHit + mix.newInput * newInput + mix.output * prices.output;
}

/** How many times the baseline's typical-turn cost this model has; null when either price is unknown. */
export function hostedModelCostMultiplier(
  prices: Partial<OpenPixoAgentPrices> | null | undefined,
  baseline: Partial<OpenPixoAgentPrices> | null | undefined,
): number | null {
  const cost = typicalAgentTurnCreditsPerMillion(prices);
  const base = typicalAgentTurnCreditsPerMillion(baseline);
  if (cost === null || base === null || base <= 0) return null;
  return cost / base;
}

/**
 * The multiplier of each model in a list, relative to {@link OPENPIXO_AGENT_DEFAULT_MODEL}
 * in that same list. Models without prices, and every model when the default has none,
 * are left out.
 */
export function hostedModelCostMultipliers(
  models: ReadonlyArray<{ id: string; creditsPerMillionTokens?: Partial<OpenPixoAgentPrices> | null }>,
): Map<string, number> {
  const result = new Map<string, number>();
  const baseline = models.find((model) => model.id === OPENPIXO_AGENT_DEFAULT_MODEL)?.creditsPerMillionTokens;
  for (const model of models) {
    const multiplier = hostedModelCostMultiplier(model.creditsPerMillionTokens, baseline);
    if (multiplier !== null) result.set(model.id, multiplier);
  }
  return result;
}

/**
 * `0.5×`, `1×`, `2.6×`, `12×`: one decimal below 10 without a trailing `.0`, whole
 * numbers from 10. Anything that would round to nothing reads `0.1×`, never `0×`.
 */
export function formatCostMultiplier(multiplier: number): string {
  const tenths = Math.max(1, Math.round(multiplier * 10));
  if (tenths >= 100) return `${Math.round(multiplier)}×`;
  return `${tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1)}×`;
}
