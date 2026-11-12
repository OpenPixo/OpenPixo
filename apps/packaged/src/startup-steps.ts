/**
 * Local record of where packaged startup spends its time.
 *
 * Analytics already receives coarse launch timing, but a user reporting a
 * slow start can only hand over their logs. Steps are kept in memory because
 * most of them happen before the desktop log exists, and written as one line
 * once the sidecars are up (`[openpixo packaged] startup steps`).
 *
 * Each value is milliseconds since this process started (`performance.now()`),
 * so the line also shows time spent before any of our code ran.
 */
export type StartupStep = readonly [step: string, sinceProcessStartMs: number];

const steps: StartupStep[] = [];

export function markStartupStep(step: string, now: () => number = () => performance.now()): void {
  steps.push([step, Math.round(now())]);
}

/** The steps so far, in order, as `{ step: ms }` (a repeated step keeps its first time). */
export function startupStepsSummary(recorded: readonly StartupStep[] = steps): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const [step, ms] of recorded) {
    if (!(step in summary)) summary[step] = ms;
  }
  return summary;
}
