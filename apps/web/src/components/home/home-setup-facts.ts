import { useSyncExternalStore } from 'react';
import type { AgentInfo, AppConfig } from '../../types';

/**
 * The setup facts the entry shell already holds (detected agents, app config)
 * and its way back into first-run setup. The shell hands them only to
 * `NoAgentNotice`, so that notice publishes them here and Home's
 * getting-started list reads the same answer instead of detecting agents a
 * second time. `null` means nothing published them (the notice is not
 * mounted): steps that need them are left out rather than guessed.
 */
export interface HomeSetupInputs {
  agents: readonly AgentInfo[];
  agentsLoading: boolean;
  config: AppConfig;
  /** Opens first-run setup again, where the AI and image tools are set up. */
  openSetup: () => void;
}

let current: HomeSetupInputs | null = null;
const listeners = new Set<() => void>();

export function publishHomeSetupInputs(next: HomeSetupInputs | null): void {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const read = () => current;

export function useHomeSetupInputs(): HomeSetupInputs | null {
  return useSyncExternalStore(subscribe, read, read);
}
