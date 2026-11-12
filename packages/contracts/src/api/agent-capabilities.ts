export type CapabilityCell =
  | 'project-skills' | 'project-mcp' | 'global-mcp' | 'approvals'
  | 'interrupt' | 'resume' | 'steer' | 'sub-agents' | 'image-input'
  | 'media-cli' | 'game-verify' | 'plan-mode';

export interface CapabilityEvidence {
  state: 'verified' | 'implemented' | 'unsupported' | 'unknown';
  /** CLI version the state was established on, e.g. "codex 0.160.0". */
  testedVersion?: string;
  /** Test file or acceptance record id. */
  evidence?: string;
  note?: string;
}

export type RuntimeCapabilityMatrix = Record<string, Record<CapabilityCell, CapabilityEvidence>>;

export interface AgentCapabilitiesResponse {
  matrix: RuntimeCapabilityMatrix;
  runtimes: Record<string, { installedVersion?: string }>;
}
