// The first-login walkthrough, as this window knows it. The daemon's
// `firstRunGuide` preference is the saved copy (`/api/app-config`, shared with
// `pixo config`); App publishes it here when it reads the config, so a screen
// only subscribes and never reads the config again.
import { useSyncExternalStore } from 'react';
import {
  FIRST_RUN_HINTS,
  nextFirstRunGuideStep,
  parseFirstRunGuide,
  type AppConfigResponse,
  type FirstRunGuidePrefs,
  type FirstRunHint,
  type UpdateAppConfigRequest,
} from '@openpixo/contracts';

/** `undefined`: not read yet. `null`: read, and never offered here. */
export type FirstRunGuideState = FirstRunGuidePrefs | null | undefined;

let current: FirstRunGuideState;
let writes = 0;
const listeners = new Set<() => void>();

function set(next: FirstRunGuideState): void {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

/** What the daemon has saved. A copy read before a change still being written must not undo that change. */
export function publishFirstRunGuide(saved: unknown): void {
  if (writes === 0) set(parseFirstRunGuide(saved));
}

export function readFirstRunGuide(): FirstRunGuideState {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useFirstRunGuide(): FirstRunGuideState {
  return useSyncExternalStore(subscribe, readFirstRunGuide, readFirstRunGuide);
}

/** Shows the change at once and saves it. A failed save keeps it for this window only. */
function save(next: FirstRunGuidePrefs): void {
  set(next);
  writes += 1;
  const body: UpdateAppConfigRequest = { firstRunGuide: next };
  void fetch('/api/app-config', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (response) => {
    const answer = response.ok ? await response.json() as Partial<AppConfigResponse> : null;
    writes -= 1;
    if (answer?.config) publishFirstRunGuide(answer.config.firstRunGuide);
  }).catch(() => { writes = Math.max(0, writes - 1); });
}

/** Starts, or starts over, in the sample game just made. */
export function startFirstRunGuide(projectId: string): void {
  save({ ...current, status: 'active', step: 'play', projectId });
}

/** Goes on from where it stopped, in the game it was in; a finished one starts over. */
export function resumeFirstRunGuide(): void {
  if (!current) return;
  save(current.status === 'done' ? { ...current, status: 'active', step: 'play' } : { ...current, status: 'active' });
}

/** The next step, or the end after the last one. */
export function advanceFirstRunGuide(): void {
  if (!current) return;
  const step = nextFirstRunGuideStep(current.step);
  save(step ? { ...current, step } : { ...current, status: 'done' });
}

export function finishFirstRunGuide(): void {
  if (current) save({ ...current, status: 'done' });
}

export function skipFirstRunGuide(): void {
  if (current) save({ ...current, status: 'skipped' });
}

/** Someone who has made games before: no walkthrough and no hints, unless they ask for them. */
export function declineFirstRunGuide(): void {
  save({ status: 'skipped', step: 'play', hintsSeen: [...FIRST_RUN_HINTS] });
}

export function closeFirstRunHint(hint: FirstRunHint): void {
  if (!current || current.hintsSeen?.includes(hint)) return;
  const seen = current.hintsSeen ?? [];
  save({ ...current, hintsSeen: FIRST_RUN_HINTS.filter((item) => item === hint || seen.includes(item)) });
}

/** Test seam: forget everything, as in a window that has not read the config. */
export function resetFirstRunGuideForTests(): void {
  writes = 0;
  set(undefined);
}
