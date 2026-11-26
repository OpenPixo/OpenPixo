import type { MotionApiErrorCode, MotionJob, MotionJobState } from '@openpixo/contracts';
import type { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { motionErrorCode, MotionRequestError } from '../../providers/motion';

type Translate = ReturnType<typeof useI18n>['t'];

const ERRORS: Partial<Record<MotionApiErrorCode, keyof Dict>> = {
  ACCOUNT_SIGNED_OUT: 'motion.error.signedOut', INSUFFICIENT_CREDITS: 'motion.error.credits', MOTION_PAUSED: 'motion.paused', MOTION_PICTURE_INVALID: 'motion.pictureInvalid',
  MOTION_NOT_FOUND: 'motion.gone', MOTION_PORTRAIT_LIMIT: 'motion.error.limit', MOTION_PORTRAIT_NOT_READY: 'motion.error.notReady', MOTION_PORTRAIT_USED: 'motion.error.used', MOTION_PORTRAIT_EXPIRED: 'motion.error.expired',
  MOTION_BUSY: 'motion.error.busy', MOTION_RATE_LIMITED: 'motion.error.limited', MOTION_CONTENT_BLOCKED: 'motion.error.blocked', MOTION_PAINTING_FAILED: 'motion.error.painting', MOTION_BUILD_FAILED: 'motion.error.build',
  MOTION_TIMED_OUT: 'motion.error.timedOut', MOTION_DOWNLOAD_FAILED: 'motion.error.download', CLOUD_UNAVAILABLE: 'motion.error.cloud', MOTION_NOT_CONFIGURED: 'motion.unavailable',
};

/** What went wrong, in the user's language. The daemon's own words say what to do about a game. */
export function errorText(t: Translate, error: unknown): string {
  const code = motionErrorCode(error);
  if (code === 'MOTION_INSTALL_FAILED' && error instanceof MotionRequestError) return error.message;
  return codeText(t, code);
}
export function codeText(t: Translate, code: MotionApiErrorCode | null): string {
  const key = code ? ERRORS[code] : undefined;
  return t(key ?? 'motion.error.unknown');
}

export const isOpen = (job: MotionJob | null): boolean => Boolean(job && job.state !== 'succeeded' && job.state !== 'failed');

/** The steps a user is shown. The portrait is the first, and it is done before anything is ordered. */
export const STEPS = ['portrait', 'painting', 'checking', 'building', 'baking'] as const;
const STEP_NAMES: Record<(typeof STEPS)[number], keyof Dict> = {
  portrait: 'motion.step.portrait', painting: 'motion.step.painting', checking: 'motion.step.checking', building: 'motion.step.building', baking: 'motion.step.baking',
};
export const stepText = (t: Translate, step: (typeof STEPS)[number]): string => t(STEP_NAMES[step]);
/** How many steps are done. */
export function stepsDone(state: MotionJobState): number {
  if (state === 'succeeded') return STEPS.length;
  if (state === 'waiting' || state === 'failed') return 1;
  return Math.max(1, (STEPS as readonly string[]).indexOf(state));
}
export function stateText(t: Translate, state: MotionJobState): string {
  if (state === 'waiting') return t('motion.state.waiting');
  if (state === 'succeeded') return t('motion.state.done');
  if (state === 'failed') return t('motion.state.failed');
  return stepText(t, state);
}
