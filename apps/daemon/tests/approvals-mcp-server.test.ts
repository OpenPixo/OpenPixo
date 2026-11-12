import { describe, expect, it, vi } from 'vitest';
import type { ClaudeApprovalResult } from '@openpixo/contracts';
import { APPROVAL_REQUEST_TOOL, handleApprovalsMcpRequest } from '../src/runtimes/approvals-mcp-server.js';

describe('approval stdio MCP handler', () => {
  it('advertises the permission-prompt tool contract and server name', async () => {
    expect(await handleApprovalsMcpRequest({ id: 1, method: 'initialize' })).toMatchObject({ result: { serverInfo: { name: 'openpixo_approvals' } } });
    expect(await handleApprovalsMcpRequest({ id: 2, method: 'tools/list' })).toMatchObject({ result: { tools: [APPROVAL_REQUEST_TOOL] } });
    expect(APPROVAL_REQUEST_TOOL.inputSchema.required).toEqual(['tool_name', 'input']);
    expect(APPROVAL_REQUEST_TOOL.inputSchema.additionalProperties).toBe(true);
  });

  it.each<ClaudeApprovalResult>([
    { behavior: 'allow', updatedInput: { command: 'git status' } },
    { behavior: 'deny', message: 'The user denied this call.' },
  ])('returns one text item containing Claude JSON for $behavior', async (result) => {
    const forward = vi.fn(async () => result);
    const args = { tool_name: 'Bash', input: { command: 'git status' }, tool_use_id: 'tool-1', future_field: true };
    expect(await handleApprovalsMcpRequest({ id: 3, method: 'tools/call', params: { name: 'request', arguments: args } }, forward)).toEqual({
      jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    });
    expect(forward).toHaveBeenCalledWith(args);
  });
});
