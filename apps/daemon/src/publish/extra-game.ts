import type { PublishedGame, PublishPlan } from '@openpixo/contracts';

/**
 * The one-time price this publish costs beyond the plan's game count, or null when it costs nothing
 * extra (specs/current/online-features.md, "Extra public games"). A link that is live or under review
 * already counts, so updating it is free; so is bringing back a removed game that was paid as extra.
 * A new link, or a removed or never-finished one, needs the charge once the plan's count is full.
 * A cloud without extra games sends no price, and then nothing here changes today's refusal.
 */
export function extraGamePrice(plan: PublishPlan | undefined, game: PublishedGame | null | undefined): number | null {
  if (!plan || plan.planRequired || plan.extraGameCredits === undefined) return null;
  if (plan.liveGames < plan.maxLiveGames) return null;
  if (game && (game.state !== 'removed' || game.extraPaid)) return null;
  return plan.extraGameCredits;
}
