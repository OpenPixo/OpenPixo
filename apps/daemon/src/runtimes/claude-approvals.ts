import { randomUUID } from 'node:crypto';
import type {
  ClaudeApprovalInput, ClaudeApprovalResult, RunApprovalDecision, RunApprovalRequest,
} from '@openpixo/contracts';
import type { RunApprovalSession } from './run-approvals.js';

export const CLAUDE_APPROVAL_TIMEOUT_MS = 10 * 60 * 1_000;

export function claudeApprovalDenyMessage(tool: string, reason: 'decline' | 'timed-out' | 'stopped'): string {
  if (reason === 'timed-out') {
    return `No one answered this ${tool} request in OpenPixo in time, so it was denied. The user may be away. Do not retry it on your own. Finish what you can without it, then tell the user which action still needs approval.`;
  }
  if (reason === 'stopped') {
    return `The user stopped this task in OpenPixo, so this ${tool} call was denied. Do not retry it or start anything new. End your turn.`;
  }
  return `The user denied this ${tool} call in OpenPixo. Do not retry it or get the same result another way. Continue without it, or ask the user how they want to proceed.`;
}

export function isClaudeApprovalInput(value: unknown): value is ClaudeApprovalInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return typeof request.tool_name === 'string' && request.tool_name.trim().length > 0
    && Boolean(request.input) && typeof request.input === 'object' && !Array.isArray(request.input)
    && (request.tool_use_id === undefined || typeof request.tool_use_id === 'string');
}

function approvalRequest(payload: ClaudeApprovalInput): RunApprovalRequest {
  const tool = payload.tool_name;
  const filePath = payload.input[tool === 'NotebookEdit' ? 'notebook_path' : 'file_path'];
  const paths = typeof filePath === 'string' ? [filePath] : [];
  const command = tool === 'Bash' && typeof payload.input.command === 'string' ? payload.input.command : undefined;
  const mcp = /^mcp__(.+?)__(.+)$/u.exec(tool);
  const summary = tool === 'Write' && paths[0] ? `Create or overwrite ${paths[0]}`
    : ['Edit', 'MultiEdit', 'NotebookEdit'].includes(tool) && paths[0] ? `Edit ${paths[0]}`
    : command ? `Run ${command}`
    : mcp ? `Use ${mcp[2]} from ${mcp[1]}` : `Use ${tool}`;
  return {
    id: randomUUID(), runtime: 'claude', tool, summary, createdAt: Date.now(), status: 'pending',
    ...(paths.length ? { paths } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(payload.tool_use_id ? { toolUseId: payload.tool_use_id } : {}),
  };
}

type ApprovalEvent = { type: 'approval_request' | 'approval_resolved'; requestId: string; [key: string]: unknown };

export class ClaudeApprovalSession implements RunApprovalSession {
  readonly runtime = 'claude';
  readonly #requests = new Map<string, RunApprovalRequest>();
  readonly #pending = new Map<string, {
    input: Record<string, unknown>;
    resolve(result: ClaudeApprovalResult): void;
    cleanup(): void;
  }>();
  #stopped = false;

  constructor(private readonly onEvent: (event: ApprovalEvent) => void = () => {}) {}

  requestApproval(payload: ClaudeApprovalInput, signal?: AbortSignal): Promise<ClaudeApprovalResult> {
    if (this.#stopped || signal?.aborted) {
      return Promise.resolve({ behavior: 'deny', message: claudeApprovalDenyMessage(payload.tool_name, 'stopped') });
    }
    // The approval is for these exact arguments, even if the caller mutates its object later.
    const input = structuredClone(payload.input);
    const request = approvalRequest({ ...payload, input });
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.#resolve(request.id, 'timed-out'), CLAUDE_APPROVAL_TIMEOUT_MS);
      timer.unref?.();
      const abort = () => this.#resolve(request.id, 'stopped');
      this.#requests.set(request.id, request);
      this.#pending.set(request.id, { input, resolve, cleanup: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      } });
      signal?.addEventListener('abort', abort, { once: true });
      this.onEvent({ type: 'approval_request', ...request, requestId: request.id });
    });
  }

  listApprovals(): RunApprovalRequest[] {
    return [...this.#requests.values()].map((request) => ({ ...request, ...(request.paths ? { paths: [...request.paths] } : {}) }));
  }

  respondApproval(id: string, decision: RunApprovalDecision): boolean {
    if (decision !== 'accept' && decision !== 'decline' && decision !== 'cancel') return false;
    return this.#resolve(id, decision === 'cancel' ? 'stopped' : decision);
  }

  #resolve(id: string, outcome: 'accept' | 'decline' | 'timed-out' | 'stopped'): boolean {
    const pending = this.#pending.get(id);
    const request = this.#requests.get(id);
    if (!pending || !request) return false;
    pending.cleanup();
    this.#pending.delete(id);
    if (outcome === 'timed-out' || outcome === 'stopped') request.status = outcome;
    else this.#requests.delete(id);
    pending.resolve(outcome === 'accept'
      ? { behavior: 'allow', updatedInput: pending.input }
      : { behavior: 'deny', message: claudeApprovalDenyMessage(request.tool, outcome) });
    this.onEvent({ type: 'approval_resolved', requestId: id, decision: outcome === 'accept' ? 'accept' : 'decline', status: outcome });
    return true;
  }

  stop(): void {
    this.#stopped = true;
    for (const id of this.#pending.keys()) this.#resolve(id, 'stopped');
  }
}
