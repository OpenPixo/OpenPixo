// B11 「引导对话」 — POST /api/runs/:id/steer at the daemon HTTP boundary.
//
// Steering is the opposite of stop-and-send: the turn keeps running and the
// message is added to it, so the model reads it without losing the work it has
// already done. Codex over app-server does this through `turn/steer`.
//
// This spec drives the real thing end to end — a fake `codex app-server` that
// parks mid-turn, receives the `turn/steer` request and records what it was
// given. Nothing here inspects daemon internals: the proof that the message
// reached the agent is a file the CHILD wrote.
//
// Covered:
//   - steering a live Codex turn, and the message landing in the conversation
//     so a reload still shows what the user said;
//   - refusal once the turn ended (no silent drop);
//   - refusal on Claude Code, whose stdin stays open but which does not act on
//     a message written mid-turn (fake `claude`), with nothing recorded;
//   - refusal of an empty message and of an unknown run;
//   - a stop that delivers a queued message is recorded as `queued_send`, not
//     as a plain Stop.

import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RunStatus = {
  id: string;
  status: string;
  exitCode: number | null;
  cancelOrigin?: string | null;
};

const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

describe('POST /api/runs/:id/steer', () => {
  const originalEnv = {
    PIXO_USAGE_EVENTS_URL: process.env.PIXO_USAGE_EVENTS_URL,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    PIXO_TELEMETRY_RELAY_URL: process.env.PIXO_TELEMETRY_RELAY_URL,
    PIXO_CODEX_TRANSPORT: process.env.PIXO_CODEX_TRANSPORT,
  };
  let started: StartedServer | null = null;
  let binDir: string | null = null;

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      const listener = started.server;
      await new Promise<void>((resolve) => {
        listener.close(() => resolve());
        listener.closeAllConnections?.();
      });
    }
    started = null;
    if (binDir) await rm(binDir, { recursive: true, force: true });
    binDir = null;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('steers a running Codex turn through turn/steer and keeps it in history', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'pixo-b11-steer-codex-'));
    const readyPath = path.join(binDir, 'ready');
    const sinkPath = path.join(binDir, 'steered.txt');
    const bin = await writeSteerableCodex(binDir, readyPath, sinkPath);

    clearTelemetryEnv();
    process.env.PIXO_CODEX_TRANSPORT = 'app-server';
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, 'codex', { CODEX_BIN: bin, CODEX_HOME: binDir });

    const project = await createProject(started.url);
    const runId = await startRun(started.url, project, 'draft the pricing page', 'codex');

    // The fake started its turn and is waiting: the turn is live.
    await waitForFile(readyPath, 15_000);

    const steerText = 'actually make the hero copy shorter';
    const steer = await postSteer(started.url, runId, steerText);
    expect(steer.status).toBe(200);
    const steerBody = await steer.json() as {
      ok: boolean;
      delivered: boolean;
      messageId: string;
      run: RunStatus;
    };
    expect(steerBody.ok).toBe(true);
    expect(steerBody.delivered).toBe(true);
    expect(typeof steerBody.messageId).toBe('string');
    // The turn must NOT have been stopped to deliver the message.
    expect(TERMINAL.has(steerBody.run.status)).toBe(false);

    // The load-bearing assertion: the CHILD PROCESS wrote this file, so the
    // message really reached codex rather than being swallowed by the daemon.
    await waitForFile(sinkPath, 10_000);
    expect(JSON.parse(await readFile(sinkPath, 'utf8'))).toEqual({
      threadId: 'steer-thread-1',
      expectedTurnId: 'steer-turn-1',
      input: [{ type: 'text', text: steerText, text_elements: [] }],
    });
    // Steering never interrupts the turn.
    expect(existsSync(path.join(binDir, 'interrupted'))).toBe(false);

    const finished = await waitForTerminal(started.url, runId);
    expect(finished.status).toBe('succeeded');

    // Persisted as a user turn: a reload must still show what the user said
    // mid-turn, and the next turn's transcript must carry the instruction.
    const messages = await listMessages(started.url, project);
    const steered = messages.find((message) => message.content === steerText);
    expect(steered).toBeTruthy();
    expect(steered?.role).toBe('user');
    expect(steered?.id).toBe(steerBody.messageId);

    // Once the turn ended, a second steer is refused with a readable code.
    const late = await postSteer(started.url, runId, 'too late');
    expect(late.status).toBe(409);
    const lateBody = await late.json() as { error: { code: string } };
    expect(lateBody.error.code).toBe('RUN_STEERING_CLOSED');

    // …and the refused message must not have been written to history.
    const afterRefusal = await listMessages(started.url, project);
    expect(afterRefusal.some((message) => message.content === 'too late')).toBe(false);
  }, 60_000);

  it('refuses Claude Code: its stdin stays open, but a mid-turn message is not acted on', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'pixo-b11-steer-claude-'));
    const readyPath = path.join(binDir, 'ready');
    const sinkPath = path.join(binDir, 'steered.txt');
    const bin = await writeParkedClaude(binDir, readyPath, sinkPath);

    clearTelemetryEnv();
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, 'claude', { CLAUDE_BIN: bin });

    const project = await createProject(started.url);
    const runId = await startRun(started.url, project, 'anything', 'claude');
    await waitForFile(readyPath, 15_000);

    const steer = await postSteer(started.url, runId, 'steer me');
    expect(steer.status).toBe(409);
    const body = await steer.json() as { error: { code: string } };
    // A permanent property of the runtime, not a transient state — the caller
    // is meant to offer stop-and-send instead, not retry.
    expect(body.error.code).toBe('RUN_STEERING_UNSUPPORTED');

    // Nothing reached the child and nothing was written to the conversation.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(existsSync(sinkPath)).toBe(false);
    const messages = await listMessages(started.url, project);
    expect(messages.some((message) => message.content === 'steer me')).toBe(false);

    await fetch(`${started.url}/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
  }, 60_000);

  it('rejects an unknown run and an empty message', async () => {
    clearTelemetryEnv();
    process.env.PIXO_CODEX_TRANSPORT = 'app-server';
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;

    const missing = await postSteer(started.url, 'no-such-run', 'hello');
    expect(missing.status).toBe(404);

    binDir = await mkdtemp(path.join(os.tmpdir(), 'pixo-b11-steer-empty-'));
    const readyPath = path.join(binDir, 'ready');
    const bin = await writeSteerableCodex(binDir, readyPath, path.join(binDir, 'steered.txt'));
    await putConfig(started.url, 'codex', { CODEX_BIN: bin, CODEX_HOME: binDir });
    const project = await createProject(started.url);
    const runId = await startRun(started.url, project, 'draft something', 'codex');
    await waitForFile(readyPath, 15_000);

    const empty = await postSteer(started.url, runId, '   ');
    expect(empty.status).toBe(400);
    const emptyBody = await empty.json() as { error: { code: string } };
    expect(emptyBody.error.code).toBe('BAD_REQUEST');

    await fetch(`${started.url}/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
  }, 60_000);

  it('records a stop that sends a queued message as queued_send, not as a plain Stop', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'pixo-b11-queued-stop-'));
    const readyPath = path.join(binDir, 'ready');
    const bin = await writeSteerableCodex(binDir, readyPath, path.join(binDir, 'steered.txt'));

    clearTelemetryEnv();
    process.env.PIXO_CODEX_TRANSPORT = 'app-server';
    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, 'codex', { CODEX_BIN: bin, CODEX_HOME: binDir });
    const project = await createProject(started.url);
    const runId = await startRun(started.url, project, 'draft something', 'codex');
    await waitForFile(readyPath, 15_000);

    const cancel = await fetch(`${started.url}/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'queued_send' }),
    });
    expect(cancel.status).toBe(200);
    const body = await cancel.json() as { run: RunStatus };
    expect(body.run.cancelOrigin).toBe('queued_send');
    const finished = await waitForTerminal(started.url, runId);
    expect(finished.status).toBe('canceled');
    expect(finished.cancelOrigin).toBe('queued_send');
  }, 60_000);
});

function clearTelemetryEnv(): void {
  delete process.env.PIXO_USAGE_EVENTS_URL;
  delete process.env.POSTHOG_HOST;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_BASE_URL;
  delete process.env.PIXO_TELEMETRY_RELAY_URL;
}

/** A node script as an executable the daemon can spawn on every platform. */
async function executable(dir: string, name: string, source: string): Promise<string> {
  const script = path.join(dir, `${name}.cjs`);
  await writeFile(script, source, 'utf8');
  if (process.platform === 'win32') {
    const cmd = path.join(dir, `${name}.cmd`);
    await writeFile(cmd, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return cmd;
  }
  await chmod(script, 0o755);
  return script;
}

/**
 * A `codex app-server` stand-in. It starts the turn and waits. A `turn/steer`
 * is recorded to `sinkPath`, accepted, and the turn then finishes with an
 * answer. A `turn/interrupt` ends the turn as interrupted.
 */
async function writeSteerableCodex(dir: string, readyPath: string, sinkPath: string): Promise<string> {
  return executable(dir, 'codex-steerable', `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.160.0'); process.exit(0); }
if (args.includes('--help')) { console.log('Usage: codex app-server --json --sandbox --add-dir --model'); process.exit(0); }
if (args.includes('login')) { console.log('Logged in'); process.exit(0); }
if (args[0] !== 'app-server') process.exit(0);
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
const THREAD = 'steer-thread-1';
const TURN = 'steer-turn-1';
const finish = (status) => {
  if (status === 'completed') {
    send({ method: 'item/completed', params: { threadId: THREAD, item: { type: 'agentMessage', id: 'message-1', text: 'Shorter hero copy, done.' } } });
  }
  send({ method: 'turn/completed', params: { threadId: THREAD, turn: { id: TURN, status, items: [] } } });
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const frame = JSON.parse(line);
  if (frame.method === 'initialize') send({ id: frame.id, result: { userAgent: 'codex/0.160.0' } });
  else if (frame.method === 'thread/start' || frame.method === 'thread/resume') {
    send({ id: frame.id, result: { thread: { id: THREAD, historyMode: 'paginated' } } });
  }
  else if (frame.method === 'thread/archive') send({ id: frame.id, result: {} });
  else if (frame.method === 'turn/start') {
    send({ id: frame.id, result: { turn: { id: TURN } } });
    send({ method: 'turn/started', params: { threadId: THREAD, turn: { id: TURN } } });
    fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');
  }
  else if (frame.method === 'turn/steer') {
    fs.writeFileSync(${JSON.stringify(sinkPath)}, JSON.stringify(frame.params));
    send({ id: frame.id, result: { turnId: TURN } });
    finish('completed');
  }
  else if (frame.method === 'turn/interrupt') {
    fs.writeFileSync(path.join(${JSON.stringify(dir)}, 'interrupted'), 'yes');
    send({ id: frame.id, result: {} });
    finish('interrupted');
  }
  else if (typeof frame.id === 'number' && typeof frame.method === 'string') {
    send({ id: frame.id, result: {} });
  }
}).on('close', () => process.exit(0));
setTimeout(() => process.exit(0), 50000);
`);
}

/**
 * A `claude` stand-in parked on a `tool_use` frame, the moment its stdin is
 * open. It records any frame after the opening prompt to `sinkPath`.
 */
async function writeParkedClaude(dir: string, readyPath: string, sinkPath: string): Promise<string> {
  return executable(dir, 'claude-parked', `#!/usr/bin/env node
