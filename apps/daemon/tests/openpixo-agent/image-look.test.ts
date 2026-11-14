import express from 'express';
import sharp from 'sharp';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, type OpenPixoAgentUsageEvent } from '@openpixo/contracts';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { gameVerifyArtifactDir } from '../../src/game/verify-store.js';
import { sendApiError } from '../../src/http/api-errors.js';
import { OpenPixoAgentGateway, type AgentCloud } from '../../src/openpixo-agent/gateway.js';
import { runLookCli } from '../../src/openpixo-agent/look-cli.js';
import { registerImageLookRoutes } from '../../src/routes/image-look.js';
import { READ_ONLY_TURN_TOOL_OPERATIONS } from '../../src/runtimes/read-only-turn.js';
import { toolTokenRegistry } from '../../src/tool-tokens.js';

const RUN = 'run-look-0001';
const USAGE = { requestId: '0b8c9b52-3d2f-4f5e-9a43-1f0c8c3c2a10', model: OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, estimated: false,
  inputTokens: 900, cachedInputTokens: 0, outputTokens: 30, reasoningTokens: 0, costMicrocredits: 410_000, creditsCharged: 0 };
const ANSWER = 'Two coins are visible. The score at the top left reads 120 and is not cut off.';

interface SentLook { runKey: string; body: any }
let root: string, projectDir: string, artifactsDir: string, server: Server, base: string;
let sent: SentLook[];
let reply: () => globalThis.Response;
let events: OpenPixoAgentUsageEvent[];
let gateway: OpenPixoAgentGateway;
let candidateFile: string | null;

const okReply = () => new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: ANSWER }, finish_reason: 'stop' }] }),
  { status: 200, headers: { 'Content-Type': 'application/json', 'x-openpixo-usage': JSON.stringify(USAGE) } });

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#203040' } }).png().toBuffer();

