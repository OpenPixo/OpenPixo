import { nextGameStage, parseGameStageLabel, type GamePlanState, type NextGameStage } from '@openpixo/contracts';

/**
 * Whether to offer the next build stage in a fresh conversation, and which one.
 * Only for a game whose plan is approved, under a build reply that opens with a
 * stage label (`阶段 2 / 共 4：…`) that is not the last stage. Planning replies and
 * replies without a label get no offer; the approve bar covers the start of stage 1.
 */
export function nextStageOffer(plan: GamePlanState | null | undefined, latestReply: string | null | undefined): NextGameStage | null {
  if (plan?.status !== 'approved') return null;
  const label = parseGameStageLabel(latestReply);
  return label ? nextGameStage(label, label.locale) : null;
}
