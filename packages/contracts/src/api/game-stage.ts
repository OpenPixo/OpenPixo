// A new game's next build stage in a fresh conversation of the same project.
//
// By the build stages a new game's conversation holds 160-230k tokens of planning
// and art iteration, and every request re-sends it. A fresh conversation of the
// same project already receives the approved plan (`metadata.gamePlan.approvedPlan`)
// and the project notes, so what it lacks is which stage comes next: the agent reads
// that from the last stage label in its own conversation (no daemon stage state, by
// the 2026-11-10 decision). The new conversation therefore opens with a user message
// that names the stage, written here so the UI and `pixo game plan next-stage` send
// the same words.
import type { Conversation } from './projects.js';

/** The most stages a plan has; a larger number in a label is not a stage label. */
export const GAME_STAGE_MAX = 12;

/** A build reply's stage label, `阶段 2 / 共 4：…` or `Stage 2 of 4: …`. */
export interface GameStageLabel {
  stage: number;
  total: number;
  /** The language the label was written in, which the next stage's first message follows. */
  locale: 'zh-CN' | 'en';
}

const ZH_LABEL = /阶段\s*(\d{1,2})\s*[/／]\s*(?:共\s*)?(\d{1,2})\s*(?:个阶段)?\s*[：:]/u;
const EN_LABEL = /\bstage\s+(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})\s*[：:]/iu;

/**
 * The first stage label in a build reply, or null. The reply opens with it
 * (`renderApprovedPlanBlock`); markdown emphasis around it is ignored.
 */
export function parseGameStageLabel(text: string | null | undefined): GameStageLabel | null {
  if (!text) return null;
  const head = text.slice(0, 2000);
  const zh = ZH_LABEL.exec(head);
  const en = EN_LABEL.exec(head);
  const match = zh && (!en || zh.index <= en.index) ? zh : en;
  if (!match) return null;
  const stage = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(stage) || !Number.isInteger(total) || stage < 1 || total < stage || total > GAME_STAGE_MAX) return null;
  return { stage, total, locale: match === zh ? 'zh-CN' : 'en' };
}

/** The stage the next conversation builds, or null when the label was the last stage. */
export interface NextGameStage {
  stage: number;
  /** Null when no stage has been built yet and the plan's count is not known here. */
  total: number | null;
  locale: 'zh-CN' | 'en';
}

/**
 * The stage after the newest labelled reply; stage 1 when nothing has been built
 * yet (the plan was just approved); null after the last stage.
 */
export function nextGameStage(latest: GameStageLabel | null, fallbackLocale: string | null | undefined): NextGameStage | null {
  if (!latest) return { stage: 1, total: null, locale: stageLocale(fallbackLocale) };
  if (latest.stage >= latest.total) return null;
  return { stage: latest.stage + 1, total: latest.total, locale: latest.locale };
}

function stageLocale(locale: string | null | undefined): 'zh-CN' | 'en' {
  return locale?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

/** The new conversation's first message, word for word. */
export function renderNextStageKickoff(next: NextGameStage): string {
  const { stage, total } = next;
  if (next.locale === 'zh-CN') {
    const label = total ? `阶段 ${stage} / 共 ${total}` : `阶段 ${stage}`;
    const done = stage > 1 ? `阶段 1${stage > 2 ? `–${stage - 1}` : ''} 已经做完并确认。` : '计划已经批准。';
    return `在这个新对话里继续：${done}请按已批准的计划制作${label}。`;
  }
  const label = total ? `stage ${stage} of ${total}` : `stage ${stage}`;
  const done = stage > 1 ? `Stage${stage > 2 ? `s 1–${stage - 1} are` : ' 1 is'} built and confirmed.` : 'The plan is approved.';
  return `Continuing in this new conversation: ${done} Build ${label} of the approved plan.`;
}

/** The new conversation's title in the list. */
export function nextStageConversationTitle(next: NextGameStage): string {
  if (next.locale === 'zh-CN') return next.total ? `阶段 ${next.stage} / 共 ${next.total}` : `阶段 ${next.stage}`;
  return next.total ? `Stage ${next.stage} of ${next.total}` : `Stage ${next.stage}`;
}

/** POST /api/projects/:id/game-plan/next-stage-conversation. */
export interface StartNextStageConversationRequest {
  /** The conversation whose newest stage label decides the next stage. */
  fromConversationId: string;
  /** Language of the first message when no stage has a label yet; the UI locale. */
  locale?: string;
}

export interface StartNextStageConversationResponse {
  conversation: Conversation;
  /** Send this as the new conversation's first message. */
  firstMessage: string;
  stage: number;
  total: number | null;
}
