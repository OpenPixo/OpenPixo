import express from 'express';
import sharp from 'sharp';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudToolInfo } from '@openpixo/contracts';
import { AGENT_CONTEXT } from '../../src/cloud-skills/wire.js';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { sendApiError } from '../../src/http/api-errors.js';
import { agentRunContext, OpenPixoAgentGateway, type AgentCloud } from '../../src/openpixo-agent/gateway.js';
import { registerImageLookRoutes } from '../../src/routes/image-look.js';
import { READ_ONLY_TURN_TOOL_OPERATIONS } from '../../src/runtimes/read-only-turn.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

const RUN = 'run-tool-0001';
const USAGE = { requestId: '0b8c9b52-3d2f-4f5e-9a43-1f0c8c3c2a10', model: 'openpixo-agent-claude-haiku-5-5', estimated: false,
  inputTokens: 700, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0, costMicrocredits: 300_000, creditsCharged: 0 };

let root: string, projectDir: string, server: Server, base: string, gateway: OpenPixoAgentGateway;
let tools: CloudToolInfo[];
let toolCalls: Array<{ runKey: string; tool: string; body: any }>;
let completions: number;

const answer = (text: string) => new Response(JSON.stringify({ answer: text }),
  { status: 200, headers: { 'Content-Type': 'application/json', 'x-openpixo-usage': JSON.stringify(USAGE) } });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'op-tool-'));
  projectDir = path.join(root, 'game');
  await mkdir(path.join(projectDir, 'art'), { recursive: true });
  const db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'game', name: 'Game', metadata: { baseDir: projectDir }, createdAt: 1, updatedAt: 1 });
  tools = [
    { id: 'balance-check', description: 'Checks a balance table for runaway numbers.', input: 'text' },
    { id: 'look', description: 'Answers one question about one image.', input: 'image' },
  ];
  toolCalls = [];
  completions = 0;
  const cloud: AgentCloud = {
    agentCompletion: async () => { completions++; return new Response('{}', { status: 500 }); },
    agentTool: async (runKey, tool, body) => {
      toolCalls.push({ runKey, tool, body: JSON.parse(Buffer.from(body).toString('utf8')) });
      if (tool === 'balance-check') return answer('Gold income doubles every level; cap it at level 10.');
      return answer('The score text is cut off at the right edge.');
    },
  };
  gateway = new OpenPixoAgentGateway(cloud);
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  registerImageLookRoutes(app, {
    db, http: { sendApiError } as any, paths: { PROJECTS_DIR: root, ARTIFACTS_DIR: path.join(root, 'artifacts') },
    authorizeProjectToolRequest: async (_res, projectId) => ({ projectId }), gateway,
    cloudTools: async () => tools,
  });
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  toolTokenRegistry.clear();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
  await rm(root, { recursive: true, force: true });
});

function post(route: string, token: string, body: unknown) {
  return fetch(`${base}${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

function hostedRunToken(operations?: readonly string[]): string {
  gateway.open(RUN, () => {});
  return toolTokenRegistry.mint({ runId: RUN, projectId: 'game', ...(operations ? { allowedOperations: operations } : {}) }).token;
}

describe('pixo tool', () => {
  it('sends a text tool only the question and the text, and joins the run’s totals', async () => {
    const token = hostedRunToken(READ_ONLY_TURN_TOOL_OPERATIONS);
    const response = await post('/api/tools/cloud', token, { tool: 'balance-check', question: 'Does anything grow without limit?', text: 'level,gold\n1,10\n2,20' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: 'Gold income doubles every level; cap it at level 10.', creditsCharged: 0, costMicrocredits: 300_000 });
    expect(toolCalls).toEqual([{ runKey: RUN, tool: 'balance-check', body: { question: 'Does anything grow without limit?', text: 'level,gold\n1,10\n2,20' } }]);
    expect(gateway.runUsage(RUN)).toMatchObject({ requests: 1, costMicrocredits: 300_000 });
  });

  it('reads an image tool’s file from the project and sends it as a data URL', async () => {
    await writeFile(path.join(projectDir, 'art', 'hud.png'), await sharp({ create: { width: 64, height: 32, channels: 3, background: '#000' } }).png().toBuffer());
    const token = hostedRunToken();
    const response = await post('/api/tools/cloud', token, { tool: 'look', question: 'Is the score cut off?', path: 'art/hud.png' });
    expect(response.status).toBe(200);
    expect(toolCalls[0]!.body).toEqual({ question: 'Is the score cut off?', image: expect.stringMatching(/^data:image\/png;base64,/u) });
  });

  it('refuses an unknown tool, a missing input and a run that is not on OpenPixo models', async () => {
    const token = hostedRunToken();
    const unknown = await post('/api/tools/cloud', token, { tool: 'nope', question: 'Hi?' });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { message: string } }).error.message).toContain('balance-check, look');
    expect((await post('/api/tools/cloud', token, { tool: 'balance-check', question: 'Hi?' })).status).toBe(400);
    expect((await post('/api/tools/cloud', token, { tool: 'look', question: 'Hi?' })).status).toBe(400);
    expect(toolCalls).toHaveLength(0);

    const other = toolTokenRegistry.mint({ runId: 'run-codex', projectId: 'game' }).token;
    expect((await post('/api/tools/cloud', other, { tool: 'balance-check', question: 'Hi?', text: 'x' })).status).toBe(409);
  });

  it('answers pixo look through the cloud tool once the cloud lists it, and through the app’s own prompt before', async () => {
    await writeFile(path.join(projectDir, 'art', 'hud.png'), await sharp({ create: { width: 64, height: 32, channels: 3, background: '#000' } }).png().toBuffer());
    const token = hostedRunToken();
    const viaTool = await post('/api/tools/look', token, { path: 'art/hud.png', question: 'Is the score cut off?' });
    expect(viaTool.status).toBe(200);
    expect(await viaTool.json()).toMatchObject({ answer: 'The score text is cut off at the right edge.', model: 'look' });
    expect(toolCalls.map((call) => call.tool)).toEqual(['look']);
    expect(completions).toBe(0);

    tools = tools.filter((tool) => tool.id !== 'look');
    await post('/api/tools/look', token, { path: 'art/hud.png', question: 'Is the score cut off?' });
    expect(completions).toBe(1);
    expect(toolCalls).toHaveLength(1);
  });
});

describe('run context tag', () => {
  it('names the engine and phase in the one shape the account sends, and falls back to unknown', () => {
    expect(agentRunContext('godot', true)).toBe('engine=godot; phase=planning');
    expect(agentRunContext('phaser', false)).toBe('engine=phaser; phase=building');
    expect(agentRunContext(null, false)).toBe('engine=unknown; phase=building');
    expect(agentRunContext('Bad Engine!', true)).toBe('engine=unknown; phase=planning');
    for (const tag of [agentRunContext('godot', true), agentRunContext(undefined, false)]) expect(AGENT_CONTEXT.test(tag)).toBe(true);
    expect(AGENT_CONTEXT.test('engine=godot; phase=planning\r\nx-evil: 1')).toBe(false);
  });
});
