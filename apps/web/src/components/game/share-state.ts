import type { GameEngineId, PublishedGame, PublishJob, PublishPhase, PublishStatusResponse, RoomsUsage } from '@openpixo/contracts';

/** Pure decisions behind the Share dialog (specs/current/publish-and-rooms.md). The dialog only draws them. */

const WEB_ENGINES: readonly GameEngineId[] = ['phaser', 'threejs', 'web-generic'];

/** Only web games get a link; every other engine has no Share button at all. */
export function isShareableEngine(engine: GameEngineId): boolean {
  return WEB_ENGINES.includes(engine);
}

/** Whole megabytes, rounded down so a creator is never told a game fits when it does not. */
export function formatPlanMegabytes(bytes: number): string {
  return String(Math.floor(bytes / 1_048_576));
}

export function isJobRunning(job: PublishJob | null | undefined): boolean {
  return Boolean(job) && job?.phase !== 'done' && job?.phase !== 'failed';
}

/**
 * Publishing this game beyond the plan's game count, for a one-time charge
 * (specs/current/online-features.md, "Extra public games").
 */
export interface ExtraGameOffer {
  /** The one-time price. */
  credits: number;
  /** The plan the count belongs to, when the cloud said. */
  sku: string | null;
  maxLiveGames: number;
  /** The cloud refused the last try for too few credits. */
  refusedForCredits: boolean;
}

/** The price the daemon put beside a PUBLISH_EXTRA_GAME_REQUIRED job; the contract's job error does not declare it yet. */
export function jobExtraGameCredits(job: PublishJob | null | undefined): number | null {
  const credits = (job?.error as { credits?: unknown } | undefined)?.credits;
  return typeof credits === 'number' && Number.isSafeInteger(credits) && credits > 0 ? credits : null;
}

/**
 * The offer before a publish, or null. The plan says when its count is full, so
 * the creator sees the price before pressing anything; a refusal from the cloud
 * (the count changed in another window) brings the same offer back. A cloud
 * without extra games sends no price, and then nothing is offered: its own
 * refusal shows as before. Updating a live link, or one already paid as extra,
 * costs nothing more.
 */
export function extraGameOffer(status: PublishStatusResponse): ExtraGameOffer | null {
  const { publishPlan: plan, game, job } = status;
  if (plan?.planRequired) return null;
  const failedCode = job?.phase === 'failed' ? job.error?.code : undefined;
  const offer = (credits: number): ExtraGameOffer => ({ credits, sku: plan?.sku ?? null, maxLiveGames: plan?.maxLiveGames ?? 0,
    refusedForCredits: failedCode === 'INSUFFICIENT_CREDITS' });
  if (failedCode === 'PUBLISH_EXTRA_GAME_REQUIRED') {
    const credits = jobExtraGameCredits(job) ?? plan?.extraGameCredits;
    return credits === undefined ? null : offer(credits);
  }
  if (!plan || plan.extraGameCredits === undefined || plan.liveGames < plan.maxLiveGames) return null;
  if (game && (game.state !== 'removed' || game.extraPaid)) return null;
  return offer(plan.extraGameCredits);
}

/** Too few credits for the offer: the balance when it is known, otherwise the cloud's last word. */
export function extraGameShort(offer: ExtraGameOffer, balance: number | null | undefined): boolean {
  return typeof balance === 'number' ? balance < offer.credits : offer.refusedForCredits;
}

export type ShareView =
  | { kind: 'loading' }
  | { kind: 'unreachable' }
  | { kind: 'signed-out' }
  | { kind: 'closed' }
  | { kind: 'unsupported' }
  | { kind: 'plan-required' }
  | { kind: 'form'; needsTerms: boolean; extraGame?: ExtraGameOffer }
  | { kind: 'publishing'; job: PublishJob }
  | { kind: 'live' | 'under-review'; game: PublishedGame; updatesPaused: boolean; needsTerms: boolean; planLapsed: boolean }
  | { kind: 'removed'; game: PublishedGame }
  | { kind: 'failed'; job: PublishJob; game: PublishedGame | null; canRetry: boolean };

