// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexApprovalRequest, RunApprovalRequest } from '@openpixo/contracts';
import { CodexApprovals } from '../../../src/components/chat/CodexApprovals';
import { I18nProvider } from '../../../src/i18n';

const approval: CodexApprovalRequest = {
  requestId: 'approval-1',
  method: 'item/commandExecution/requestApproval',
  threadId: 'thread-1',
  turnId: 'turn-1',
  itemId: 'command-1',
  reason: 'The command needs network access.',
  command: 'npm install',
  cwd: 'C:/game',
  paths: ['C:/game/package-lock.json'],
};

function response(approvals: Array<CodexApprovalRequest | RunApprovalRequest> = [approval]) {
  return new Response(JSON.stringify({ approvals }), { status: 200 });
}

async function settle() {
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Codex approval requests', () => {
  it('does not query or show controls without an active native run', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CodexApprovals runId={null} />);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows request details and waits for a decision without sending one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    render(<CodexApprovals runId="run/one" />);
    await settle();
    expect(screen.getByRole('region', { name: 'Approval needed' })).toBeTruthy();
    expect(screen.getByText('Codex needs your approval')).toBeTruthy();
    expect(screen.getByText(approval.reason!)).toBeTruthy();
    expect(screen.getByText(approval.command!)).toBeTruthy();
    expect(screen.getByText(approval.paths[0]!)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/runs/run%2Fone/approvals');
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel task' })).toBeTruthy();
  });

  it('shows exact permission grants and leaves out decisions the native runtime did not offer', async () => {
    const details = JSON.stringify({ permissions: { network: { enabled: true } }, scope: 'turn' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ ...approval, details, availableDecisions: ['decline', 'cancel'] }])));
    render(<CodexApprovals runId="run-permissions" />);
    await settle();
    expect(screen.getByText(details)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(false);
  });

  // Real Codex run 2026-11-13: availableDecisions was ["accept","cancel"]. The card showed a greyed-out
  // Deny with no reason, and refusing meant guessing that "Cancel task" was the way to say no.
  it('without a separate decline, says that denying stops the run and sends cancel', async () => {
    let pending = true;
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') { pending = false; return new Response('{"ok":true}', { status: 200 }); }
      return response(pending ? [{ ...approval, availableDecisions: ['accept', 'cancel'] }] : []);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CodexApprovals runId="run-no-decline" />);
    await settle();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel task' })).toBeNull();
    expect(screen.getByText('Codex offers no separate Deny for this request, so denying also stops this run.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deny and stop this run' }));
    await settle();
    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST');
    expect(JSON.parse(posts[0]![1]!.body as string)).toEqual({ decision: 'cancel' });
  });

  it('names the deny-and-stop choice in the selected UI language', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ ...approval, availableDecisions: ['accept', 'cancel'] }])));
    render(<I18nProvider initial="zh-CN"><CodexApprovals runId="run-no-decline-zh" /></I18nProvider>);
    await settle();
    expect(screen.getByRole('button', { name: '拒绝并停止本轮' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
  });

  it.each([
    ['Allow once', 'accept'],
    ['Deny', 'decline'],
    ['Cancel task', 'cancel'],
  ])('sends the explicit %s decision to the matching request', async (label, decision) => {
    let pending = true;
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        pending = false;
        return new Response('{"ok":true}', { status: 200 });
      }
      return response(pending ? [approval] : []);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CodexApprovals runId="run-1" />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await settle();
    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]![0]).toBe('/api/runs/run-1/approvals/approval-1');
    expect(JSON.parse(posts[0]![1]!.body as string)).toEqual({ decision });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('retries failed reads after one second and clears the error after recovery', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    render(<CodexApprovals runId="run-1" />);
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('Could not load');
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy();
  });

  it('keeps a pending request actionable when its response fails', async () => {
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => (
      options?.method === 'POST'
        ? new Response('{"error":"temporarily unavailable"}', { status: 503 })
        : response()
    ));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodexApprovals runId="run-1" />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('Could not send');
    expect(screen.getByRole('button', { name: 'Deny' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows a recoverable error for a malformed approval list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    render(<CodexApprovals runId="run-1" />);
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('Could not load');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('discards a late result after switching runs and stops polling on exit', async () => {
    let resolveOld!: (value: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const fetchMock = vi.fn(async (url: string) => (
      url.includes('run-old') ? oldResponse : response([{ ...approval, requestId: 'new', command: 'new command' }])
    ));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CodexApprovals runId="run-old" />);
    view.rerender(<CodexApprovals runId="run-new" />);
    await settle();
    resolveOld(response());
    await settle();
    expect(screen.getByText('new command')).toBeTruthy();
    expect(screen.queryByText('npm install')).toBeNull();
    view.rerender(<CodexApprovals runId={null} />);
    const calls = fetchMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('uses the selected UI language for approval actions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    render(<I18nProvider initial="zh-CN"><CodexApprovals runId="run-1" /></I18nProvider>);
    await settle();
    expect(screen.getByRole('region', { name: '需要你的审批' })).toBeTruthy();
    expect(screen.getByText('Codex 需要你的审批')).toBeTruthy();
    expect(screen.getByRole('button', { name: '允许一次' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消任务' })).toBeTruthy();
  });

  it('shows a localized Claude summary and sends the decision by the generalized id', async () => {
    const request: RunApprovalRequest = { id: 'claude-1', runtime: 'claude', tool: 'Write', summary: 'Create or overwrite game.ts', createdAt: 1, paths: ['game.ts'], toolUseId: 'tool-1' };
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST' ? new Response('{"ok":true}') : response([request]));
    vi.stubGlobal('fetch', fetchMock);
    render(<I18nProvider initial="zh-CN"><CodexApprovals runId="claude-run" /></I18nProvider>);
    await settle();
    expect(screen.getByText('Claude Code 需要你的审批')).toBeTruthy();
    expect(screen.getByText('创建或覆盖 game.ts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }));
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/claude-run/approvals/claude-1', expect.objectContaining({ method: 'POST', body: '{"decision":"accept"}' }));
  });

  it.each([
    ['timed-out', 'Timed out. Denied automatically.'],
    ['stopped', 'Task stopped. Request denied.'],
  ] as const)('shows the %s state without decisions and stops polling a finished run', async (status, copy) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ closed: true, approvals: [{ id: 'claude-1', runtime: 'claude', tool: 'Bash', summary: 'Run git status', command: 'git status', createdAt: 1, status }] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodexApprovals runId="finished-run" />);
    await settle();
    expect(screen.getByRole('status').textContent).toBe(copy);
    expect(screen.queryByRole('button')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('restarts polling when the same run resumes and ignores expired historical runs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"closed":true,"approvals":[]}'))
      .mockResolvedValueOnce(response())
      .mockResolvedValue(new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CodexApprovals runId="run-1" streaming={false} />);
    await settle();
    expect(screen.queryByRole('region')).toBeNull();
    view.rerender(<CodexApprovals runId="run-1" streaming />);
    await settle();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy();
    view.rerender(<CodexApprovals runId="expired-run" streaming={false} />);
    await settle();
    expect(screen.queryByRole('region')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
