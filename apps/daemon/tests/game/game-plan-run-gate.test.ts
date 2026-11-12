import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { GAME_EXPERIENCE_BLOCK_HEADING, GAME_PLAN_BLOCK_HEADING, GAME_SHAPE_BLOCK_HEADING } from '@openpixo/contracts';
import { startServer } from '../../src/server.js';

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

it('runs a planning turn read-only with no approvals, then the first turn after approval can write', async () => {
  process.env.PIXO_CODEX_TRANSPORT = 'app-server';
  fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'openpixo-plan-gate-'));
  const receipts = path.join(fixtureDir, 'receipts.jsonl');
  const runner = path.join(fixtureDir, 'fake-codex.cjs');
  await writeFile(runner, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.160.0'); process.exit(0); }
if (args.includes('--help')) { console.log('Usage: codex app-server --json --sandbox --add-dir --model'); process.exit(0); }
if (args[0] !== 'app-server') process.exit(0);
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
let thread = null;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const frame = JSON.parse(line);
  if (frame.method === 'initialize') send({ id: frame.id, result: { userAgent: 'codex/0.160.0' } });
  else if (frame.method === 'thread/start' || frame.method === 'thread/resume') {
    thread = { method: frame.method, sandbox: frame.params.sandbox, approvalPolicy: frame.params.approvalPolicy };
    send({ id: frame.id, result: { thread: { id: 'plan-thread-1', historyMode: 'paginated' } } });
  }
  else if (frame.method === 'thread/archive') send({ id: frame.id, result: {} });
  else if (frame.method === 'turn/start') {
    fs.appendFileSync(${JSON.stringify(receipts)}, JSON.stringify({ thread, prompt: frame.params.input[0].text }) + '\\n');
    send({ id: frame.id, result: { turn: { id: 'plan-turn-1' } } });
    send({ method: 'item/completed', params: { threadId: 'plan-thread-1', item: { type: 'agentMessage', id: 'message-1', text: 'Done.' } } });
    send({ method: 'turn/completed', params: { threadId: 'plan-thread-1', turn: { id: 'plan-turn-1', status: 'completed', items: [] } } });
  }
}).on('close', () => process.exit(0));
`, 'utf8');
  let executable = runner;
  if (process.platform === 'win32') {
    executable = path.join(fixtureDir, 'codex-plan.cmd');
    await writeFile(executable, `@echo off\r\n"${process.execPath}" "${runner}" %*\r\n`);
  } else await chmod(runner, 0o755);

  started = await startServer({ port: 0, returnServer: true }) as StartedServer;
  const post = (route: string, body: unknown, method = 'POST') => fetch(`${started!.url}${route}`, {
    method, headers: { 'content-type': 'application/json', Origin: started!.url }, body: JSON.stringify(body),
  });
  expect((await post('/api/app-config', {
    agentId: 'codex', agentCliEnv: { codex: { CODEX_BIN: executable, CODEX_HOME: fixtureDir } },
    telemetry: { metrics: false }, privacyDecisionAt: Date.now(), gameExperience: 'first',
  }, 'PUT')).status).toBe(200);
  const projectId = `plan_${randomUUID()}`;
  const created = await post('/api/projects', { id: projectId, name: 'Rage game', metadata: { kind: 'other' } });
  expect(created.status).toBe(200);
  const { conversationId } = await created.json() as { conversationId: string };

  async function runTurn(message: string): Promise<{ thread: { sandbox: string; approvalPolicy: string }; prompt: string }> {
    const response = await post('/api/runs', {
      projectId, conversationId, agentId: 'codex', message, currentPrompt: message,
      assistantMessageId: randomUUID(), clientRequestId: randomUUID(),
    });
    expect(response.status).toBe(202);
    const { runId } = await response.json() as { runId: string };
    await expect.poll(async () => ((await (await fetch(`${started!.url}/api/runs/${runId}`)).json()) as { status: string }).status, { timeout: 20_000 }).toBe('succeeded');
    const lines = (await readFile(receipts, 'utf8')).trim().split('\n');
    return JSON.parse(lines.at(-1)!);
  }

  const planning = await runTurn('I want to create a rage troll 2d sidescroll game with 5 levels');
  expect(planning.thread).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'never' });
  expect(planning.prompt).toContain(GAME_PLAN_BLOCK_HEADING);
  expect(planning.prompt).toContain('**Gameplay');
  expect(planning.prompt).toContain('phaser3-vite');
  expect(planning.prompt).toContain(GAME_SHAPE_BLOCK_HEADING);
  // The app config's experience reaches the prompt, and every turn restates the step rule.
  expect(planning.prompt).toContain(GAME_EXPERIENCE_BLOCK_HEADING);
  expect(planning.prompt).toContain('New game, planning:');

  expect((await post(`/api/projects/${projectId}/game-plan/approve`, {})).status).toBe(200);

  const building = await runTurn('The plan is approved. Start building it.');
  // A fresh thread, so no runtime can carry the read-only sandbox past approval.
  expect(building.thread).toMatchObject({ method: 'thread/start', sandbox: 'workspace-write', approvalPolicy: 'on-request' });
  expect(building.prompt).toContain('approved this game');
  expect(building.prompt).not.toContain('**Gameplay');
  expect(building.prompt).toContain('New game, building:');
  expect(building.prompt).toMatch(/Build only the current stage/);
}, 60_000);