/**
 * One view for one status, in the order that matters to the creator: a running
 * publish always shows, because closing the dialog does not stop it; an existing
 * link stays visible while sharing is paused, because the game keeps playing; a
 * failure the creator has not dismissed comes before the state it left behind.
 * A refusal for unaccepted rules is not a failure: the checkbox answers it.
 */
export function deriveShareView(
  status: PublishStatusResponse | null,
  { loadFailed = false, dismissedJobId = null }: { loadFailed?: boolean; dismissedJobId?: string | null } = {},
): ShareView {
  if (!status) return { kind: loadFailed ? 'unreachable' : 'loading' };
  const { job, game, available, unavailableReason, termsAccepted, publishPlan } = status;
  if (job && isJobRunning(job)) return { kind: 'publishing', job };
  if (!available) {
    if (unavailableReason === 'signed_out') return { kind: 'signed-out' };
    if (unavailableReason === 'engine_unsupported') return { kind: 'unsupported' };
    if (!game) return { kind: 'closed' };
  }
  if (game?.state === 'removed') return { kind: 'removed', game };
  const planRequired = publishPlan?.planRequired === true;
  const extraGame = game ? null : extraGameOffer(status);
  // These answer a refusal themselves: the checkbox, the plan offer and the extra-game offer below.
  const answered = job?.error?.code === 'SHARE_TERMS_REQUIRED' || job?.error?.code === 'PUBLISH_PLAN_REQUIRED'
    || (extraGame !== null && (job?.error?.code === 'PUBLISH_EXTRA_GAME_REQUIRED' || job?.error?.code === 'INSUFFICIENT_CREDITS'));
  if (job?.phase === 'failed' && job.id !== dismissedJobId && !answered) {
    return { kind: 'failed', job, game, canRetry: available && !planRequired };
  }
  if (game) {
    return { kind: game.state === 'under_review' ? 'under-review' : 'live', game, updatesPaused: !available || planRequired, needsTerms: !termsAccepted, planLapsed: planRequired };
  }
  if (planRequired) return { kind: 'plan-required' };
  return { kind: 'form', needsTerms: !termsAccepted, ...(extraGame ? { extraGame } : {}) };
}

export type PublishStepPhase = Extract<PublishPhase, 'building' | 'checking' | 'uploading' | 'activating'>;
export interface PublishStep { phase: PublishStepPhase; state: 'done' | 'current' | 'pending' }

const STEP_ORDER: readonly PublishStepPhase[] = ['building', 'checking', 'uploading', 'activating'];

/** The four steps the creator watches, from the job's real phase. */
export function publishSteps(job: PublishJob): PublishStep[] {
  const current = STEP_ORDER.indexOf(job.phase as PublishStepPhase);
  return STEP_ORDER.map((phase, index) => ({
    phase,
    state: index < current ? 'done' : index === current ? 'current' : 'pending',
  }));
}

/** 0 to 1 while files are uploading; null when there is nothing to measure. */
export function uploadFraction(job: PublishJob): number | null {
  if (job.phase !== 'uploading' || job.filesTotal <= 0) return null;
  return Math.min(1, Math.max(0, job.filesDone / job.filesTotal));
}

/** The cloud's most. The rooms route refuses more. */
const MONTHLY_LIMIT_MAX = 10_000_000;

/** A monthly limit is a whole number of credits, 0 or more. Anything else is null. */
export function parseMonthlyLimit(input: string): number | null {
  const text = input.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value <= MONTHLY_LIMIT_MAX ? value : null;
}

/** Hours to one decimal, rounded down so the creator is never told they have more than they do. */
export function formatHours(minutes: number): string {
  return String(Math.floor(Math.max(0, minutes) / 6) / 10);
}

export function freeMinutesLeft(usage: RoomsUsage): number {
  return Math.max(0, usage.freeMinutesTotal - usage.freeMinutesUsed);
}

export function limitReached(usage: RoomsUsage): boolean {
  return usage.creditsCharged >= usage.monthlyCreditLimit;
}

/** Only a credential-free http(s) URL may be offered as a link or opened. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
