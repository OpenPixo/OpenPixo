import { EventEmitter } from 'node:events';
import type { Express, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeApprovalSession, CLAUDE_APPROVAL_TIMEOUT_MS } from '../src/runtimes/claude-approvals.js';
import { createChatRunService } from '../src/runtimes/runs.js';
import { registerRunApprovalRoutes } from '../src/routes/codex-approvals.js';
import { APPROVAL_REQUEST_TOOL_ENDPOINT, toolTokenRegistry } from '../src/tool-tokens.js';

afterEach(() => {
  vi.useRealTimers();
  toolTokenRegistry.clear();
});

describe('Claude run approvals', () => {
  it('waits for an explicit approval and returns the original tool input unchanged', async () => {
    const session = new ClaudeApprovalSession();
    const input = { file_path: 'src/game.ts', content: 'player.x += 1;', nested: { exact: true } };
    const result = session.requestApproval({ tool_name: 'Write', input, tool_use_id: 'tool-1', future_field: true });
    const pending = session.listApprovals()[0]!;
    expect(pending).toMatchObject({ runtime: 'claude', tool: 'Write', toolUseId: 'tool-1', paths: ['src/game.ts'], summary: 'Create or overwrite src/game.ts', status: 'pending', createdAt: expect.any(Number) });
    expect(session.respondApproval('other-request', 'accept')).toBe(false);
    input.content = 'changed after requesting';
    expect(session.respondApproval(pending.id, 'accept')).toBe(true);
    expect(await result).toEqual({ behavior: 'allow', updatedInput: { ...input, content: 'player.x += 1;' } });
    expect(session.listApprovals()).toEqual([]);
    expect(session.respondApproval(pending.id, 'accept')).toBe(false);
  });

  it('denies only the selected call with the supplied model-facing copy', async () => {
    const session = new ClaudeApprovalSession();
    const result = session.requestApproval({ tool_name: 'Bash', input: { command: 'npm install' } });
    const pending = session.listApprovals()[0]!;
    expect(pending).toMatchObject({ command: 'npm install', summary: 'Run npm install' });
    expect(session.respondApproval(pending.id, 'decline')).toBe(true);
    expect(await result).toEqual({ behavior: 'deny', message: 'The user denied this Bash call in OpenPixo. Do not retry it or get the same result another way. Continue without it, or ask the user how they want to proceed.' });
  });

  it('denies at the timeout boundary and keeps a resolved status for the card', async () => {
    vi.useFakeTimers();
    const session = new ClaudeApprovalSession();
    const result = session.requestApproval({ tool_name: 'Edit', input: { file_path: 'game.ts' } });
    await vi.advanceTimersByTimeAsync(CLAUDE_APPROVAL_TIMEOUT_MS - 1);
    expect(session.listApprovals()[0]?.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ behavior: 'deny', message: 'No one answered this Edit request in OpenPixo in time, so it was denied. The user may be away. Do not retry it on your own. Finish what you can without it, then tell the user which action still needs approval.' });
    expect(session.listApprovals()[0]?.status).toBe('timed-out');
    expect(session.respondApproval(session.listApprovals()[0]!.id, 'accept')).toBe(false);
  });

  it.each(['cancel', 'finish'] as const)('denies every pending call when the run reaches %s', async (action) => {
    vi.useFakeTimers();
    const runs = createChatRunService({ createSseResponse: vi.fn(), createSseErrorPayload: vi.fn() });
    const session = new ClaudeApprovalSession();
    const run = Object.assign(runs.create({ projectId: 'project-1', conversationId: 'conv-1', agentId: 'claude' }), { approvalSession: session });
    const results = [
      session.requestApproval({ tool_name: 'Write', input: {} }),
      session.requestApproval({ tool_name: 'Bash', input: {} }),
    ];
    if (action === 'cancel') await runs.cancel(run, 'user_stop');
    else runs.finish(run, 'succeeded', 0);
    expect(await Promise.all(results)).toEqual(['Write', 'Bash'].map((tool) => ({ behavior: 'deny', message: `The user stopped this task in OpenPixo, so this ${tool} call was denied. Do not retry it or start anything new. End your turn.` })));
    expect(session.listApprovals().map((request) => request.status)).toEqual(['stopped', 'stopped']);
    expect(await session.requestApproval({ tool_name: 'Edit', input: {} })).toMatchObject({ behavior: 'deny' });
  });

  it('authenticates the requesting run, long-polls, and refuses agent tokens on the decision route', async () => {
    type Handler = (req: Request<Record<string, string>, unknown, Record<string, unknown>>, res: Response<unknown>) => Promise<void>;
    const handlers = new Map<string, Handler>();
    const app = {
      get: (route: string, handler: Handler) => handlers.set(`GET ${route}`, handler),
      post: (route: string, handler: Handler) => handlers.set(`POST ${route}`, handler),
    };
    const run = { status: 'running', projectId: 'project-1', approvalSession: new ClaudeApprovalSession() };
    registerRunApprovalRoutes(app as unknown as Express, {
      getRun: (id) => id === 'run-1' ? run : null,
      cancelRun: async () => run.approvalSession.stop(),
      authorize: async () => true,
      sendApiError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
    });
    async function request(path: string, body: Record<string, unknown>, token?: string) {
      let status = 200;
      let responseBody: unknown;
      const res = Object.assign(new EventEmitter(), {
        status: (value: number) => { status = value; return res; },
        json: (value: unknown) => { responseBody = value; return res; },
      });
      const headers = token ? { authorization: `Bearer ${token}` } : {};
      const req = { path, headers, params: { id: 'run-1', requestId: run.approvalSession.listApprovals()[0]?.id }, body, get: (name: string) => name === 'authorization' ? headers.authorization : undefined };
      await handlers.get(`POST ${path}`)!(req as unknown as Parameters<Handler>[0], res as unknown as Parameters<Handler>[1]);
      return { status, body: responseBody };
    }
    expect((await request(APPROVAL_REQUEST_TOOL_ENDPOINT, { tool_name: 'Bash', input: {} })).status).toBe(401);
    const grant = toolTokenRegistry.mint({ runId: 'run-1', projectId: 'project-1' });
    const pending = request(APPROVAL_REQUEST_TOOL_ENDPOINT, { tool_name: 'Bash', input: { command: 'git status' } }, grant.token);
    expect(run.approvalSession.listApprovals()).toHaveLength(1);
    expect((await request('/api/runs/:id/approvals/:requestId', { decision: 'accept' }, grant.token)).status).toBe(403);
    expect(run.approvalSession.listApprovals()[0]?.status).toBe('pending');
    expect((await request('/api/runs/:id/approvals/:requestId', { decision: 'accept' })).status).toBe(200);
    expect(await pending).toEqual({ status: 200, body: { behavior: 'allow', updatedInput: { command: 'git status' } } });
  });
});
