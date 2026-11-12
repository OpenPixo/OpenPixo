import express from 'express';
import sharp from 'sharp';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { OpenPixoAgentUsageEvent } from '@openpixo/contracts';
import { OpenPixoAgentGateway, OPENPIXO_AGENT_PROXY_PATH, OPENPIXO_AGENT_TOKEN_ENV } from '../../src/openpixo-agent/gateway.js';
import { agentModels, agentRequestUsage } from '../../src/account/agent-gateway.js';
import { buildOpenPixoAgentOpenCodeConfig, fetchOpenPixoAgentModels, openpixoAgentContextLimits, openpixoAgentEffort, openpixoAgentModelArg, setOpenPixoAgentCatalogReader } from '../../src/openpixo-agent/runtime.js';
import { openpixoAgentDef } from '../../src/runtimes/defs/openpixo-agent.js';
import { registerOpenPixoAgentProxy, registerOpenPixoAgentRoutes } from '../../src/routes/openpixo-agent.js';
import { ACCESS, accountHarness } from './fixtures.js';

const RUN = 'run-agent-0001';
const MODELS = {
  models: [{ id: 'openpixo-agent-flash', label: 'OpenPixo Agent', vendor: 'deepseek', priceVersion: 1,
    creditsPerMillionTokens: { inputCacheMiss: 45, inputCacheHit: 0.9, output: 180 }, contextTokens: 200000, maxOutputTokens: 16384 }],
  limits: { maxConcurrent: 4, requestsPerMinute: 60, maxRequestBytes: 2000000 },
  agentPaused: false,
};
const USAGE = { requestId: '7d1f4a52-6c70-4a8e-9a43-1f0c8c3c2a10', model: 'openpixo-agent-flash', estimated: false,
  inputTokens: 1200, cachedInputTokens: 1000, outputTokens: 40, reasoningTokens: 10, costMicrocredits: 17_100, creditsCharged: 0 };
const VENDOR_STREAM = 'data: {"choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
const CHAT_ROUTE = 'POST /functions/v1/agent-chat/chat/completions';

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const step of cleanup.reverse()) await step(); cleanup = []; });

