import type { AgentInfo } from '../types';
import { RETAINED_AGENT_IDS } from '@openpixo/contracts';


const KEPT_AGENT_IDS = new Set<string>(RETAINED_AGENT_IDS);

export function isVisibleLocalCliAgent(agent: Pick<AgentInfo, 'id'>): boolean {
  return agent.id !== 'byok-opencode';
}

/**
 * How many detected agents the picker will actually present as usable.
 *
 * Counting the raw detection list instead would include agents that are
 * deliberately hidden from the UI, so a rescan could announce more CLIs than
 * the list beneath it ever renders — "3 available" above a list of two.
 */
export function availableVisibleAgentCount(agents: AgentInfo[]): number {
  return agents.filter((agent) => isVisibleLocalCliAgent(agent) && agent.available)
    .length;
}

/** Resolve retired saved IDs without rewriting the user's stored preference. */
export function resolveAvailableAgentId(
  savedId: string | null | undefined,
  agents: readonly AgentInfo[],
): string | null {
  // A kept CLI can be temporarily unavailable; retain its selected state so
  // the usual installation/authentication guidance remains reachable.
  if (savedId && (KEPT_AGENT_IDS.has(savedId) || agents.some((agent) => agent.id === savedId))) return savedId;
  return ['codex', 'claude', 'opencode'].find(
    (id) => agents.some((agent) => agent.id === id && agent.available),
  ) ?? agents.find((agent) => agent.available && isVisibleLocalCliAgent(agent))?.id ?? null;
}
