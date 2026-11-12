import type { RunApprovalDecision, RunApprovalRequest } from './run-approvals.js';

export type CodexApprovalDecision = RunApprovalDecision;

export interface CodexApprovalRequest extends Partial<RunApprovalRequest> {
  requestId: string;
  method: string;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  reason: string | null;
  command: string | null;
  cwd: string | null;
  paths: string[];
  /** Exact additional permissions or managed-network context under review. */
  details?: string;
  availableDecisions?: CodexApprovalDecision[];
}

export interface CodexApprovalListResponse {
  approvals: CodexApprovalRequest[];
}
