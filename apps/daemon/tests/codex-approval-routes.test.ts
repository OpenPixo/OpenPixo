import type { Express, Request, Response } from 'express';
import type { CodexApprovalDecision } from '@openpixo/contracts';
import { describe, expect, it, vi } from 'vitest';
import { registerCodexApprovalRoutes } from '../src/routes/codex-approvals.js';

function harness() {
  type RequestHandler = (req: Request<Record<string, string>, unknown, Record<string, unknown>>, res: Response<unknown>) => Promise<void>;
  const handlers = new Map<string, RequestHandler>();
  const app = {
    get: (route: string, handler: RequestHandler) => handlers.set(`GET ${route}`, handler),
    post: (route: string, handler: RequestHandler) => handlers.set(`POST ${route}`, handler),
  };
  const respondApproval = vi.fn((_id: string, _decision: CodexApprovalDecision) => true);
  const approval = { requestId: 'pending-1', method: 'item/commandExecution/requestApproval', threadId: 'th-1', turnId: 'tu-1', itemId: 'cmd-1', reason: null, command: 'git status', cwd: '/workspace', paths: [] };
  const run = {
    status: 'running', cancelRequested: false,
    codexApprovalSession: { listApprovals: () => [approval], respondApproval },
  };
  const authorize = vi.fn(async (_req: Request<Record<string, string>, unknown, Record<string, unknown>>, _res: Response<unknown>, _run: typeof run, _write: boolean) => true);
  const cancelRun = vi.fn(async (target: typeof run) => { target.cancelRequested = true; target.status = 'canceled'; });
  registerCodexApprovalRoutes(app as unknown as Express, {
    getRun: (id) => id === 'run-1' ? run : null,
    cancelRun,
    authorize,
    sendApiError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
  });
  async function request(method: 'GET' | 'POST', { runId = 'run-1', requestId = 'pending-1', decision }: { runId?: string; requestId?: string; decision?: unknown } = {}) {
    let status = 200;
    let body: unknown;
    const res = { status: (value: number) => { status = value; return res; }, json: (value: unknown) => { body = value; return res; } };
    const req = { params: { id: runId, requestId }, body: { decision } };
    const path = method === 'GET' ? '/api/runs/:id/approvals' : '/api/runs/:id/approvals/:requestId';
    await handlers.get(`${method} ${path}`)!(req as unknown as Request<Record<string, string>, unknown, Record<string, unknown>>, res as unknown as Response<unknown>);
    return { status, body };
  }
  return { request, run, authorize, respondApproval, cancelRun };
}

describe('run-scoped Codex approval HTTP surface', () => {
  it('lists only pending requests for an active root', async () => {
    const h = harness();
    expect((await h.request('GET')).body).toMatchObject({ approvals: [{ requestId: 'pending-1' }] });
    h.run.status = 'succeeded';
    expect((await h.request('GET')).body).toEqual({ approvals: [] });
  });

  it.each(['accept', 'decline', 'cancel'])('requires explicit %s for the request belonging to that run', async (decision) => {
    const h = harness();
    expect(await h.request('POST', { decision })).toEqual({ status: 200, body: { ok: true } });
    expect(h.respondApproval).toHaveBeenCalledWith('pending-1', decision);
    expect(h.authorize.mock.calls[0]?.[3]).toBe(true);
    expect(h.cancelRun).toHaveBeenCalledTimes(decision === 'cancel' ? 1 : 0);
    expect(h.run.status).toBe(decision === 'cancel' ? 'canceled' : 'running');
  });

  it.each([undefined, '', 'acceptForSession', {}, ['accept']])('rejects invalid decision %j', async (decision) => {
    const h = harness();
    expect((await h.request('POST', { decision })).status).toBe(400);
    expect(h.respondApproval).not.toHaveBeenCalled();
  });

  it('rejects closed, cancelled and replayed approvals', async () => {
    const h = harness();
    h.respondApproval.mockReturnValue(false);
    expect((await h.request('POST', { decision: 'accept' })).status).toBe(409);
    h.respondApproval.mockClear();
    h.run.cancelRequested = true;
    expect((await h.request('POST', { decision: 'accept' })).status).toBe(409);
    expect(h.respondApproval).not.toHaveBeenCalled();
  });

  it('denies unknown or unauthorized roots without resolving another request', async () => {
    const h = harness();
    expect((await h.request('GET', { runId: 'other-run' })).status).toBe(404);
    h.authorize.mockResolvedValue(false);
    await h.request('POST', { decision: 'accept' });
    expect(h.respondApproval).not.toHaveBeenCalled();
  });
});
