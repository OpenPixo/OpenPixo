import type { AgentCapabilitiesResponse } from '@openpixo/contracts';

let capabilitiesRequest: Promise<AgentCapabilitiesResponse> | null = null;

/** Share the matrix for this browser session unless Settings explicitly refreshes it. */
export function fetchAgentCapabilities(refresh = false): Promise<AgentCapabilitiesResponse> {
  if (!capabilitiesRequest || refresh) {
    capabilitiesRequest = (async () => {
      const response = await fetch('/api/agents/capabilities');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as AgentCapabilitiesResponse;
      if (!result.matrix || !result.runtimes) throw new Error('Invalid capability response');
      return result;
    })();
    capabilitiesRequest.catch(() => { capabilitiesRequest = null; });
  }
  return capabilitiesRequest;
}
