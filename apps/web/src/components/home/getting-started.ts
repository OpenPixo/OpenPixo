import type { Project } from '../../types';
import { SAMPLE_TEMPLATE_ID } from '../new-game/quick-sample';

export type GettingStartedStepId = 'ai' | 'image' | 'sample' | 'first-game' | 'run';

export interface GettingStartedStep {
  id: GettingStartedStepId;
  done: boolean;
}

/** A setup fact: known yes/no, still being read, or not available on this screen. */
export type SetupFact = boolean | 'loading' | 'unknown';

/**
 * Home's first steps, each read from something the app already knows; a step
 * with no fact behind it is left out, never shown as done or undone on a
 * guess. `null` means "not yet": some fact is still loading, so nothing is
 * drawn rather than a list that flips a moment later.
 *
 * - ai: an agent that can build a game (`readyAgentSource`).
 * - image: a way to make images (`readyImageSource`).
 * - sample: the finished sample game exists (it opens when it is made).
 * - first-game: a game that is not the sample exists.
 * - run: some game has run successfully (`metadata.gameRunSucceededAt`).
 */
export function gettingStartedSteps(input: {
  projects: readonly Project[];
  agentReady: SetupFact;
  imageReady: SetupFact;
}): GettingStartedStep[] | null {
  if (input.agentReady === 'loading' || input.imageReady === 'loading') return null;
  const steps: GettingStartedStep[] = [];
  if (input.agentReady !== 'unknown') steps.push({ id: 'ai', done: input.agentReady });
  if (input.imageReady !== 'unknown') steps.push({ id: 'image', done: input.imageReady });
  const isSample = (project: Project) => project.metadata?.templateId === SAMPLE_TEMPLATE_ID;
  steps.push({ id: 'sample', done: input.projects.some(isSample) });
  steps.push({ id: 'first-game', done: input.projects.some(project => !isSample(project)) });
  steps.push({
    id: 'run',
    done: input.projects.some(project => Number.isFinite(project.metadata?.gameRunSucceededAt)),
  });
  return steps;
}

export const GETTING_STARTED_DISMISSED_KEY = 'pixo.home.gettingStarted.dismissed';

/** Dismissal is a per-profile browser preference; storage may be unavailable. */
export function readGettingStartedDismissed(): boolean {
  try {
    return window.localStorage.getItem(GETTING_STARTED_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeGettingStartedDismissed(): void {
  try {
    window.localStorage.setItem(GETTING_STARTED_DISMISSED_KEY, '1');
  } catch {
    /* Private mode or blocked storage: hidden until the next launch. */
  }
}