const fs = require('node:fs');
function w(s) { fs.writeSync(1, s); }
if (process.argv.includes('--version')) { w('claude-code 1.0.0-b11-steer\\n'); process.exit(0); }
if (process.argv.includes('--help')) { w('Usage: claude -p [--include-partial-messages] [--add-dir DIR]\\n'); process.exit(0); }
w(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-b11-steer', session_id: 's-b11' }) + '\\n');
w(JSON.stringify({
  type: 'assistant',
  parent_tool_use_id: null,
  message: {
    id: 'msg-main',
    content: [{ type: 'tool_use', id: 'tu_work', name: 'Task', input: { prompt: 'work' } }],
    stop_reason: 'tool_use',
  },
}) + '\\n');
let buffer = '';
let framesSeen = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    framesSeen += 1;
    if (framesSeen === 1) { fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready'); continue; }
    fs.writeFileSync(${JSON.stringify(sinkPath)}, line);
  }
});
setTimeout(() => process.exit(0), 50000);
`);
}

async function putConfig(url: string, agentId: 'claude' | 'codex', agentEnv: Record<string, string>): Promise<void> {
  const response = await fetch(`${url}/api/app-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId,
      agentCliEnv: { [agentId]: agentEnv },
      telemetry: { metrics: true, },
      privacyDecisionAt: Date.now(),
    }),
  });
  expect(response.status).toBe(200);
}

