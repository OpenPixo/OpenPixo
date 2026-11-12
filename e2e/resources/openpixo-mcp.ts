#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

type Request = { id?: string | number; method?: string; params?: Record<string, unknown> };

function reply(request: Request) {
  if (request.id == null) return null;
  const respond = (result: unknown) => ({ jsonrpc: '2.0', id: request.id, result });
  if (request.method === 'initialize') return respond({
    protocolVersion: request.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} },
    serverInfo: { name: 'openpixo-acceptance', version: '1.0.0' },
  });
  if (request.method === 'ping') return respond({});
  if (request.method === 'tools/list') return respond({ tools: [{
    name: 'openpixo_ping', description: 'Return the fixed OpenPixo local acceptance marker.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }] });
  if (request.method === 'tools/call' && request.params?.name === 'openpixo_ping') {
    if (process.env.OPENPIXO_MCP_RECEIPT) appendFileSync(process.env.OPENPIXO_MCP_RECEIPT, 'openpixo_ping\n');
    return respond({ content: [{ type: 'text', text: 'OPENPIXO_MCP_OK' }] });
  }
  return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown fixture method or tool' } };
}

if (process.argv.includes('--self-check')) {
  assert.equal(reply({ method: 'notifications/initialized' }), null);
  assert.deepEqual(reply({ id: 1, method: 'tools/call', params: { name: 'openpixo_ping' } }), {
    jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'OPENPIXO_MCP_OK' }] },
  });
  process.stdout.write('OpenPixo MCP fixture self-check passed.\n');
} else {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    try {
      const response = reply(JSON.parse(line) as Request);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
    }
  });
}
