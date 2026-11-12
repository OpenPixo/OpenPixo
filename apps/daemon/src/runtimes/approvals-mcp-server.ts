import readline from 'node:readline';
import { request as requestHttp } from 'undici';
import type { ClaudeApprovalInput, ClaudeApprovalResult } from '@openpixo/contracts';
import { APPROVAL_REQUEST_TOOL_ENDPOINT } from '../tool-tokens.js';
import { CLAUDE_APPROVAL_TIMEOUT_MS, isClaudeApprovalInput } from './claude-approvals.js';

type JsonObject = Record<string, unknown>;
interface JsonRpcRequest { id?: string | number | null; method?: string; params?: JsonObject }

export const APPROVAL_REQUEST_TOOL = {
  name: 'request',
  description: "OpenPixo's permission prompt. Claude Code calls this when a tool needs the user's permission. Do not call it yourself. It blocks until the user allows or denies the tool call in OpenPixo.",
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string', description: 'The tool that needs permission, e.g. Bash, Write, Edit, or mcp__<server>__<tool>.' },
      input: { type: 'object', description: "The tool's input, exactly as it will run.", additionalProperties: true },
      tool_use_id: { type: 'string', description: 'ID of the pending tool_use block.' },
    },
    required: ['tool_name', 'input'],
    additionalProperties: true,
  },
};

async function requestApproval(input: ClaudeApprovalInput): Promise<ClaudeApprovalResult> {
  const rawUrl = process.env.PIXO_DAEMON_URL;
  const token = process.env.PIXO_TOOL_TOKEN;
  if (!rawUrl || !token) throw new Error('PIXO_DAEMON_URL and PIXO_TOOL_TOKEN are required');
  const url = new URL(rawUrl);
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}${APPROVAL_REQUEST_TOOL_ENDPOINT}`;
  url.search = '';
  url.hash = '';
  const response = await requestHttp(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
    // A human may take longer than undici's default five-minute header timeout.
    headersTimeout: CLAUDE_APPROVAL_TIMEOUT_MS + 60_000,
    bodyTimeout: CLAUDE_APPROVAL_TIMEOUT_MS + 60_000,
  });
  const result = await response.body.json();
  if (response.statusCode !== 200) throw new Error(`daemon approval endpoint failed with ${response.statusCode}`);
  if (!result || typeof result !== 'object'
    || !('behavior' in result)
    || !(result.behavior === 'deny' && 'message' in result && typeof result.message === 'string'
      || result.behavior === 'allow' && 'updatedInput' in result && result.updatedInput && typeof result.updatedInput === 'object' && !Array.isArray(result.updatedInput))) {
    throw new Error('Invalid daemon approval result');
  }
  return result as ClaudeApprovalResult;
}

export async function handleApprovalsMcpRequest(
  request: JsonRpcRequest,
  forward: (input: ClaudeApprovalInput) => Promise<ClaudeApprovalResult> = requestApproval,
): Promise<JsonObject | undefined> {
  const id = request.id ?? null;
  if (request.method?.startsWith('notifications/')) return undefined;
  try {
    if (request.method === 'initialize') {
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'openpixo_approvals', version: '0.1.0' },
      } };
    }
    if (request.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (request.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: [APPROVAL_REQUEST_TOOL] } };
    if (request.method === 'tools/call') {
      if (request.params?.name !== 'request' || !isClaudeApprovalInput(request.params.arguments)) throw new Error('Expected request with tool_name and an object input');
      const result = await forward(request.params.arguments);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${String(request.method)}` } };
  } catch (error) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } };
  }
}

export async function runApprovalsMcpServer(): Promise<{ exitCode: number }> {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid request');
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
      continue;
    }
    // Concurrent sub-agents may be awaiting different user decisions.
    const work = handleApprovalsMcpRequest(request).then((response) => {
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    });
    pending.add(work);
    void work.finally(() => pending.delete(work));
  }
  await Promise.all(pending);
  return { exitCode: 0 };
}
