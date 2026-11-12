import type { RunApprovalDecision, RunApprovalRequest } from '@openpixo/contracts';
import type { CodexAppServerSession } from '../agent-protocol/codex-app-server/session.js';

export interface RunApprovalSession {
  listApprovals(): RunApprovalRequest[];
  respondApproval(id: string, decision: RunApprovalDecision): boolean;
  stop?(): void;
}

export function codexRunApprovalSession(session: Pick<CodexAppServerSession, 'listApprovals' | 'respondApproval'>): RunApprovalSession {
  return {
    listApprovals: () => session.listApprovals().map((request) => ({
      ...request,
      id: request.requestId,
      runtime: 'codex',
      tool: request.method,
      summary: request.command ?? request.reason ?? request.method,
      createdAt: request.createdAt ?? Date.now(),
      ...(request.itemId ? { toolUseId: request.itemId } : {}),
    })),
    respondApproval: (id, decision) => session.respondApproval(id, decision),
  };
}