async function setup() {
  const harness = await accountHarness();
  cleanup.push(harness.close);
  const gateway = new OpenPixoAgentGateway(harness.account);
  const app = express();
  registerOpenPixoAgentProxy(app, { gateway });
  app.use(express.json());
  registerOpenPixoAgentRoutes(app, { account: harness.account, gateway });
  const server: Server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const events: OpenPixoAgentUsageEvent[] = [];
  const chat = (token: string | null, body: unknown = { model: 'openpixo-agent-flash', stream: true, messages: [{ role: 'user', content: 'hi' }] }) =>
    fetch(`${base}${OPENPIXO_AGENT_PROXY_PATH}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { harness, gateway, base, events, chat };
}

describe('OpenPixo agent gateway', () => {
  it('sends the chosen effort, but leaves a request that set its own alone', async () => {
    const { harness, gateway, chat } = await setup();
    await harness.signIn();
    harness.cloud.handlers.set(CHAT_ROUTE, () => ({ raw: VENDOR_STREAM, headers: { 'Content-Type': 'text/event-stream' } }));
    const token = gateway.open(RUN, () => {}, 'high');
    await (await chat(token, { model: 'm', stream: true, messages: [] })).text();
    await (await chat(token, { model: 'm', stream: true, messages: [], reasoning_effort: 'low' })).text();
    const sent = harness.cloud.requests.filter((request) => request.url.pathname.endsWith('/chat/completions'));
    expect((sent[0]!.body as { reasoning_effort?: string }).reasoning_effort).toBe('high');
    expect((sent[1]!.body as { reasoning_effort?: string }).reasoning_effort).toBe('low');
  });

  it('fails the run with the cloud\u2019s own words when it ends a stream with an error', async () => {
    const { harness, gateway, chat } = await setup();
    await harness.signIn();
    const stopped = { choices: [], error: { code: 'AGENT_RESPONSE_TOO_LONG', message: 'This answer ran past the time limit.' } };
    harness.cloud.handlers.set(CHAT_ROUTE, () => ({
      raw: `data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: ${JSON.stringify(stopped)}\n\n`, headers: { 'Content-Type': 'text/event-stream' },
    }));
    const token = gateway.open(RUN, () => {});
    await (await chat(token)).text();
    expect(gateway.terminalError(RUN)).toEqual({ code: 'AGENT_EXECUTION_FAILED', message: 'This answer ran past the time limit.' });
  });

  it('stops a run whose answer keeps being cut, instead of paying for it again and again', async () => {
    const { harness, gateway, chat } = await setup();
    await harness.signIn();
    let finish = false;
    harness.cloud.handlers.set(CHAT_ROUTE, () => ({
      raw: finish ? 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' : 'data: {"choices":[{"delta":{"content":"part"},"finish_reason":null}]}\n\n',
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    const token = gateway.open(RUN, () => {});
    expect((await chat(token)).status).toBe(200);
    await (await chat(token)).text();
    // A finished answer resets the count: an occasional cut across a long task is normal.
    finish = true;
    await (await chat(token)).text();
    finish = false;
    for (let cut = 0; cut < 3; cut += 1) await (await chat(token)).text();
    const refused = await chat(token);
    expect(refused.status).toBe(400);
    expect(gateway.terminalError(RUN)?.message).toContain('keeps running past the time limit');
  });

  it('reads a catalogue that names no vendor, and keeps only efforts it knows', () => {
    const parsed = agentModels({ ...MODELS, models: [{ id: 'openpixo-agent-gpt-6-1-sol', label: 'GPT-6.1 Sol', priceVersion: 1,
      creditsPerMillionTokens: { inputCacheMiss: 400, inputCacheHit: 20, inputCacheWrite: 500, output: 2000 }, contextTokens: 200000, maxOutputTokens: 16384,
      reasoningEfforts: ['low', 'medium', 'high', 'turbo'], defaultReasoningEffort: 'medium' }] });
    expect(parsed.models[0]).toMatchObject({ label: 'GPT-6.1 Sol', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium',
      creditsPerMillionTokens: { inputCacheWrite: 500 } });
    expect(parsed.models[0]).not.toHaveProperty('vendor');
    // A cloud not yet deployed still answers with the old shape: it must keep parsing.
    expect(agentModels(MODELS).models[0]).toMatchObject({ reasoningEfforts: [], defaultReasoningEffort: null });
    expect(agentRequestUsage(USAGE).cacheWriteTokens).toBe(0);
  });

  it('reads which models take pictures, and treats an older cloud as text only', () => {
    const row = (id: string, inputModalities?: unknown) => ({ id, label: id, priceVersion: 1, contextTokens: 200000, maxOutputTokens: 16384,
      creditsPerMillionTokens: { inputCacheMiss: 60, inputCacheHit: 1.2, output: 240 }, ...(inputModalities === undefined ? {} : { inputModalities }) });
    const parsed = agentModels({ ...MODELS, models: [row('openpixo-agent-flash', ['text', 'image']), row('openpixo-agent-hy4', ['text', 'video']),
      row('openpixo-agent-gpt-6-luna', 'image'), row('openpixo-agent-glm-5-3-flash')] });
    expect(parsed.models.map((model) => model.inputModalities)).toEqual([['text', 'image'], ['text'], ['text'], ['text']]);
  });

  it('forwards the pictures the agent read, fitted under the cloud’s request limit', async () => {
    const { harness, gateway, chat } = await setup();
    await harness.signIn();
    harness.cloud.handlers.set(CHAT_ROUTE, () => ({ raw: VENDOR_STREAM, headers: { 'Content-Type': 'text/event-stream' } }));
    const art = await sharp({ create: { width: 2560, height: 1440, channels: 3, background: '#203040',
      noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer();
    const picture = `data:image/png;base64,${art.toString('base64')}`;
    expect(picture.length).toBeGreaterThan(4_000_000);
    const token = gateway.open(RUN, () => {});
    const response = await chat(token, { model: 'openpixo-agent-flash', stream: true, messages: [{ role: 'user', content: [
      { type: 'text', text: 'Attached media from tool result:' }, { type: 'image_url', image_url: { url: picture } }] }] });
    expect(response.status).toBe(200);
    await response.text();
    const sent = harness.cloud.requests.filter((request) => request.url.pathname.endsWith('/chat/completions'));
    const parts = (sent[0]!.body as { messages: Array<{ content: Array<Record<string, any>> }> }).messages[0]!.content;
    expect(parts[1]!.image_url.url).toMatch(/^data:image\/jpeg;base64,/u);
    expect(JSON.stringify(sent[0]!.body).length).toBeLessThan(4_000_000);
  });

  it('does not read a large body from a caller without a run token', async () => {
    const { harness, chat } = await setup();
    await harness.signIn();
    const response = await chat(null, { model: 'm', messages: [{ role: 'user', content: 'x'.repeat(5_000_000) }] });
    expect(response.status).toBe(401);
    expect(harness.cloud.requests.some((request) => request.url.pathname.endsWith('/chat/completions'))).toBe(false);
  });

  it('leaves a retired model out of the catalogue and marks the default, whatever order the cloud lists them in', async () => {
    const row = (id: string, label: string) => ({ id, label, priceVersion: 1, contextTokens: 200000, maxOutputTokens: 16384,
      creditsPerMillionTokens: { inputCacheMiss: 60, inputCacheHit: 1.2, output: 240 }, reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high' });
    const catalogue = { ...MODELS, models: [row('openpixo-agent-gpt-6-luna', 'GPT-6 Luna'), row('openpixo-agent-pro', 'DeepSeek V4 Pro'),
      row('openpixo-agent-flash', 'DeepSeek V4.1 Flash')] };
    expect(agentModels(catalogue).models.map((model) => model.id)).toEqual(['openpixo-agent-gpt-6-luna', 'openpixo-agent-flash']);
    setOpenPixoAgentCatalogReader(async () => agentModels(catalogue));
    const picker = await fetchOpenPixoAgentModels();
    expect(picker?.map((model) => [model.id, model.default === true])).toEqual([['openpixo-agent-gpt-6-luna', false], ['openpixo-agent-flash', true]]);
    expect(picker?.[1]?.creditsPerMillionTokens).toEqual({ inputCacheMiss: 60, inputCacheHit: 1.2, output: 240 });
  });

  it('offers the cloud\u2019s models in the picker and falls back when it cannot be asked', async () => {
    setOpenPixoAgentCatalogReader(async () => agentModels({ ...MODELS, models: [{ id: 'openpixo-agent-hy4', label: 'Tencent Hy4', priceVersion: 1,
      creditsPerMillionTokens: { inputCacheMiss: 1, inputCacheHit: 1, output: 1 }, contextTokens: 1, maxOutputTokens: 1,
      reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high' }] }));
    expect(await fetchOpenPixoAgentModels()).toEqual([{ id: 'openpixo-agent-hy4', label: 'Tencent Hy4',
      reasoningOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High', default: true }],
      creditsPerMillionTokens: { inputCacheMiss: 1, inputCacheHit: 1, output: 1 } }]);
    setOpenPixoAgentCatalogReader(async () => { throw new Error('offline'); });
    // The window comes from the catalogue the picker just read, per model.
    expect(openpixoAgentContextLimits('openpixo-agent-hy4')).toEqual({ limitTokens: 1, autoCompactAtTokens: 0 });
    expect(await fetchOpenPixoAgentModels()).toBeNull();
    expect(openpixoAgentDef.fallbackModels.map((model) => model.id)).toEqual(['openpixo-agent-flash']);
    expect(openpixoAgentDef.fallbackModels[0]).toMatchObject({ id: 'openpixo-agent-flash', default: true });
    expect(JSON.stringify(openpixoAgentDef.fallbackModels)).not.toContain('OpenPixo Agent');
  });

  it('passes only real effort levels from a run', () => {
    expect(openpixoAgentEffort('medium')).toBe('medium');
    expect(openpixoAgentEffort('default')).toBeNull();
    expect(openpixoAgentEffort(undefined)).toBeNull();
  });

  it('relays a run-scoped stream with the user session and strips the usage trailer', async () => {
    const { harness, gateway, events, chat } = await setup();
    await harness.signIn();
    harness.cloud.handlers.set(CHAT_ROUTE, () => ({
      raw: `${VENDOR_STREAM}: openpixo-usage ${JSON.stringify(USAGE)}\n\n`, headers: { 'Content-Type': 'text/event-stream' },
    }));
    const token = gateway.open(RUN, (event) => events.push(event));
    expect(gateway.open(RUN, (event) => events.push(event))).toBe(token);
    expect((await chat(null)).status).toBe(401);
    expect((await chat('x'.repeat(43))).status).toBe(401);

    const body = { model: 'openpixo-agent-flash', stream: true, messages: [{ role: 'user', content: 'make a slime' }] };
    const response = await chat(token, body);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toBe(`${VENDOR_STREAM}\n`);
    const sent = harness.cloud.requests.find((request) => request.url.pathname === '/functions/v1/agent-chat/chat/completions')!;
    expect(sent.headers.authorization).toBe(`Bearer ${ACCESS}`);
    expect(sent.headers['x-openpixo-run']).toBe(RUN);
    expect(sent.body).toEqual(body);
    expect(JSON.stringify(sent)).not.toContain(token);
    expect(events).toEqual([{ type: 'hosted_usage', requests: 1, inputTokens: 1200, cachedInputTokens: 1000, outputTokens: 40,
      costMicrocredits: 17_100, creditsCharged: 0 }]);
    expect(gateway.runUsage(RUN)).toMatchObject({ requests: 1, costMicrocredits: 17_100 });

    gateway.close(RUN);
    expect((await chat(token)).status).toBe(401);
    expect(gateway.runUsage(RUN)).toMatchObject({ requests: 1 });
  });

  it('turns out-of-credits into a non-retryable refusal and the run failure reason', async () => {
    const { harness, gateway, chat } = await setup();
    await harness.signIn();
    harness.cloud.handlers.set(CHAT_ROUTE, () => ({
      status: 402, body: { error: { code: 'INSUFFICIENT_CREDITS', message: 'Not enough OpenPixo credits.' } } }));
    const token = gateway.open(RUN, () => {});
    const response = await chat(token);
    expect(response.status).toBe(402);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(body.error.message).toContain('out of OpenPixo credits');
    const overridden = gateway.overrideRunError(RUN, { message: 'opencode exited 1', error: { code: 'AGENT_EXECUTION_FAILED', message: 'opencode exited 1' } });
    expect(overridden.error).toMatchObject({ code: 'INSUFFICIENT_CREDITS', retryable: false });
    expect(gateway.overrideRunError('another-run-0001', { error: { code: 'X' } })).toEqual({ error: { code: 'X' } });

    // A pause is not retryable either: OpenCode would retry a 503 for minutes.
    harness.cloud.handlers.set(CHAT_ROUTE, () => ({
      status: 503, body: { error: { code: 'AGENT_PAUSED', message: 'The OpenPixo agent is temporarily paused.' } } }));
    const second = gateway.open('run-agent-0002', () => {});
    expect((await chat(second)).status).toBe(403);
    expect(gateway.terminalError('run-agent-0002')).toMatchObject({ code: 'HOSTED_AGENT_UNAVAILABLE' });

    // Transient refusals stay retryable and do not fail the run.
    harness.cloud.handlers.set(CHAT_ROUTE, () => ({
      status: 429, body: { error: { code: 'AGENT_RATE_LIMITED', message: 'Too many.' } } }));
    const third = gateway.open('run-agent-0003', () => {});
    expect((await chat(third)).status).toBe(429);
    expect(gateway.terminalError('run-agent-0003')).toBeNull();
  });

  it('refuses a signed-out run without contacting the agent gateway', async () => {
    const { harness, gateway, chat } = await setup();
    const token = gateway.open(RUN, () => {});
    const response = await chat(token);
    expect(response.status).toBe(401);
    expect(gateway.terminalError(RUN)).toMatchObject({ code: 'AGENT_AUTH_REQUIRED' });
    expect(harness.cloud.requests.some((request) => request.url.pathname.startsWith('/functions/v1/agent-chat'))).toBe(false);
  });

  it('serves models and per-run usage to the UI and CLI', async () => {
    const { harness, gateway, base } = await setup();
    harness.cloud.handlers.set('GET /functions/v1/agent-chat/models', () => ({ body: MODELS }));
    const signedOut = await (await fetch(`${base}/api/openpixo/agent/models`)).json() as Record<string, unknown>;
    expect(signedOut).toMatchObject({ signedIn: false, agentPaused: false, models: [{ id: 'openpixo-agent-flash' }] });
    await harness.signIn();
    harness.cloud.handlers.set('GET /functions/v1/agent-chat/usage', (request) => ({ body: { runKey: request.url.searchParams.get('run'),
      requests: 3, openRequests: 0, inputTokens: 9, cachedInputTokens: 3, outputTokens: 2, costMicrocredits: 1_500_000, creditsCharged: 1 } }));
    gateway.open(RUN, () => {});
    const usage = await (await fetch(`${base}/api/openpixo/agent/runs/${RUN}/usage`)).json() as Record<string, unknown>;
    expect(usage).toMatchObject({ runId: RUN, local: { requests: 0 }, cloud: { requests: 3, creditsCharged: 1 } });
    expect((await fetch(`${base}/api/openpixo/agent/runs/bad/usage`)).status).toBe(400);
  });
});

describe('OpenPixo agent runtime', () => {
  it('points the bundled OpenCode at the local gateway and keeps the token out of config and argv', () => {
    const config = buildOpenPixoAgentOpenCodeConfig('http://127.0.0.1:17456/', 'openpixo-agent-glm-5-3-flash');
    const provider = (config.provider as Record<string, any>).openpixo;
    expect(config.agent).toEqual({ title: { disable: true } });
    expect(provider.npm).toBe('@ai-sdk/openai-compatible');
    expect(provider.options).toMatchObject({ baseURL: 'http://127.0.0.1:17456/api/openpixo/agent/v1', apiKey: `{env:${OPENPIXO_AGENT_TOKEN_ENV}}` });
    expect(Object.keys(provider.models)).toEqual(['openpixo-agent-glm-5-3-flash']);
    expect(provider.models['openpixo-agent-glm-5-3-flash'].interleaved).toEqual({ field: 'reasoning_content' });
    // A model the cloud has not described keeps the window every released cloud accepts.
    expect(provider.models['openpixo-agent-glm-5-3-flash'].limit).toEqual({ context: 200_000, output: 32_000 });
    expect(openpixoAgentContextLimits('openpixo-agent-glm-5-3-flash')).toEqual({ limitTokens: 200_000, autoCompactAtTokens: 168_000 });
    expect(openpixoAgentModelArg('default')).toBe('openpixo/openpixo-agent-flash');
    expect(openpixoAgentModelArg('openpixo/openpixo-agent-glm-5-3-flash')).toBe('openpixo/openpixo-agent-glm-5-3-flash');
    expect(openpixoAgentModelArg('deepseek-flash')).toBe('openpixo/openpixo-agent-flash');
    const args = openpixoAgentDef.buildArgs('prompt', [], [], { model: 'openpixo-agent-glm-5-3-flash' }, { cwd: 'C:/game' });
    expect(args).toEqual(expect.arrayContaining(['run', '--format', 'json', '--dir', 'C:/game', '-m', 'openpixo/openpixo-agent-glm-5-3-flash']));
    expect(args.join(' ')).not.toMatch(/token|Bearer/iu);
  });
  it('lets the agent send pictures only to a model the cloud says reads them', async () => {
    const row = (id: string, inputModalities: string[]) => ({ id, label: id, priceVersion: 1, contextTokens: 500000, maxOutputTokens: 32000,
      creditsPerMillionTokens: { inputCacheMiss: 60, inputCacheHit: 1.2, output: 240 }, inputModalities });
    setOpenPixoAgentCatalogReader(async () => agentModels({ ...MODELS,
      models: [row('openpixo-agent-flash', ['text', 'image']), row('openpixo-agent-hy4', ['text'])] }));
    await fetchOpenPixoAgentModels();
    const modalities = (model: string) => ((buildOpenPixoAgentOpenCodeConfig('http://127.0.0.1:1', model).provider as Record<string, any>)
      .openpixo.models[model].modalities);
    expect(modalities('openpixo-agent-flash')).toEqual({ input: ['text', 'image'], output: ['text'] });
    expect(modalities('openpixo-agent-hy4')).toEqual({ input: ['text'], output: ['text'] });
    // A model the cloud has not described is not sent pictures.
    expect(modalities('openpixo-agent-gpt-6-luna')).toEqual({ input: ['text'], output: ['text'] });
    // The cloud stops listing pictures for a model: the next run sends it none.
    setOpenPixoAgentCatalogReader(async () => agentModels({ ...MODELS, models: [row('openpixo-agent-flash', ['text'])] }));
    await fetchOpenPixoAgentModels();
    expect(modalities('openpixo-agent-flash')).toEqual({ input: ['text'], output: ['text'] });
  });

  it('runs a saved retired model as the default instead', () => {
    expect(openpixoAgentModelArg('openpixo-agent-pro')).toBe('openpixo/openpixo-agent-flash');
    expect(openpixoAgentModelArg('openpixo/openpixo-agent-pro')).toBe('openpixo/openpixo-agent-flash');
    const args = openpixoAgentDef.buildArgs('prompt', [], [], { model: 'openpixo-agent-pro' }, { cwd: 'C:/game' });
    expect(args).toEqual(expect.arrayContaining(['-m', 'openpixo/openpixo-agent-flash']));
    expect(Object.keys((buildOpenPixoAgentOpenCodeConfig('http://127.0.0.1:1', 'openpixo-agent-pro').provider as Record<string, any>).openpixo.models))
      .toEqual(['openpixo-agent-flash']);
  });
});
