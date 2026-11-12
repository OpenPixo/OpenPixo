import type { Express, Request, Response } from 'express';
import type { CodexAppServerSession } from '../agent-protocol/codex-app-server/session.js';
import { createToolRequestAuth } from '../http/tool-request-auth.js';
import { toolTokenRegistry, APPROVAL_REQUEST_TOOL_ENDPOINT } from '../tool-tokens.js';
import { ClaudeApprovalSession, claudeApprovalDenyMessage, isClaudeApprovalInput } from '../runtimes/claude-approvals.js';
import { readOnlyTurnClaudeDecision } from '../runtimes/read-only-turn.js';
import type { RunApprovalSession } from '../runtimes/run-approvals.js';

type ApprovalRequest = Request<Record<string, string>, unknown, Record<string, unknown>>;
type ApprovalResponse = Response<unknown>;

interface ApprovalRun {
  status: string;
  agentId?: string | null;
  cancelRequested?: boolean;
  readOnlyTurn?: boolean;
  approvalSession?: RunApprovalSession;
  codexApprovalSession?: Pick<CodexAppServerSession, 'listApprovals' | 'respondApproval'>;
}

interface RunApprovalRouteDeps<Run extends ApprovalRun> {
  getRun(id: string): Run | null | undefined;
  cancelRun(run: Run): Promise<unknown>;
  authorize(req: ApprovalRequest, res: ApprovalResponse, run: Run, write: boolean): Promise<boolean>;
  sendApiError(res: ApprovalResponse, status: number, code: string, message: string): unknown;
}

export function registerRunApprovalRoutes<Run extends ApprovalRun>(app: Express, deps: RunApprovalRouteDeps<Run>): void {
  const { authorizeToolRequest } = createToolRequestAuth(toolTokenRegistry);
  const getRun = async (req: ApprovalRequest, res: ApprovalResponse, write: boolean): Promise<Run | null> => {
    const authorization = req.headers?.authorization;
    if (typeof authorization === 'string' && /^Bearer\s+pixott_/iu.test(authorization.trim())) {
      deps.sendApiError(res, 403, 'FORBIDDEN', 'Approval decisions require the user');
      return null;
    }
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const run = id ? deps.getRun(id) : null;
    if (!run) {
      deps.sendApiError(res, 404, 'NOT_FOUND', 'run not found');
      return null;
    }
    return await deps.authorize(req, res, run, write) ? run : null;
  };
  app.get<Record<string, string>, unknown, Record<string, unknown>>('/api/runs/:id/approvals', async (req, res) => {
    const run = await getRun(req, res, false);
    if (!run) return;
    const active = run.status === 'running' && !run.cancelRequested;
    const closed = run.cancelRequested === true || (run.status !== 'running' && run.status !== 'queued');
    res.json({
      approvals: run.approvalSession
        ? run.approvalSession.listApprovals().filter((request) => active || request.status === 'timed-out' || request.status === 'stopped')
        : active ? run.codexApprovalSession?.listApprovals() ?? [] : [],
      ...(run.approvalSession || run.agentId ? { closed } : {}),
    });
  });
  app.post<Record<string, string>, unknown, Record<string, unknown>>('/api/runs/:id/approvals/:requestId', async (req, res) => {
    const run = await getRun(req, res, true);
    if (!run) return;
    const decision = req.body?.decision;
    if (decision !== 'accept' && decision !== 'decline' && decision !== 'cancel') {
      deps.sendApiError(res, 400, 'BAD_REQUEST', 'decision must be accept, decline, or cancel');
      return;
    }
    const requestId = typeof req.params.requestId === 'string' ? req.params.requestId : '';
    const session = run.approvalSession ?? run.codexApprovalSession;
    if (run.status !== 'running' || run.cancelRequested || !session?.respondApproval(requestId, decision)) {
      deps.sendApiError(res, 409, 'CODEX_APPROVAL_CLOSED', 'approval is no longer pending');
      return;
    }
    if (decision === 'cancel') await deps.cancelRun(run);
    res.json({ ok: true });
  });

  app.post<Record<string, string>, unknown, Record<string, unknown>>(APPROVAL_REQUEST_TOOL_ENDPOINT, async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'approvals:request');
    if (!grant) return;
    const run = deps.getRun(grant.runId);
    if (!run) { deps.sendApiError(res, 404, 'NOT_FOUND', 'run not found'); return; }
    if (!isClaudeApprovalInput(req.body)) {
      deps.sendApiError(res, 400, 'BAD_REQUEST', 'tool_name and an object input are required');
      return;
    }
    if (run.status !== 'running' || run.cancelRequested) {
      res.json({ behavior: 'deny', message: claudeApprovalDenyMessage(req.body.tool_name, 'stopped') });
      return;
    }
    // The host decides before the user is asked: a read-only turn cannot change the project.
    const held = run.readOnlyTurn ? readOnlyTurnClaudeDecision(req.body) : null;
    if (held) { res.json(held); return; }
    if (!(run.approvalSession instanceof ClaudeApprovalSession)) {
      deps.sendApiError(res, 409, 'APPROVAL_UNAVAILABLE', 'this run does not accept Claude approval requests');
      return;
    }
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.once('close', onClose);
    try {
      res.json(await run.approvalSession.requestApproval(req.body, controller.signal));
    } finally {
      res.off('close', onClose);
    }
  });
}

export const registerCodexApprovalRoutes = registerRunApprovalRoutes;
