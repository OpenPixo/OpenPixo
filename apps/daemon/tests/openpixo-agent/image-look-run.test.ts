import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { OPENPIXO_AGENT_IMAGE_VIEWER_MODEL } from '@openpixo/contracts';
import { startServer } from '../../src/server.js';
import { ANON, fakeSupabase, USER } from '../account/fixtures.js';

// The real daemon starts a hosted run with a fixture "opencode" that records what the daemon
// gave it (the OpenCode config and the prompt) and calls `pixo look`'s endpoint with the run's
// tool token, as the CLI does. Nothing reaches a real model or a real agent CLI.
type Started = { url: string; server: Server; shutdown?: () => Promise<void> | void };
type Receipt = { input: string[]; promptLooks: boolean; lookStatus: number; look: Record<string, unknown> };
let started: Started | undefined;
let fixture: string | undefined;
let cloud: Awaited<ReturnType<typeof fakeSupabase>> | undefined;
const previous = { url: process.env.PIXO_CLOUD_URL, anon: process.env.PIXO_CLOUD_ANON_KEY };
const USAGE = { requestId: '5c6d7e8f-1a2b-4c3d-9e8f-0a1b2c3d4e5f', model: OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, estimated: false,
  inputTokens: 700, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0, costMicrocredits: 300_000, creditsCharged: 0 };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWMwTpsJAAICATMDms/iAAAAAElFTkSuQmCC';
const row = (id: string, inputModalities: string[]) => ({ id, label: id, priceVersion: 1, contextTokens: 200000, maxOutputTokens: 16384,
  creditsPerMillionTokens: { inputCacheMiss: 45, inputCacheHit: 0.9, output: 180 }, inputModalities });

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

it.skipIf(process.platform !== 'win32')('a hosted run sees no pictures, is taught pixo look, and its looks are billed to the run', async () => {
  for (const key of ['FAL_KEY', 'PIXO_FAL_KEY']) delete process.env[key];
  fixture = await mkdtemp(path.join(os.tmpdir(), 'openpixo-look-run-'));
  const receiptsPath = path.join(fixture, 'receipts.jsonl');
  const runner = path.join(fixture, 'opencode-fixture.cjs');
  await writeFile(runner, `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.18.35'); process.exit(0); }
if (args.includes('--help')) { console.log('opencode run [message..] --format --dir -m --auto'); process.exit(0); }
if (args[0] !== 'run') process.exit(0);
(async () => {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  const provider = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}').provider.openpixo;
  const model = provider.models[Object.keys(provider.models)[0]];
  fs.writeFileSync('shot.png', Buffer.from(${JSON.stringify(PNG)}, 'base64'));
  const response = await fetch(process.env.PIXO_DAEMON_URL + '/api/tools/look', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.PIXO_TOOL_TOKEN },
    body: JSON.stringify({ path: require('node:path').resolve('shot.png'), question: 'Is the pixel dark?' }) });
  fs.appendFileSync(${JSON.stringify(receiptsPath)}, JSON.stringify({ input: model.modalities.input,
    promptLooks: prompt.includes('"$PIXO_BIN" look <path>'), lookStatus: response.status, look: await response.json() }) + '\\n');
  process.exit(1);
})().catch((error) => { process.stderr.write(String(error) + '\\n'); process.exit(1); });
`, 'utf8');
  const executable = path.join(fixture, 'opencode-fixture.cmd');
  await writeFile(executable, `@echo off\r\n"${process.execPath}" "${runner}" %*\r\n`);
  await chmod(runner, 0o755);

  cloud = await fakeSupabase();
  cloud.handlers.set('GET /functions/v1/agent-chat/models', () => ({ body: {
    models: [row('openpixo-agent-flash', ['text', 'image']), row(OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, ['text', 'image'])],
    limits: { maxConcurrent: 4, requestsPerMinute: 60, maxRequestBytes: 4000000 }, agentPaused: false } }));
  cloud.handlers.set('POST /functions/v1/agent-chat/chat/completions', () => ({
    body: { choices: [{ index: 0, message: { role: 'assistant', content: 'Yes, it is dark blue.' }, finish_reason: 'stop' }] },
    headers: { 'x-openpixo-usage': JSON.stringify(USAGE) } }));
  process.env.PIXO_CLOUD_URL = cloud.url;
  process.env.PIXO_CLOUD_ANON_KEY = ANON;
  started = await startServer({ port: 0, returnServer: true }) as Started;
  const post = (route: string, body: unknown, method = 'POST') => fetch(`${started!.url}${route}`,
    { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post('/api/app-config', { agentId: 'openpixo-agent', agentCliEnv: { opencode: { OPENCODE_BIN: executable } },
    telemetry: { metrics: false }, privacyDecisionAt: Date.now() }, 'PUT')).status).toBe(200);
  expect((await post('/api/openpixo/account/email/verify', { email: USER.email, code: '123456' })).status).toBe(200);
  const projectId = `look_${randomUUID()}`;
  const created = await post('/api/projects', { id: projectId, name: 'Look', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true });
  const { conversationId } = await created.json() as { conversationId: string };
  const response = await post('/api/runs', { projectId, conversationId, agentId: 'openpixo-agent', model: 'openpixo-agent-flash',
    message: 'Check the screen.', currentPrompt: 'Check the screen.', assistantMessageId: randomUUID(), clientRequestId: randomUUID() });
  expect(response.status).toBe(202);
  const { runId } = await response.json() as { runId: string };
  await expect.poll(async () => ((await (await fetch(`${started!.url}/api/runs/${runId}`)).json()) as { status: string }).status,
    { timeout: 30_000 }).toMatch(/^(failed|succeeded|canceled)$/u);

  const [receipt] = (await readFile(receiptsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Receipt);
  expect(receipt).toMatchObject({ input: ['text'], promptLooks: true, lookStatus: 200,
    look: { answer: 'Yes, it is dark blue.', model: OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, costMicrocredits: 300_000 } });
  const sent = cloud.requests.find((request) => request.url.pathname === '/functions/v1/agent-chat/chat/completions')!;
  expect(sent.headers['x-openpixo-run']).toBe(runId);
  expect(sent.body).toMatchObject({ model: OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, stream: false });
  const usage = await (await fetch(`${started.url}/api/openpixo/agent/runs/${runId}/usage`)).json() as Record<string, any>;
  expect(usage.local).toMatchObject({ requests: 1, costMicrocredits: 300_000 });
}, 90_000);
