import type { OpenPixoAgentModel } from './openpixo-agent.js';

/**
 * Which hosted agent models a user can pick, and what each one costs compared with
 * the default. Shared by the daemon (catalogue, runs), the web picker and `pixo credits
 * agent-models`, so every surface agrees.
 */

/** DeepSeek V4.1 Flash: the hosted model a user gets when nothing else was chosen. */
export const OPENPIXO_AGENT_DEFAULT_MODEL = 'openpixo-agent-flash';

/**
 * Hosted models no longer offered to users, even while the cloud still lists them.
 * A saved choice of one of these moves to {@link OPENPIXO_AGENT_DEFAULT_MODEL}.
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
