// The rules of the first-login walkthrough and its one-time hints, over facts
// the project page already has. No DOM and no requests: `ProjectGuide.tsx` draws.
import { gamePlanIsPending, parseArtRequest, type FirstRunGuidePrefs, type FirstRunHint, type ProjectMetadata } from '@openpixo/contracts';
import { nextStageOffer } from '../../runtime/chat/next-stage';
import type { ChatMessage } from '../../types';
import { SAMPLE_TEMPLATE_ID } from '../new-game/wizard-state';
import { cloudCanSpend, readyAgentSource } from '../onboarding/setup-readiness';

/** The setting the walkthrough asks the user to drag, by its key in the sample's `tuning.json`. */
export const GUIDE_TUNING_KEY = 'jumpPower';

/** How the sample game is doing, as the 游戏 view sees it. */
export type GuideRun = 'stopped' | 'installing' | 'starting' | 'running' | 'failed';

/** How the user's request to the AI is going. */
export type GuideAsk = 'todo' | 'working' | 'done' | 'failed';

type MessageFacts = Pick<ChatMessage, 'role' | 'content' | 'runStatus'>;

function lastReply(messages: readonly MessageFacts[]): MessageFacts | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant') return message;
  }
  return null;
}

export function guideAsk(messages: readonly MessageFacts[], running: boolean): GuideAsk {
  if (running) return 'working';
  const reply = lastReply(messages);
  if (!reply) return 'todo';
  return reply.runStatus === 'failed' || reply.runStatus === 'canceled' ? 'failed' : 'done';
}

/** Who would answer the request: OpenPixo credits, the user's own AI, or nobody yet and what would fix that. */
export type GuideAgent = 'loading' | 'credits' | 'own' | 'needs-sign-in' | 'needs-credits' | 'needs-setup';

export function guideAgent(input: {
  loading: boolean;
  cloudAvailable: boolean;
  cloud: Parameters<typeof cloudCanSpend>[0];
  agents: Parameters<typeof readyAgentSource>[0]['agents'];
  config: Parameters<typeof readyAgentSource>[0]['config'];
}): GuideAgent {
  const source = readyAgentSource({ cloud: input.cloud, agents: input.agents, config: input.config });
  if (source) return source.kind === 'hosted' ? 'credits' : 'own';
  if (input.loading) return 'loading';
  // Credits without an agent is a broken install: buying more would not fix it.
  if (cloudCanSpend(input.cloud) || !input.cloudAvailable) return 'needs-setup';
  return input.cloud.signedIn ? 'needs-credits' : 'needs-sign-in';
}

/** Web games open in a browser, so only they get a link to share. */
const WEB_ENGINES = new Set(['phaser', 'threejs', 'web-generic']);

/**
 * The one hint to show in a game of the user's own, or null. Only someone who
 * came in through the walkthrough has a saved state, so nobody else ever sees
 * one; each is shown until it is closed, and then never again.
 */
export function firstRunHint(input: {
  guide: FirstRunGuidePrefs | null | undefined;
  metadata: Pick<ProjectMetadata, 'templateId' | 'gamePlan' | 'gameRunSucceededAt' | 'engineProfile'> | null | undefined;
  messages: readonly MessageFacts[];
  running: boolean;
}): FirstRunHint | null {
  const { guide, metadata, messages, running } = input;
  if (!guide || running || !metadata || metadata.templateId === SAMPLE_TEMPLATE_ID) return null;
  const unseen = (hint: FirstRunHint) => !guide.hintsSeen?.includes(hint);
  const reply = lastReply(messages)?.content ?? '';
  if (unseen('art') && reply && parseArtRequest(reply)) return 'art';
  if (unseen('plan') && gamePlanIsPending(metadata) && reply) return 'plan';
  if (unseen('stage') && nextStageOffer(metadata.gamePlan, reply)) return 'stage';
  // Sharing comes after the user has been told to try a stage, and has run one.
  if (unseen('share') && !unseen('stage') && metadata.gamePlan?.status === 'approved'
    && Number.isFinite(metadata.gameRunSucceededAt)
    && WEB_ENGINES.has(metadata.engineProfile?.engine ?? '')) return 'share';
  return null;
}
