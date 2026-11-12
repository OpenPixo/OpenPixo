import { AGENT_SETUP_GUIDES } from '@openpixo/contracts';
import type { AgentSetupGuide } from '@openpixo/contracts';
import type { AgentInfo } from '../../types';

export { AGENT_SETUP_GUIDES, agentSetupGuide } from '@openpixo/contracts';
export type { AgentSetupGuide } from '@openpixo/contracts';

/** Only an HTTPS vendor page may be opened from onboarding. */
export function safeAgentUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The install rows onboarding shows when no local agent is usable: every
 * productized agent, joined with whatever the daemon reported about it (its
 * vendor link, its own name), in the guide's stable order.
 */
export function missingAgentGuides(
  agents: readonly AgentInfo[],
): Array<AgentSetupGuide & { installUrl: string | null }> {
  return AGENT_SETUP_GUIDES.map((guide) => {
    const reported = agents.find((agent) => agent.id === guide.id);
    return {
      ...guide,
      name: reported?.name || guide.name,
      installUrl: safeAgentUrl(reported?.installUrl),
    };
  });
}
