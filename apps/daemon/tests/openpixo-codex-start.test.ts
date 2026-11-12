import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

type StartedServer = { url: string; server: Server; shutdown?: () => Promise<void> | void };
let started: StartedServer | null = null;
let fixtureDir: string | null = null;
const previousTransport = process.env.PIXO_CODEX_TRANSPORT;

afterEach(async () => {
  if (started?.server.listening) {
    const listener = started.server;
    const closed = new Promise<void>((resolve) => listener.close(() => resolve()));
    listener.closeAllConnections();
    await closed;
  }
  await started?.shutdown?.();
  started = null;
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  fixtureDir = null;
  if (previousTransport === undefined) delete process.env.PIXO_CODEX_TRANSPORT;
  else process.env.PIXO_CODEX_TRANSPORT = previousTransport;
});

it('starts the real Codex run pipeline with project skills and MCP in the run-owned scope', async () => {
  process.env.PIXO_CODEX_TRANSPORT = 'app-server';
  fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'openpixo-codex-start-'));
  const receipt = path.join(fixtureDir, 'receipt.json');
  const runner = path.join(fixtureDir, 'fake-codex.cjs');
  await writeFile(runner, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.160.0'); process.exit(0); }
if (args.includes('--help')) { console.log('Usage: codex app-server --json --sandbox --add-dir --model'); process.exit(0); }
if (args[0] !== 'app-server') process.exit(0);
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
let threadConfig = null;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const frame = JSON.parse(line);
  if (frame.method === 'initialize') send({ id: frame.id, result: { userAgent: 'codex/0.160.0' } });
  else if (frame.method === 'thread/start' || frame.method === 'thread/resume') {
    threadConfig = frame.params.config;
    send({ id: frame.id, result: { thread: { id: 'startup-thread-1', historyMode: 'paginated' } } });
  }
  else if (frame.method === 'thread/archive') send({ id: frame.id, result: {} });
  else if (frame.method === 'turn/start') {
    fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ args, config: threadConfig, prompt: frame.params.input[0].text }));
    send({ id: frame.id, result: { turn: { id: 'startup-turn-1' } } });
    send({ method: 'mcpServer/startupStatus/updated', params: { threadId: null, name: 'openpixo_startup-mcp', status: 'starting', error: null, failureReason: null } });
    send({ method: 'mcpServer/startupStatus/updated', params: { threadId: 'startup-thread-1', name: 'openpixo_startup-mcp', status: 'failed', error: 'MCP startup failed: startup-mcp-env-secret; startup-http-header-secret', failureReason: null } });
    send({ id: 'startup-approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'startup-thread-1', turnId: 'startup-turn-1', itemId: 'command-1', command: 'fixture command 1', cwd: process.cwd() } });
  } else if (frame.id === 'startup-approval-1' && frame.result?.decision === 'accept') {
    send({ method: 'item/completed', params: { threadId: 'startup-thread-1', item: { type: 'agentMessage', id: 'message-1', text: 'Startup fixture completed.' } } });
    send({ method: 'turn/completed', params: { threadId: 'startup-thread-1', turn: { id: 'startup-turn-1', status: 'completed', items: [] } } });
  }
}).on('close', () => process.exit(0));
`, 'utf8');
  let executable = runner;
  if (process.platform === 'win32') {
    executable = path.join(fixtureDir, 'codex-start.cmd');
    await writeFile(executable, `@echo off\r\n"${process.execPath}" "${runner}" %*\r\n`);
  } else await chmod(runner, 0o755);

  const skillDir = path.join(fixtureDir, 'startup-project-skill');
  await mkdir(skillDir);
  await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: startup-project-skill\ndescription: Production startup regression\n---\n\nOPENPIXO_STARTUP_SKILL_SENTINEL\n');
  started = await startServer({ port: 0, returnServer: true }) as StartedServer;
  async function post(route: string, body: unknown, method = 'POST') {
    return fetch(`${started!.url}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  const configured = await post('/api/app-config', {
    agentId: 'codex', agentCliEnv: { codex: { CODEX_BIN: executable, CODEX_HOME: fixtureDir } },
    telemetry: { metrics: false, }, privacyDecisionAt: Date.now(),
  }, 'PUT');
  expect(configured.status).toBe(200);
  const projectId = `startup_${randomUUID()}`;
  const created = await post('/api/projects', { id: projectId, name: 'OpenPixo startup regression', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true });
  expect(created.status).toBe(200);
  const { conversationId } = await created.json() as { conversationId: string };
  expect((await post(`/api/projects/${projectId}/extensions`, { kind: 'skill', source: skillDir })).status).toBe(201);
  expect((await post(`/api/projects/${projectId}/extensions`, { kind: 'mcp', server: { id: 'startup-mcp', enabled: true, transport: 'stdio', command: process.execPath, args: ['--version'], env: { GAME_TOKEN: 'startup-mcp-env-secret', DEBUG: '1' } } })).status).toBe(201);
  expect((await post(`/api/projects/${projectId}/extensions`, { kind: 'mcp', server: { id: 'startup-http', enabled: true, transport: 'http', url: 'https://example.invalid/mcp', headers: { 'X-Game-Token': 'startup-http-header-secret' } } })).status).toBe(201);
  const response = await post('/api/runs', {
    projectId, conversationId, agentId: 'codex', message: 'Check the fixture project.', currentPrompt: 'Check the fixture project.',
    assistantMessageId: randomUUID(), clientRequestId: randomUUID(),
  });
  expect(response.status).toBe(202);
  const { runId } = await response.json() as { runId: string };
  const approvals = async () => (await fetch(`${started!.url}/api/runs/${runId}/approvals`)).json() as Promise<{ approvals: Array<{ requestId: string; threadId: string; turnId: string; itemId: string }> }>;
  await expect.poll(async () => (await approvals()).approvals.length, { timeout: 10_000 }).toBe(1);
  const pending = (await approvals()).approvals[0];
  if (!pending) throw new Error('Expected one pending Codex approval');
  expect(pending).toMatchObject({ threadId: 'startup-thread-1', turnId: 'startup-turn-1', itemId: 'command-1' });
  expect((await post(`/api/runs/${runId}/approvals/${pending.requestId}`, { decision: 'accept' })).status).toBe(200);
  const status = async () => (await fetch(`${started!.url}/api/runs/${runId}`)).json() as Promise<{ status: string; error: string | null }>;
  await expect.poll(async () => (await status()).status, { timeout: 10_000 }).toBe('succeeded');
  const invocation = JSON.parse(await readFile(receipt, 'utf8')) as { args: string[]; prompt: string; config: Record<string, unknown> };
  expect(invocation.prompt).toContain('OPENPIXO_STARTUP_SKILL_SENTINEL');
  expect(invocation.args.join(' ')).not.toContain('mcp_servers');
  expect(invocation.args.join(' ')).not.toContain('startup-mcp-env-secret');
  expect(invocation.args.join(' ')).not.toContain('startup-http-header-secret');
  expect(invocation.config).toMatchObject({ mcp_servers: {
    'openpixo_startup-mcp': { env: { GAME_TOKEN: 'startup-mcp-env-secret', DEBUG: '1' } },
    'openpixo_startup-http': { http_headers: { 'X-Game-Token': 'startup-http-header-secret' } },
  } });
  const streamed = await fetch(`${started!.url}/api/runs/${runId}/events`, { signal: AbortSignal.timeout(5_000) });
  expect(streamed.ok).toBe(true);
  const eventText = await streamed.text();
  expect(eventText).toContain('"label":"mcp_connection"');
  expect(eventText).toContain('MCP startup failed');
  expect(eventText).toContain('startup-thread-1');
  expect(eventText).toContain('startup-turn-1');
  expect(eventText).toContain('command-1');
  expect(eventText).not.toContain('startup-mcp-env-secret');
  expect(eventText).not.toContain('startup-http-header-secret');
});
