import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { startServer } from '../src/server.js';
import { ACCESS, ANON, fakeSupabase, USER } from './account/fixtures.js';

// Production boundary for the OpenPixo-credits agent: the real daemon spawns a
// fixture "opencode" that calls the daemon's local gateway exactly as bundled
// OpenCode would (config from OPENCODE_CONFIG_CONTENT, token from its env), then
// replays a recorded OpenCode session through mocks/ so no provider is called.
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MOCK_AGENT = path.join(REPO, 'mocks/mock-agent.mjs');
const TRACE = '9a9522ec-575f-432f-aeed-efc491e900aa';
const RECORDING = path.join(REPO, 'mocks/recordings', `${TRACE}.jsonl`);
const USAGE = { requestId: '7d1f4a52-6c70-4a8e-9a43-1f0c8c3c2a10', model: 'openpixo-agent-flash', estimated: false,
  inputTokens: 4200, cachedInputTokens: 4000, outputTokens: 90, reasoningTokens: 20, costMicrocredits: 28_800, creditsCharged: 0 };

type Started = { url: string; server: Server; shutdown?: () => Promise<void> | void };
type Receipt = { args: string[]; token: string; configHasToken: boolean; status: number; text: string };
let started: Started | undefined;
let fixture: string | undefined;
let cloud: Awaited<ReturnType<typeof fakeSupabase>> | undefined;
const previous = { url: process.env.PIXO_CLOUD_URL, anon: process.env.PIXO_CLOUD_ANON_KEY };
afterEach(async () => {
  if (started?.server.listening) {
    const closed = new Promise<void>((resolve) => started!.server.close(() => resolve()));
    started.server.closeAllConnections();
    await closed;
  }
  await started?.shutdown?.();
  await cloud?.close();
  started = undefined; cloud = undefined;
  if (fixture) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
  for (const [key, value] of [['PIXO_CLOUD_URL', previous.url], ['PIXO_CLOUD_ANON_KEY', previous.anon]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

it.skipIf(process.platform !== 'win32' || !existsSync(RECORDING))('runs the bundled OpenCode on OpenPixo credits through the local gateway', async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'openpixo-agent-run-'));
  const receiptsPath = path.join(fixture, 'receipts.jsonl');
  const runner = path.join(fixture, 'opencode-fixture.cjs');
  await writeFile(runner, `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.18.35'); process.exit(0); }
if (args.includes('--help')) { console.log('opencode run [message..] --format --dir -m --auto'); process.exit(0); }
if (args[0] !== 'run') process.exit(0);
(async () => {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  const content = process.env.OPENCODE_CONFIG_CONTENT || '';
  const provider = JSON.parse(content).provider.openpixo;
  const token = process.env.${'PIXO_OPENPIXO_AGENT_TOKEN'} || '';
  const response = await fetch(provider.options.baseURL + '/chat/completions', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ model: Object.keys(provider.models)[0], stream: true, messages: [{ role: 'user', content: 'hi' }] }) });
  const text = await response.text();
  fs.appendFileSync(${JSON.stringify(receiptsPath)}, JSON.stringify({ args, token, configHasToken: content.includes(token), status: response.status, text }) + '\\n');
  if (!response.ok) { process.stderr.write('AI_APICallError: ' + text + '\\n'); process.exit(1); }
  const replay = spawn(process.execPath, [${JSON.stringify(MOCK_AGENT)}, '--as', 'opencode'], {
    env: { ...process.env, PIXO_MOCKS_TRACE: '${TRACE}', PIXO_MOCKS_NO_DELAY: '1' }, stdio: ['pipe', 'inherit', 'ignore'] });
  replay.stdin.end(prompt);
  replay.on('close', (code) => process.exit(code ?? 1));
})().catch((error) => { process.stderr.write(String(error) + '\\n'); process.exit(1); });
`, 'utf8');
  const executable = path.join(fixture, 'opencode-fixture.cmd');
  await writeFile(executable, `@echo off\r\n"${process.execPath}" "${runner}" %*\r\n`);
  await chmod(runner, 0o755);

  cloud = await fakeSupabase();
  let reply: () => { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> } = () => ({
    raw: `data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n: openpixo-usage ${JSON.stringify(USAGE)}\n\n`,
    headers: { 'Content-Type': 'text/event-stream' },
  });
  cloud.handlers.set('POST /functions/v1/agent-chat/chat/completions', () => reply());
  process.env.PIXO_CLOUD_URL = cloud.url;
  process.env.PIXO_CLOUD_ANON_KEY = ANON;
  started = await startServer({ port: 0, returnServer: true }) as Started;
  const post = (route: string, body: unknown, method = 'POST') => fetch(`${started!.url}${route}`,
    { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post('/api/app-config', { agentId: 'openpixo-agent', agentCliEnv: { opencode: { OPENCODE_BIN: executable } },
    telemetry: { metrics: false }, privacyDecisionAt: Date.now() }, 'PUT')).status).toBe(200);
  const projectId = `credits_${randomUUID()}`;
  const created = await post('/api/projects', { id: projectId, name: 'Credits agent', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true });
  const { conversationId } = await created.json() as { conversationId: string };
  const receipts = async (): Promise<Receipt[]> => {
    try { return (await readFile(receiptsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Receipt); }
    catch { return []; }
  };
  async function run(expected: 'succeeded' | 'failed') {
    const response = await post('/api/runs', { projectId, conversationId, agentId: 'openpixo-agent', model: 'openpixo-agent-flash',
      message: 'Make the slime jump.', currentPrompt: 'Make the slime jump.', assistantMessageId: randomUUID(), clientRequestId: randomUUID() });
    expect(response.status).toBe(202);
    const { runId } = await response.json() as { runId: string };
    let state: Record<string, unknown> = {};
    await expect.poll(async () => {
      state = await (await fetch(`${started!.url}/api/runs/${runId}`)).json() as Record<string, unknown>;
      return state.status;
    }, { timeout: 30_000 }).toBe(expected);
    const events = await (await fetch(`${started!.url}/api/runs/${runId}/events`)).text();
    const stored = await readFile(path.join(process.env.PIXO_DATA_DIR!, 'runs', runId, 'state.json'), 'utf8');
    return { runId, state, events, stored };
  }

  // Signed out: refused before anything spawns.
  const signedOut = await run('failed');
  expect(signedOut.state.errorCode).toBe('AGENT_AUTH_REQUIRED');
  expect(await receipts()).toEqual([]);

  expect((await post('/api/openpixo/account/email/verify', { email: USER.email, code: '123456' })).status).toBe(200);
  const ok = await run('succeeded');
  const [receipt] = await receipts();
  expect(receipt).toMatchObject({ status: 200, configHasToken: false });
  expect(receipt!.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(receipt!.args).toEqual(expect.arrayContaining(['run', '--format', 'json', '-m', 'openpixo/openpixo-agent-flash']));
  expect(receipt!.args.join(' ')).not.toContain(receipt!.token);
  expect(receipt!.text).not.toContain('openpixo-usage');
  const sent = cloud.requests.find((request) => request.url.pathname === '/functions/v1/agent-chat/chat/completions')!;
  expect(sent.headers.authorization).toBe(`Bearer ${ACCESS}`);
  expect(sent.headers['x-openpixo-run']).toBe(ok.runId);
  expect(ok.events).toContain('"hosted_usage"');
  expect(ok.events + ok.stored).not.toContain(receipt!.token);
  expect(ok.events + ok.stored).not.toContain(ACCESS);
  const usage = await (await fetch(`${started.url}/api/openpixo/agent/runs/${ok.runId}/usage`)).json() as Record<string, any>;
  expect(usage.local).toMatchObject({ requests: 1, costMicrocredits: 28_800 });
  // The run's token was revoked when it finalized.
  const replayed = await fetch(`${started.url}/api/openpixo/agent/v1/chat/completions`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${receipt!.token}` }, body: '{}' });
  expect(replayed.status).toBe(401);

  reply = () => ({ status: 402, body: { error: { code: 'INSUFFICIENT_CREDITS', message: 'Not enough OpenPixo credits.' } } });
  const broke = await run('failed');
  expect((await receipts()).at(-1)).toMatchObject({ status: 402 });
  expect(broke.state.errorCode).toBe('INSUFFICIENT_CREDITS');
}, 90_000);
