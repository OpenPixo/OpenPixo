export type RunApprovalDecision = 'accept' | 'decline' | 'cancel';
export type RunApprovalStatus = 'pending' | 'timed-out' | 'stopped';

export interface RunApprovalRequest {
  id: string;
  runtime: string;
  tool: string;
  summary: string;
  createdAt: number;
  paths?: string[];
  command?: string | null;
  toolUseId?: string;
  status?: RunApprovalStatus;
  fromSubAgent?: boolean;
  /** Native Codex fields retained for existing clients. */
  requestId?: string;
  method?: string;
  reason?: string | null;
  cwd?: string | null;
  details?: string;
  availableDecisions?: RunApprovalDecision[];
}

export interface RunApprovalListResponse {
  approvals: RunApprovalRequest[];
  closed?: boolean;
}

export interface RunApprovalDecisionInput {
  decision: RunApprovalDecision;
}

export interface ClaudeApprovalInput {
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id?: string;
  [key: string]: unknown;
}

export type ClaudeApprovalResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };
