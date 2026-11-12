#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// This fixture speaks the public Codex app-server protocol. Its receipts let the
// E2E suite inspect runtime configuration without replacing daemon code.
const args = process.argv.slice(2);
const receipt = args[args.indexOf('--receipt-log') + 1];
if (args.includes('--version')) {
  process.stdout.write('codex-cli 0.160.0\n');
  process.exit(0);
}
if (!args.includes('app-server') || !receipt) process.exit(1);

type Frame = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: { decision?: string } };
let threadId = `fixture-${randomUUID()}`;
let turnId = '';
let cwd = process.cwd();
let approvalId: string | null = null;
let scenario = '';

function record(event: string, value: Record<string, unknown> = {}) {
  appendFileSync(receipt!, `${JSON.stringify({ event, pid: process.pid, threadId, turnId, ...value })}\n`);
}

function send(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function notify(method: string, params: Record<string, unknown>) {
  send({ jsonrpc: '2.0', method, params: { threadId, turnId, ...params } });
}

function complete(text: string, status = 'completed') {
  const item = { id: `answer-${turnId}`, type: 'agentMessage', phase: 'final_answer', text };
  notify('item/started', { item: { ...item, text: '' } });
  notify('item/agentMessage/delta', { itemId: item.id, delta: text });
  notify('item/completed', { item });
  notify('turn/completed', { turn: { id: turnId, status, items: [item], error: null } });
  record('completed', { status });
}

function finishApproved() {
  mkdirSync(join(cwd, 'assets', 'derived'), { recursive: true });
  copyFileSync(join(cwd, 'assets', 'sprite.png'), join(cwd, 'assets', 'derived', 'sprite-copy.png'));
  writeFileSync(join(cwd, 'openpixo-result.txt'), 'Native app-server fixture completed.\n');
  const childThreadId = `${threadId}-asset-check`;
  for (const kind of ['started', 'completed']) {
    notify('item/completed', { item: {
      id: `child-${kind}`, type: 'subAgentActivity', agentThreadId: childThreadId,
      agentPath: '/root/asset-check', kind,
    } });
  }
  complete('Created assets/derived/sprite-copy.png and preserved the original sprite.');
}

record('spawned', { args });
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const frame = JSON.parse(line) as Frame;
  if (frame.id === approvalId && frame.method == null) {
    record('approval-response', { decision: frame.result?.decision });
    approvalId = null;
    if (frame.result?.decision === 'accept') finishApproved();
    else complete('The requested operation was declined.');
    return;
  }
  const params = frame.params ?? {};
  record('request', { method: frame.method, params: frame.method === 'turn/start' ? undefined : params });
  const reply = (result: unknown) => send({ jsonrpc: '2.0', id: frame.id, result });
  switch (frame.method) {
    case 'initialize': reply({ userAgent: 'codex/0.160.0' }); break;
    case 'initialized': break;
    case 'thread/start':
    case 'thread/resume':
      if (typeof params.threadId === 'string') threadId = params.threadId;
      if (typeof params.cwd === 'string') cwd = params.cwd;
      reply({ thread: { id: threadId, path: join(cwd, 'fixture-session.jsonl') } });
      break;
    case 'turn/start': {
      turnId = `turn-${randomUUID()}`;
      const input = Array.isArray(params.input) ? params.input as Array<{ text?: string }> : [];
      const prompt = input.map((item) => item.text ?? '').join('\n');
      scenario = prompt.includes('OPENPIXO_APPROVE') ? 'approval' : prompt.includes('OPENPIXO_HOLD') ? 'hold' : 'complete';
      record('turn-scenario', { scenario, cwd, hasSkillCanary: prompt.includes('OPENPIXO_ASSET_SKILL_CANARY') });
      reply({ turn: { id: turnId, status: 'inProgress', items: [] } });
      notify('turn/started', { turn: { id: turnId, status: 'inProgress' } });
      if (scenario === 'approval') {
        approvalId = `approval-${turnId}`;
        send({ jsonrpc: '2.0', id: approvalId, method: 'item/commandExecution/requestApproval', params: {
          threadId, turnId, itemId: 'copy-sprite', command: 'copy sprite to derived output', cwd,
          reason: 'Fixture requests explicit user approval before producing a derived asset.',
        } });
      } else if (scenario === 'complete') complete('Independent game task completed.');
      break;
    }
    case 'turn/interrupt':
      reply({});
      complete('Task interrupted.', 'interrupted');
      break;
    default:
      if (frame.id != null) send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Unsupported fixture method' } });
  }
});
lines.on('close', () => process.exit(0));