beforeEach(async () => {
  for (const key of ['FAL_KEY', 'PIXO_FAL_KEY']) delete process.env[key];
  root = await mkdtemp(path.join(tmpdir(), 'op-look-'));
  projectDir = path.join(root, 'game');
  artifactsDir = path.join(root, 'artifacts');
  await mkdir(path.join(projectDir, 'art'), { recursive: true });
  const db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'game', name: 'Game', metadata: { baseDir: projectDir }, createdAt: 1, updatedAt: 1 });
  sent = [];
  events = [];
  candidateFile = null;
  reply = okReply;
  const cloud: AgentCloud = {
    agentCompletion: async (runKey, body) => { sent.push({ runKey, body: JSON.parse(Buffer.from(body).toString('utf8')) }); return reply(); },
  };
  gateway = new OpenPixoAgentGateway(cloud);
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  registerImageLookRoutes(app, {
    db, http: { sendApiError } as any, paths: { PROJECTS_DIR: root, ARTIFACTS_DIR: artifactsDir },
    authorizeProjectToolRequest: async (_res, projectId) => ({ projectId }), gateway,
    recipeCandidateFile: async () => candidateFile,
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

function look(token: string | null, body: unknown) {
  return fetch(`${base}/api/tools/look`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

function hostedRunToken(operations?: readonly string[]): string {
  gateway.open(RUN, (event) => events.push(event));
  return toolTokenRegistry.mint({ runId: RUN, projectId: 'game', ...(operations ? { allowedOperations: operations } : {}) }).token;
}

describe('pixo look', () => {
  it('sends the one picture and the question to the viewer and adds the look to the run’s totals', async () => {
    await writeFile(path.join(projectDir, 'art', 'shot.png'), await png(320, 180));
    const token = hostedRunToken();
    const response = await look(token, { path: 'art/shot.png', question: 'How many coins are visible, and is the score readable?' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: ANSWER, model: OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, creditsCharged: 0, costMicrocredits: 410_000 });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.runKey).toBe(RUN);
    const body = sent[0]!.body;
    expect(body).toMatchObject({ model: OPENPIXO_AGENT_IMAGE_VIEWER_MODEL, stream: false, max_tokens: 800, reasoning_effort: 'low' });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[0].content).toContain('Never guess');
    const parts = body.messages[1].content as Array<Record<string, any>>;
    expect(parts.filter((part) => part.type === 'image_url')).toHaveLength(1);
    expect(parts).toEqual([
      { type: 'text', text: 'How many coins are visible, and is the score readable?' },
      { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/u) } },
    ]);

    expect(events).toEqual([{ type: 'hosted_usage', requests: 1, inputTokens: 900, cachedInputTokens: 0, outputTokens: 30,
      costMicrocredits: 410_000, creditsCharged: 0 }]);
    expect(gateway.runUsage(RUN)).toMatchObject({ requests: 1, costMicrocredits: 410_000 });
  });

  it('reads an absolute project path, a verification screenshot and a staged recipe candidate, and fits a large picture the same way every time', async () => {
    await writeFile(path.join(projectDir, 'art', 'wide.png'), await png(4096, 1024));
    const verifyDir = gameVerifyArtifactDir(artifactsDir, 'game');
    await mkdir(verifyDir, { recursive: true });
    const shot = path.join(verifyDir, '3f1c2b9a-1d2e-4f5a-8b6c-7d8e9f0a1b2c.jpg');
    await writeFile(shot, await sharp({ create: { width: 64, height: 36, channels: 3, background: '#ff0000' } }).jpeg().toBuffer());
    const token = hostedRunToken();

    expect((await look(token, { path: path.join(projectDir, 'art', 'wide.png'), question: 'Is the horizon level?' })).status).toBe(200);
    expect((await look(token, { path: path.join(projectDir, 'art', 'wide.png'), question: 'Is the horizon level?' })).status).toBe(200);
    const [first, second] = sent.map((entry) => entry.body.messages[1].content[1].image_url.url as string);
    expect(first).toBe(second);
    const fitted = await sharp(Buffer.from(first!.slice(first!.indexOf(',') + 1), 'base64')).metadata();
    expect(Math.max(fitted.width ?? 0, fitted.height ?? 0)).toBe(2048);

    expect((await look(token, { path: shot, question: 'Is the screen blank?' })).status).toBe(200);
    expect(sent.at(-1)!.body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/u);

    candidateFile = path.join(root, 'staged.png');
    await writeFile(candidateFile, await png(16, 16));
    expect((await look(token, { path: path.join(root, 'recipe-runs', 'x', 'staged.png'), question: 'Is the sprite centred?' })).status).toBe(200);
    expect(sent).toHaveLength(4);
  });

  it('refuses without a token, outside a hosted run, outside the project, for a non-image or an empty question, and never calls the cloud', async () => {
    await writeFile(path.join(projectDir, 'art', 'shot.png'), await png(32, 32));
    await writeFile(path.join(projectDir, 'notes.txt'), 'hello');
    await writeFile(path.join(projectDir, 'art', 'fake.png'), 'not a picture');
    await writeFile(path.join(root, 'outside.png'), await png(8, 8));
    const question = 'Is the sprite visible?';

    expect((await look(null, { path: 'art/shot.png', question })).status).toBe(401);

    // A run that is not on OpenPixo credits has a tool token but no gateway state.
    const localRun = toolTokenRegistry.mint({ runId: 'run-local-0001', projectId: 'game' }).token;
    const notHosted = await look(localRun, { path: 'art/shot.png', question });
    expect(notHosted.status).toBe(409);
    expect(JSON.stringify(await notHosted.json())).toContain('look is for the OpenPixo-credits agent; open the image directly');

    const token = hostedRunToken();
    expect((await look(token, { path: '../outside.png', question })).status).toBe(403);
    expect((await look(token, { path: path.join(root, 'outside.png'), question })).status).toBe(403);
    expect((await look(token, { path: 'notes.txt', question })).status).toBe(415);
    expect((await look(token, { path: 'art/fake.png', question })).status).toBe(415);
    expect((await look(token, { path: 'art/missing.png', question })).status).toBe(404);
    expect((await look(token, { path: 'art/shot.png', question: '   ' })).status).toBe(400);
    expect((await look(token, { path: 'art/shot.png' })).status).toBe(400);
    expect((await look(token, { path: 'art/shot.png', question: 'x'.repeat(4001) })).status).toBe(400);
    // A token minted without the operation cannot look.
    expect((await look(toolTokenRegistry.mint({ runId: RUN, projectId: 'game', allowedOperations: ['asset:read'] }).token,
      { path: 'art/shot.png', question })).status).toBe(403);
    expect(sent).toHaveLength(0);
    expect(gateway.runUsage(RUN)).toMatchObject({ requests: 0 });

    // Planning turns are read-only, and still look at their style samples.
    expect(READ_ONLY_TURN_TOOL_OPERATIONS).toContain('image:look');
    expect((await look(hostedRunToken(READ_ONLY_TURN_TOOL_OPERATIONS), { path: 'art/shot.png', question })).status).toBe(200);
  });

  it('turns out-of-credits into the run’s failure, like the agent’s own requests', async () => {
    await writeFile(path.join(projectDir, 'art', 'shot.png'), await png(32, 32));
    reply = () => new Response(JSON.stringify({ error: { code: 'INSUFFICIENT_CREDITS', message: 'Not enough OpenPixo credits.' } }),
      { status: 402, headers: { 'Content-Type': 'application/json' } });
    const token = hostedRunToken();
    const response = await look(token, { path: 'art/shot.png', question: 'Is the sprite visible?' });
    expect(response.status).toBe(402);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(body.error.message).toContain('out of OpenPixo credits');
    expect(gateway.terminalError(RUN)).toMatchObject({ code: 'INSUFFICIENT_CREDITS' });

    // A transient refusal does not fail the run.
    reply = () => new Response(JSON.stringify({ error: { code: 'AGENT_RATE_LIMITED', message: 'Too many.' } }), { status: 429 });
    gateway.open('run-look-0002', () => {});
    const second = toolTokenRegistry.mint({ runId: 'run-look-0002', projectId: 'game' }).token;
    const limited = await look(second, { path: 'art/shot.png', question: 'Is the sprite visible?' });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(gateway.terminalError('run-look-0002')).toBeNull();
  });

  it('pixo look sends an absolute path and prints only the answer', async () => {
    await writeFile(path.join(projectDir, 'art', 'shot.png'), await png(32, 32));
    const token = hostedRunToken();
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { written.push(String(chunk)); return true; });
    const previousToken = process.env.PIXO_TOOL_TOKEN;
    process.env.PIXO_TOOL_TOKEN = token;
    // Relative to wherever the agent is; the CLI makes it absolute before sending it.
    const relative = path.relative(process.cwd(), path.join(projectDir, 'art', 'shot.png'));
    try {
      await runLookCli([relative, '--question', 'Is the sprite visible?', '--daemon-url', base]);
      await runLookCli([relative, '--question', 'Is the sprite visible?', '--json', '--daemon-url', base]);
    } finally {
      write.mockRestore();
      if (previousToken === undefined) delete process.env.PIXO_TOOL_TOKEN; else process.env.PIXO_TOOL_TOKEN = previousToken;
    }
    expect(process.exitCode ?? 0).toBe(0);
    expect(written[0]).toBe(`${ANSWER}\n`);
    expect(JSON.parse(written[1]!)).toMatchObject({ answer: ANSWER, model: OPENPIXO_AGENT_IMAGE_VIEWER_MODEL });
    expect(sent.map((entry) => entry.body.messages[1].content[0].text)).toEqual(['Is the sprite visible?', 'Is the sprite visible?']);
  });
});
