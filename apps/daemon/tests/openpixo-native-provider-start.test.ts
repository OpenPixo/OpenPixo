import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

type Started = { url: string; server: Server; shutdown?: () => Promise<void> | void };
type Receipt = { args: string[]; home: string; hasProviderKey: boolean; hasAccountKey: boolean; electronNode: string; threadMethod: string; thread: Record<string, unknown>; turn: Record<string, unknown> };
let started: Started | undefined;
let fixture: string | undefined;
const previous = { transport: process.env.PIXO_CODEX_TRANSPORT };
afterEach(async () => {
  if (started?.server.listening) {
    const closed = new Promise<void>((resolve) => started!.server.close(() => resolve()));
    started.server.closeAllConnections();
    await closed;
  }
  await started?.shutdown?.();
  started = undefined;
  if (fixture) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
  for (const [key, value] of [ ['PIXO_CODEX_TRANSPORT', previous.transport]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

it('runs the production native-provider boundary without OpenCode, account substitution or cross-provider resume', async () => {
  process.env.PIXO_CODEX_TRANSPORT = 'app-server';
  fixture = await mkdtemp(path.join(os.tmpdir(), 'openpixo-provider-start-'));
  const receiptsPath = path.join(fixture, 'receipts.jsonl');
  const runner = path.join(fixture, 'native-fixture.cjs');
  const accountHome = path.join(fixture, 'user-codex-home');
  await mkdir(accountHome);
  const originalConfig = 'model = "user-default"\nservice_tier = "preserve-provider-test"\n';
  await writeFile(path.join(accountHome, 'config.toml'), originalConfig);
  await writeFile(path.join(accountHome, 'auth.json'), '{"access_token":"account-fixture-do-not-use"}');
  await writeFile(runner, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.160.0'); process.exit(0); }
if (args.includes('--help')) { console.log('Usage: codex app-server --json --sandbox --add-dir --model'); process.exit(0); }
if (args[0] !== 'app-server') process.exit(0);
let thread, threadMethod, id;
const send = frame => process.stdout.write(JSON.stringify(frame) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  if (frame.method === 'initialize') send({ id: frame.id, result: { userAgent: 'codex/0.160.0' } });
  else if (frame.method === 'thread/start' || frame.method === 'thread/resume') {
    thread = frame.params; threadMethod = frame.method;
    id = frame.params.threadId || 'provider-thread-' + crypto.randomUUID();
    send({ id: frame.id, result: { thread: { id, historyMode: 'paginated' } } });
  } else if (frame.method === 'thread/archive') send({ id: frame.id, result: {} });
  else if (frame.method === 'turn/start') {
    fs.appendFileSync(${JSON.stringify(receiptsPath)}, JSON.stringify({ args, home: process.env.CODEX_HOME, hasProviderKey: Boolean(process.env.OPENPIXO_CODEX_PROVIDER_KEY), hasAccountKey: Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY), electronNode: process.env.ELECTRON_RUN_AS_NODE, threadMethod, thread, turn: frame.params }) + '\\n');
    if (frame.params.input[0].text.includes('RAW_PROVIDER_FAILURE')) {
      process.stdout.write('401 invalid token ' + process.env.OPENPIXO_CODEX_PROVIDER_KEY + '\\n');
      setTimeout(() => process.exit(1), 30); return;
    }
    send({ id: frame.id, result: { turn: { id: 'provider-turn-1' } } });
    send({ method: 'item/completed', params: { threadId: id, item: { type: 'agentMessage', id: 'provider-message-1', text: 'Provider fixture completed.' } } });
    send({ method: 'turn/completed', params: { threadId: id, turn: { id: 'provider-turn-1', status: 'completed', items: [] } } });
  }
}).on('close', () => process.exit(0));
`, 'utf8');
  let executable = runner;
  if (process.platform === 'win32') {
    executable = path.join(fixture, 'codex-provider.cmd');
    await writeFile(executable, `@echo off\r\n"${process.execPath}" "${runner}" %*\r\n`);
  } else await chmod(runner, 0o755);
  started = await startServer({ port: 0, returnServer: true }) as Started;
  const post = (route: string, body: unknown, method = 'POST') => fetch(`${started!.url}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post('/api/app-config', { agentId: 'claude', agentCliEnv: { codex: { CODEX_BIN: executable, CODEX_HOME: accountHome, OPENAI_API_KEY: 'account-fixture-key', ELECTRON_RUN_AS_NODE: '1' } }, telemetry: { metrics: false, }, privacyDecisionAt: Date.now() }, 'PUT')).status).toBe(200);
  const projectId = `provider_${randomUUID()}`;
  const created = await post('/api/projects', { id: projectId, name: 'Native provider regression', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true });
  const { conversationId } = await created.json() as { conversationId: string };
  const deepSeek = { protocol: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'native-production-fixture-A', model: 'deepseek-flash' };
  const openRouter = { ...deepSeek, baseUrl: 'https://openrouter.ai/api/v1', model: 'organization/unknown-image-model' };
  async function receipts(): Promise<Receipt[]> {
    try { return (await readFile(receiptsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Receipt); }
    catch { return []; }
  }
  async function run(input: Record<string, unknown>, expected: 'succeeded' | 'failed' = 'succeeded') {
    const response = await post('/api/runs', { projectId, conversationId, message: 'Check this fixture.', currentPrompt: 'Check this fixture.', assistantMessageId: randomUUID(), clientRequestId: randomUUID(), ...input });
    expect(response.status).toBe(202);
    const { runId } = await response.json() as { runId: string };
    let state: Record<string, unknown> = {};
    await expect.poll(async () => { state = await (await fetch(`${started!.url}/api/runs/${runId}`)).json() as Record<string, unknown>; return state.status; }, { timeout: 15_000 }).toBe(expected);
    const events = await (await fetch(`${started!.url}/api/runs/${runId}/events`)).text();
    const storedMeta = await readFile(path.join(process.env.PIXO_DATA_DIR!, 'runs', runId, 'state.json'), 'utf8');
    expect(events + storedMeta).not.toContain(deepSeek.apiKey);
    return { runId, state, events };
  }
  const missing = await run({ agentId: 'codex', byokProvider: { ...deepSeek, apiKey: '' } }, 'failed');
  expect(missing.state.errorCode).toBe('AGENT_AUTH_REQUIRED');
  const images = await run({ agentId: 'codex', byokProvider: { ...deepSeek, model: 'deepseek-v4-pro' }, imagePaths: ['fixture-image.png'] }, 'failed');
  expect(images.state.errorCode).toBe('AGENT_CAPABILITY_UNSUPPORTED');
  expect(await receipts()).toEqual([]);
  expect((await post('/api/runs', { projectId, conversationId, message: 'fixture', agentId: 'claude', byokProvider: deepSeek })).status).toBe(400);

  // Omitted agent beats the saved non-Codex default; the exact snapshot is used.
  await run({ byokProvider: deepSeek });
  let captured = await receipts();
  const first = captured[0]!;
  expect(first.threadMethod).toBe('thread/start');
  expect(first.thread.modelProvider).toBe('openpixo_deepseek');
  expect(first.turn).toMatchObject({ model: 'deepseek-flash', summary: 'none' });
  expect(first.home).not.toBe(accountHome);
  expect(first.hasProviderKey).toBe(true);
  expect(first.hasAccountKey).toBe(false);
  expect(first.electronNode).toBe('1');
  expect(first.args.join(' ')).not.toContain(deepSeek.apiKey);
  expect(first.args.join(' ')).toContain('requires_openai_auth=false');
  expect(await readFile(path.join(accountHome, 'config.toml'), 'utf8')).toBe(originalConfig);

  const withoutSnapshot = await run({ agentId: 'codex', resumeContinuation: true }, 'failed');
  expect(withoutSnapshot.state.errorCode).toBe('BYOK_PROVIDER_REQUIRED');
  expect((await receipts()).length).toBe(1);
  // A failed missing-snapshot assistant message can invalidate the cursor; a
  // fresh complete request re-establishes this provider's ordinary resume row.
  await run({ agentId: 'byok-opencode', byokProvider: deepSeek });
  await run({ agentId: 'codex', byokProvider: deepSeek, resumeContinuation: true });
  captured = await receipts();
  const resumed = captured.at(-1)!;
  expect(resumed.threadMethod).toBe('thread/resume');
  expect(resumed.thread.modelProvider).toBe('openpixo_deepseek');
  expect(resumed.home).toBe(first.home);
  await run({ agentId: 'byok-opencode', byokProvider: openRouter, model: openRouter.model });
  captured = await receipts();
  const switched = captured.at(-1)!;
  expect(switched.threadMethod).toBe('thread/start');
  expect(switched.thread.modelProvider).toBe('openpixo_openrouter');
  expect(switched.turn.model).toBe(openRouter.model);
  expect(switched.home).not.toBe(first.home);
  expect(switched.args.join(' ')).toContain('auth={command=');
  expect(switched.args.join(' ')).not.toContain('env_key=');
  expect(switched.hasAccountKey).toBe(false);

  const longModel = `organization/${'long-model-'.repeat(24)}`;
  await run({ agentId: 'codex', byokProvider: openRouter, model: longModel, serviceTier: 'priority' });
  expect((await receipts()).at(-1)!.turn.model).toBe(longModel);
  await run({ agentId: 'codex', byokProvider: deepSeek, message: 'RAW_PROVIDER_FAILURE', currentPrompt: 'RAW_PROVIDER_FAILURE' }, 'failed');
  const beforeDefault = (await receipts()).length;
  await run({ agentId: 'codex', model: 'account-fixture-model' });
  const account = (await receipts()).at(-1)!;
  expect((await receipts()).length).toBe(beforeDefault + 1);
  expect(account.home).toBe(accountHome);
  expect(account.hasProviderKey).toBe(false);
  expect(account.thread).not.toHaveProperty('modelProvider');
  expect(account.turn.summary).toBe('detailed');
}, 90_000);
