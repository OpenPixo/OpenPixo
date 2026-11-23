/**
 * The first-login walkthrough: four hands-on steps in the finished sample game
 * (play it, change it yourself, ask the AI, start your own), then one-time hints
 * in the user's first own game. Saved as the app preference `firstRunGuide`
 * (`GET/PUT /api/app-config`, `pixo config get|set firstRunGuide`).
 *
 * Absent means this installation was never offered it: the one condition for
 * showing it by itself, so an existing user is never interrupted.
 */
export const FIRST_RUN_GUIDE_STEPS = ['play', 'tune', 'ask', 'make'] as const;
export type FirstRunGuideStep = (typeof FIRST_RUN_GUIDE_STEPS)[number];

export const FIRST_RUN_GUIDE_STATUSES = ['active', 'skipped', 'done'] as const;
export type FirstRunGuideStatus = (typeof FIRST_RUN_GUIDE_STATUSES)[number];

/** Shown once each in the first own game: approving a plan, paying for art, trying a stage, sharing. */
export const FIRST_RUN_HINTS = ['plan', 'art', 'stage', 'share'] as const;
export type FirstRunHint = (typeof FIRST_RUN_HINTS)[number];

export interface FirstRunGuidePrefs {
  status: FirstRunGuideStatus;
  /** Where the walkthrough is, or where it stopped. */
  step: FirstRunGuideStep;
  /** The sample game it runs in, once one was made. */
  projectId?: string;
  /** Hints already shown and closed. */
  hintsSeen?: FirstRunHint[];
}

const MAX_PROJECT_ID = 200;

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/**
 * A saved walkthrough state, or null for anything else. A bare status
 * (`pixo config set firstRunGuide skipped`) is accepted as shorthand.
 */
export function parseFirstRunGuide(value: unknown): FirstRunGuidePrefs | null {
  if (oneOf(FIRST_RUN_GUIDE_STATUSES, value)) return { status: value, step: 'play' };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { status, step, projectId, hintsSeen } = value as Record<string, unknown>;
  if (!oneOf(FIRST_RUN_GUIDE_STATUSES, status) || !oneOf(FIRST_RUN_GUIDE_STEPS, step)) return null;
  const hints = Array.isArray(hintsSeen) ? FIRST_RUN_HINTS.filter(hint => hintsSeen.includes(hint)) : [];
  return {
    status,
    step,
    ...(typeof projectId === 'string' && projectId && projectId.length <= MAX_PROJECT_ID ? { projectId } : {}),
    ...(hints.length ? { hintsSeen: hints } : {}),
  };
}

/** The step after `step`, or null after the last one. */
export function nextFirstRunGuideStep(step: FirstRunGuideStep): FirstRunGuideStep | null {
  return FIRST_RUN_GUIDE_STEPS[FIRST_RUN_GUIDE_STEPS.indexOf(step) + 1] ?? null;
}