async function createProject(url: string): Promise<{ projectId: string; conversationId: string }> {
  const projectId = `b11_steer_${randomUUID()}`;
  const response = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: 'B11 steer the running turn',
      metadata: { kind: 'prototype' },
      skipDiscoveryBrief: true,
    }),
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { conversationId: string };
  return { projectId, conversationId: body.conversationId };
}

async function startRun(
  url: string,
  project: { projectId: string; conversationId: string },
  message: string,
  agentId: 'claude' | 'codex',
): Promise<string> {
  const response = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pixo-analytics-device-id': 'b11-steer-test',
      'x-pixo-analytics-session-id': 'b11-steer-session',
      'x-pixo-analytics-client-type': 'web',
    },
    body: JSON.stringify({
      projectId: project.projectId,
      conversationId: project.conversationId,
      assistantMessageId: `assistant_b11_${randomUUID()}`,
      clientRequestId: `client_b11_${randomUUID()}`,
      agentId,
      message,
      currentPrompt: message,
    }),
  });
  expect(response.status).toBe(202);
  const body = await response.json() as { runId: string };
  return body.runId;
}

function postSteer(url: string, runId: string, text: string): Promise<Response> {
  return fetch(`${url}/api/runs/${encodeURIComponent(runId)}/steer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

async function waitForFile(target: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(target)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${target}`);
}

async function waitForTerminal(url: string, runId: string): Promise<RunStatus> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
    expect(response.status).toBe(200);
    const run = await response.json() as RunStatus;
    if (TERMINAL.has(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`run ${runId} did not finish`);
}

async function listMessages(
  url: string,
  project: { projectId: string; conversationId: string },
): Promise<{ id: string; role: string; content: string }[]> {
  const response = await fetch(
    `${url}/api/projects/${encodeURIComponent(project.projectId)}`
    + `/conversations/${encodeURIComponent(project.conversationId)}/messages`,
  );
  expect(response.status).toBe(200);
  const body = await response.json() as
    | { messages: { id: string; role: string; content: string }[] }
    | { id: string; role: string; content: string }[];
  return Array.isArray(body) ? body : body.messages;
}
