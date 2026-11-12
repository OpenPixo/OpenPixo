import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { startServer } from '../src/server.js';
import { ANON, fakeSupabase, USER } from './account/fixtures.js';

// GPT-6 only reuses a cache when the new request starts with exactly what an earlier one sent.
// So what decides the bill is whether the first request of turn 2 opens with the last request of
// turn 1, byte for byte. That is a fact about the real daemon and the real OpenCode together, so
// this runs both: only the cloud is fake, and no model can be reached.
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function bundledOpenCode(): string | null {
  try {
    const pack = createRequire(path.join(REPO, 'tools/pack/package.json'));
    const manifest = pack.resolve('opencode-ai/package.json');
    const native = createRequire(manifest).resolve(`opencode-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}${process.arch === 'x64' ? '-baseline' : ''}/package.json`);
    const binary = path.join(path.dirname(native), 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
    return existsSync(binary) ? binary : null;
  } catch { return null; }
}

const OPENCODE = bundledOpenCode();
const USAGE = { requestId: '7d1f4a52-6c70-4a8e-9a43-1f0c8c3c2a10', model: 'openpixo-agent-gpt-6-luna', estimated: false,
  inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, reasoningTokens: 2, costMicrocredits: 100, creditsCharged: 0 };

function sse(...deltas: Array<{ delta: Record<string, unknown>; finish?: string }>): string {
  const frames = deltas.map(({ delta, finish }) => `data: ${JSON.stringify({ id: 'op-1', object: 'chat.completion.chunk', created: 1_793_000_000,
    model: 'openpixo-agent-gpt-6-luna', choices: [{ index: 0, delta, finish_reason: finish ?? null }] })}\n\n`);
  const usage = `data: ${JSON.stringify({ id: 'op-1', object: 'chat.completion.chunk', created: 1_793_000_000, model: 'openpixo-agent-gpt-6-luna', choices: [],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 100 } } })}\n\n`;
  return `${frames.join('')}${usage}data: [DONE]\n\n: openpixo-usage ${JSON.stringify(USAGE)}\n\n`;
}

// OpenCode gives GPT models apply_patch in place of write and edit.
/** Thinking and a tool call, then an answer: the shape where a real turn's history gets rewritten if anything does. */
const TOOL_TURN = sse({ delta: { role: 'assistant', content: '', reasoning_content: 'I should look.' } },
  { delta: { tool_calls: [{ index: 0, id: 'call_look', type: 'function', function: { name: 'glob', arguments: '{"pattern":"*.md"}' } }] } },
  { delta: {}, finish: 'tool_calls' });
const WRITE = (file: string) => sse({ delta: { role: 'assistant', content: '' } },
  { delta: { tool_calls: [{ index: 0, id: `call_${file}`, type: 'function', function: { name: 'apply_patch', arguments: JSON.stringify({ patchText: `*** Begin Patch
*** Add File: ${file}
+x
*** End Patch` }) } }] } },
  { delta: {}, finish: 'tool_calls' });
const ANSWER = (text: string) => sse({ delta: { role: 'assistant', content: '', reasoning_content: 'Done looking.' } }, { delta: { content: text } }, { delta: {}, finish: 'stop' });

type Wire = { messages: Array<Record<string, unknown>>; tools?: unknown; max_tokens?: number };
const opening = (shorter: Wire, longer: Wire): number => {
  let same = 0;
  while (same < shorter.messages.length && JSON.stringify(shorter.messages[same]) === JSON.stringify(longer.messages[same])) same += 1;
  return same;
};

let started: { url: string; server: Server; shutdown?: () => Promise<void> | void } | undefined;
let cloud: Awaited<ReturnType<typeof fakeSupabase>> | undefined;
let sandbox: string | undefined;
const ISOLATED = ['OPENCODE_PURE', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'OPENCODE_TEST_HOME', 'PIXO_CLOUD_URL', 'PIXO_CLOUD_ANON_KEY'] as const;
const previous = Object.fromEntries(ISOLATED.map((key) => [key, process.env[key]]));

afterEach(async () => {
  if (started?.server.listening) {
    const closed = new Promise<void>((resolve) => started!.server.close(() => resolve()));
    started.server.closeAllConnections();
    await closed;
  }
  await started?.shutdown?.();
  await cloud?.close();
  started = undefined; cloud = undefined;
  for (const key of ISOLATED) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
  if (sandbox) await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  sandbox = undefined;
});

it.skipIf(process.platform !== 'win32' || !OPENCODE)('opens turn 2 with exactly what turn 1 last sent, and pays for only the new words', async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), 'openpixo-prompt-cache-'));
  // OpenCode's own store and config, away from anything on this machine, and no way to a real model.
  for (const [key, leaf] of [['XDG_DATA_HOME', 'data'], ['XDG_CONFIG_HOME', 'config'], ['XDG_STATE_HOME', 'state'], ['XDG_CACHE_HOME', 'cache'], ['OPENCODE_TEST_HOME', 'home']] as const) {
    process.env[key] = path.join(sandbox, leaf);
  }
  // No tool-preview plugin: on an empty cache OpenCode's npm setup for it takes over a minute, and a
  // plugin has no say in the request. Measured with the plugin too; the requests are the same.
  process.env.OPENCODE_PURE = '1';
  cloud = await fakeSupabase();
  const script = [TOOL_TURN, ANSWER('first answer'), ANSWER('second answer'), WRITE('blocked.md'), ANSWER('plan'), WRITE('allowed.md'), ANSWER('built')];
  const bodies: Wire[] = [];
  cloud.handlers.set('POST /functions/v1/agent-chat/chat/completions', (request) => {
    bodies.push(request.body as unknown as Wire);
    return { raw: script[bodies.length - 1] ?? ANSWER('extra'), headers: { 'Content-Type': 'text/event-stream' } };
  });
  process.env.PIXO_CLOUD_URL = cloud.url;
  process.env.PIXO_CLOUD_ANON_KEY = ANON;
  started = await startServer({ port: 0, returnServer: true }) as NonNullable<typeof started>;
  const post = (route: string, body: unknown, method = 'POST') => fetch(`${started!.url}${route}`,
    { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post('/api/app-config', { agentId: 'openpixo-agent', agentCliEnv: { opencode: { OPENCODE_BIN: OPENCODE! } },
    telemetry: { metrics: false }, privacyDecisionAt: Date.now() }, 'PUT')).status).toBe(200);
  expect((await post('/api/openpixo/account/email/verify', { email: USER.email, code: '123456' })).status).toBe(200);
  const projectId = `cache_${randomUUID()}`;
  const created = await post('/api/projects', { id: projectId, name: 'Prompt cache', metadata: { kind: 'prototype' }, skipDiscoveryBrief: true });
  const { conversationId } = await created.json() as { conversationId: string };

  const projectDir = path.join(process.env.PIXO_DATA_DIR!, 'projects', projectId);
  async function turn(words: string, transcript: string, sessionMode?: 'plan' | 'design') {
    const response = await post('/api/runs', { projectId, conversationId, agentId: 'openpixo-agent', model: 'openpixo-agent-gpt-6-luna',
      message: transcript, currentPrompt: words, assistantMessageId: randomUUID(), clientRequestId: randomUUID(), ...(sessionMode ? { sessionMode } : {}) });
    expect(response.status).toBe(202);
    const { runId } = await response.json() as { runId: string };
    let status = '';
    await expect.poll(async () => {
      status = (await (await fetch(`${started!.url}/api/runs/${runId}`)).json() as { status: string }).status;
      return ['succeeded', 'failed', 'canceled'].includes(status);
    }, { timeout: 60_000, interval: 200 }).toBe(true);
    expect(status).toBe('succeeded');
  }
  const toolNames = (body: Wire) => (body.tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name);

  await turn('Say hello.', '## user\nSay hello.');
  expect(bodies.length).toBe(2);
  // The real OpenCode asks for the whole output limit. It could cap this itself, and the gateway's
  // own cap only matters if the agent asks for that much.
  expect(bodies[0]!.max_tokens).toBe(32_000);
  await turn('Now say goodbye.', '## user\nSay hello.\n\n## assistant\nfirst answer\n\n## user\nNow say goodbye.');
  expect(bodies.length).toBe(3);

  const last = bodies[1]!;
  const next = bodies[2]!;
  expect(JSON.stringify(next.tools)).toBe(JSON.stringify(last.tools));
  expect(opening(last, next)).toBe(last.messages.length);
  // Turn 2 adds the last answer and the new words, and nothing it already sent.
  const added = JSON.stringify(next.messages.slice(last.messages.length));
  expect(added).toContain('Now say goodbye.');
  expect(added).not.toContain('OpenPixo game development workbench');
  expect(added).toContain('Turn completion marker');
  expect(added).not.toContain('Say hello.');
  expect(added).not.toContain('## assistant');

  // A resumed session must not carry permissions across turns. Plan mode stays read-only on a
  // session that could write a moment ago, and a later approved turn can write again.
  await turn('Plan it.', '## user\nPlan it.', 'plan');
  expect(toolNames(bodies[3]!)).not.toContain('apply_patch');
  expect(existsSync(path.join(projectDir, 'blocked.md'))).toBe(false);
  await turn('Build it.', '## user\nBuild it.', 'design');
  expect(toolNames(bodies[5]!)).toContain('apply_patch');
  expect(existsSync(path.join(projectDir, 'allowed.md'))).toBe(true);

  // OpenCode's store is gone: the turn still succeeds, on a new session told everything again.
  const store = path.join(sandbox, 'data', 'opencode');
  await rm(store, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  const before = bodies.length;
  await turn('After the store is gone.', '## user\nBuild it.\n\n## assistant\nbuilt\n\n## user\nAfter the store is gone.', 'design');
  const reseeded = bodies[before]!;
  expect(reseeded.messages.length).toBe(2);
  expect(JSON.stringify(reseeded.messages[1])).toContain('OpenPixo game development workbench');
  expect(JSON.stringify(reseeded.messages[1])).toContain('## assistant');
}, 240_000);
