import {
  GAME_PLAN_CONCEPT_IMAGE_LIMIT,
  GAME_PLAN_RECORD_MAX_CHARS,
  GAME_SAMPLE_TEMPLATE_ID,
  type ApiErrorResponse,
  type ApproveGamePlanResponse,
  type CreateGameFromTemplateResponse,
  type GamePlanResponse,
  type GameScaffoldResponse,
  type GameVerifyContext,
  type ImportFolderResponse,
  type EngineProfileResponse,
  type ProjectResponse,
} from '@openpixo/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { approvedPlanText, folderHoldsExistingWork, gameEngineOptions } from '../../src/game/plan.js';
import { runGamePlanCli } from '../../src/game/plan-cli.js';
import { registerGamePlanRoutes } from '../../src/routes/game-plan.js';
import { toolTokenRegistry, CHAT_TOOL_ENDPOINTS, CHAT_TOOL_OPERATIONS } from '../../src/tool-tokens.js';

describe('the plan state at the daemon HTTP boundary', () => {
  let server: Server | undefined;
  let base = '';
  let root = '';
  const json = { 'Content-Type': 'application/json' };

  beforeAll(async () => {
    const { startServer } = await import('../../src/server.js');
    const started = await startServer({ port: 0, returnServer: true }) as { url: string; server: Server };
    server = started.server;
    base = started.url;
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'openpixo-game-plan-')));
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (root) await rm(root, { recursive: true, force: true });
  });

  const post = (route: string, body: unknown = {}, headers: Record<string, string> = {}) => fetch(`${base}${route}`, {
    method: 'POST', headers: { ...json, Origin: base, ...headers }, body: JSON.stringify(body),
  });
  const project = async (id: string) => (await (await fetch(`${base}/api/projects/${id}`)).json() as ProjectResponse).project;
  async function create(body: Record<string, unknown> = {}) {
    const id = `plan_${randomUUID()}`;
    const response = await post('/api/projects', { id, name: 'Rage game', metadata: { kind: 'other' }, ...body });
    expect(response.status, await response.clone().text()).toBe(200);
    return id;
  }
  async function folder(name: string, files: Record<string, string> = {}) {
    const dir = path.join(root, name);
    await mkdir(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) await writeFile(path.join(dir, file), content);
    return dir;
  }
  const phaserPackage = JSON.stringify({ name: 'g', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { phaser: '3.80.1' } });

  describe('every new project starts in planning', () => {
    it('stamps a project created from the Home composer', async () => {
      const id = await create();
      expect((await project(id)).metadata?.gamePlan).toMatchObject({ status: 'planning' });
      const state = await (await fetch(`${base}/api/projects/${id}/game-plan`)).json() as GamePlanResponse;
      expect(state.plan?.status).toBe('planning');
    });

    it('leaves out projects that are not games or that opted out', async () => {
      const opted = await create({ skipDiscoveryBrief: true });
      expect((await project(opted)).metadata?.gamePlan).toBeUndefined();
      const video = await create({ metadata: { kind: 'video' } });
      expect((await project(video)).metadata?.gamePlan).toBeUndefined();
      const state = await (await fetch(`${base}/api/projects/${opted}/game-plan`)).json() as GamePlanResponse;
      expect(state.plan).toBeNull();
    });

    it('keeps the state daemon-owned on create and on update', async () => {
      const refused = await post('/api/projects', { id: `plan_${randomUUID()}`, name: 'Nope', metadata: { kind: 'other', gamePlan: { status: 'approved', startedAt: 1 } } });
      expect(refused.status).toBe(400);
      const id = await create();
      const patch = (metadata: unknown) => fetch(`${base}/api/projects/${id}`, { method: 'PATCH', headers: { ...json, Origin: base }, body: JSON.stringify({ metadata }) });
      expect((await patch({ kind: 'other', gamePlan: { status: 'approved', startedAt: 1 } })).status).toBe(400);
      // Web clients round-trip the metadata they were given, or leave the key out.
      const current = (await project(id)).metadata;
      expect((await patch({ ...current, linkedDirs: [] })).status).toBe(200);
      expect((await patch({ kind: 'other', starterChecklistDismissed: true })).status).toBe(200);
      expect((await project(id)).metadata?.gamePlan?.status).toBe('planning');
    });

    it('plans a template project from the wizard, but not the finished sample', async () => {
      const parent = await folder('template-parent');
      const created = await (await post('/api/projects/game-from-template', { templateId: 'phaser3-vite', parentDir: parent, name: 'new-one', setup: { genre: 'platformer' } })).json() as CreateGameFromTemplateResponse;
      expect(created.project.metadata?.gamePlan?.status).toBe('planning');
      const sample = await (await post('/api/projects/game-from-template', { templateId: GAME_SAMPLE_TEMPLATE_ID, parentDir: parent, name: 'sample-one' })).json() as CreateGameFromTemplateResponse;
      expect(sample.project.metadata?.gamePlan).toBeUndefined();
    });

    it('does not interview an imported folder that already holds a game', async () => {
      const game = await folder('imported-game', { 'package.json': phaserPackage });
      const imported = await (await post('/api/import/folder', { baseDir: game })).json() as ImportFolderResponse;
      expect(imported.project.metadata?.gamePlan).toBeUndefined();
      const empty = await folder('imported-empty');
      const fresh = await (await post('/api/import/folder', { baseDir: empty })).json() as ImportFolderResponse;
      expect(fresh.project.metadata?.gamePlan?.status).toBe('planning');
    });
  });

  describe('the chosen folder is the working directory', () => {
    it('keeps planning when the composer folder is empty', async () => {
      const dir = await folder('RageGame');
      const id = await create();
      const moved = await post(`/api/projects/${id}/working-dir`, { baseDir: dir });
      expect(moved.status, await moved.clone().text()).toBe(200);
      const metadata = (await project(id)).metadata;
      expect(metadata?.baseDir).toBe(dir);
      expect(metadata?.gamePlan?.status).toBe('planning');
    });

    it('drops planning when the composer folder already holds a game', async () => {
      const dir = await folder('ExistingGame', { 'package.json': phaserPackage });
      const id = await create();
      expect((await post(`/api/projects/${id}/working-dir`, { baseDir: dir })).status).toBe(200);
      expect((await project(id)).metadata?.gamePlan).toBeUndefined();
    });
  });

  describe('approval is the user\'s', () => {
    it('moves the project out of planning once and reports the stamp', async () => {
      const id = await create();
      const approved = await post(`/api/projects/${id}/game-plan/approve`);
      expect(approved.status).toBe(200);
      const body = await approved.json() as ApproveGamePlanResponse;
      expect(body.plan.status).toBe('approved');
      expect(body.plan.approvedAt).toBeTypeOf('number');
      expect(body.project.metadata?.gamePlan?.status).toBe('approved');
      const again = await (await post(`/api/projects/${id}/game-plan/approve`)).json() as ApproveGamePlanResponse;
      expect(again.plan.approvedAt).toBe(body.plan.approvedAt);
    });

    it('refuses an agent\'s tool token and a foreign origin', async () => {
      const id = await create();
      const grant = toolTokenRegistry.mint({ runId: `run_${randomUUID()}`, projectId: id });
      const byAgent = await post(`/api/projects/${id}/game-plan/approve`, {}, { Authorization: `Bearer ${grant.token}` });
      expect(byAgent.status).toBe(403);
      const foreign = await post(`/api/projects/${id}/game-plan/approve`, {}, { Origin: 'http://evil.example' });
      expect(foreign.status).toBe(403);
      expect((await project(id)).metadata?.gamePlan?.status).toBe('planning');
    });

    it('records the agent message the user approved, so every build turn reads the plan', async () => {
      const id = `plan_${randomUUID()}`;
      const created = await post('/api/projects', { id, name: 'Rage game', metadata: { kind: 'other' } });
      const { conversationId } = await created.json() as { conversationId: string };
      const put = (mid: string, body: Record<string, unknown>) => fetch(`${base}/api/projects/${id}/conversations/${conversationId}/messages/${mid}`, {
        method: 'PUT', headers: { ...json, Origin: base }, body: JSON.stringify({ id: mid, ...body }),
      });
      expect((await put('m1', { role: 'user', content: '做一个跳跃游戏' })).status).toBe(200);
      expect((await put('m2', { role: 'assistant', content: '第 3 步 / 共 5 步：引擎与技术' })).status).toBe(200);
      expect((await put('m3', { role: 'user', content: '好' })).status).toBe(200);
      const plan = '第 4 步 / 共 5 步：计划\n\n阶段 1：能跳的小人\n阶段 2：敌人';
      expect((await put('m4', { role: 'assistant', content: `${plan}\n\n<question-form id="x" title="t">{"questions":[]}</question-form>\n<pixo-next key="k" value="v"/>` })).status).toBe(200);
      const body = await (await post(`/api/projects/${id}/game-plan/approve`)).json() as ApproveGamePlanResponse;
      expect(body.plan.approvedPlan).toBe(plan);
      expect((await project(id)).metadata?.gamePlan?.approvedPlan).toBe(plan);
    });

    it('records nothing when the agent has said nothing yet', async () => {
      const id = await create();
      const body = await (await post(`/api/projects/${id}/game-plan/approve`)).json() as ApproveGamePlanResponse;
      expect(body.plan.status).toBe('approved');
      expect(body.plan.approvedPlan).toBeUndefined();
    });

    it('caps a recorded plan and strips host markup', () => {
      expect(approvedPlanText(undefined)).toBeUndefined();
      expect(approvedPlanText('<question-form id="a" title="b">{}</question-form>')).toBeUndefined();
      expect(approvedPlanText('<pixo-title>T</pixo-title>Plan\n\n\n\nStage 1')).toBe('Plan\n\nStage 1');
      const long = approvedPlanText('x'.repeat(GAME_PLAN_RECORD_MAX_CHARS + 50))!;
      expect(long.length).toBeLessThanOrEqual(GAME_PLAN_RECORD_MAX_CHARS + 4);
      expect(long.endsWith('[…]')).toBe(true);
    });

    it('answers 400 for a project that has no plan', async () => {
      const id = await create({ skipDiscoveryBrief: true });
      expect((await post(`/api/projects/${id}/game-plan/approve`)).status).toBe(400);
    });
  });

  describe('agent spending waits for approval', () => {
    const generate = (token: string) => post('/api/tools/media/generate', { surface: 'image', model: 'no-such-model', prompt: 'concept' }, { Authorization: `Bearer ${token}` });
    const held = async (response: Response) => {
      expect(response.status).toBe(409);
      const body = await response.json() as { code?: string; error?: unknown };
      expect(JSON.stringify(body)).toContain('GAME_PLAN_NOT_APPROVED');
    };

    it('allows a few concept images and then refuses', async () => {
      const id = await create();
      const grant = toolTokenRegistry.mint({ runId: `run_${randomUUID()}`, projectId: id });
      for (let attempt = 0; attempt < GAME_PLAN_CONCEPT_IMAGE_LIMIT; attempt += 1) {
        expect((await generate(grant.token)).status).not.toBe(409);
      }
      await held(await generate(grant.token));
    });

    it('refuses non-image media and asset recipes while planning', async () => {
      const id = await create();
      const grant = toolTokenRegistry.mint({ runId: `run_${randomUUID()}`, projectId: id });
      await held(await post('/api/tools/media/generate', { surface: 'video', model: 'x', prompt: 'y' }, { Authorization: `Bearer ${grant.token}` }));
      await held(await post(`/api/projects/${id}/recipe-runs`, { recipeId: 'openpixo/none', inputs: {} }, { Authorization: `Bearer ${grant.token}` }));
    });

    it('stops holding after approval and never holds the user', async () => {
      const id = await create();
      const grant = toolTokenRegistry.mint({ runId: `run_${randomUUID()}`, projectId: id });
      const user = await post(`/api/projects/${id}/recipe-runs`, { recipeId: 'openpixo/none', inputs: {} });
      expect(user.status).not.toBe(409);
      expect((await post(`/api/projects/${id}/game-plan/approve`)).status).toBe(200);
      expect((await post('/api/tools/media/generate', { surface: 'video', model: 'x', prompt: 'y' }, { Authorization: `Bearer ${grant.token}` })).status).not.toBe(409);
    });
  });

  describe('the same capability from the CLI', () => {
    async function cli(args: string[], env: Record<string, string> = {}) {
      const previous = { token: process.env.PIXO_TOOL_TOKEN, exit: process.exitCode };
      Object.assign(process.env, env);
      if (!env.PIXO_TOOL_TOKEN) delete process.env.PIXO_TOOL_TOKEN;
      const chunks: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { chunks.push(String(chunk)); return true; });
      process.exitCode = 0;
      try {
        await runGamePlanCli([...args, '--daemon-url', base, '--json']);
        return { body: JSON.parse(chunks.join('')) as Record<string, any>, exitCode: process.exitCode };
      } finally {
        spy.mockRestore();
        process.exitCode = previous.exit;
        if (previous.token === undefined) delete process.env.PIXO_TOOL_TOKEN;
        else process.env.PIXO_TOOL_TOKEN = previous.token;
      }
    }

    it('shows the state, approves as the user, and scaffolds', async () => {
      const id = await create();
      expect((await cli(['plan', '--project', id])).body.plan.status).toBe('planning');
      expect((await cli(['scaffold', '--project', id, '--template', 'threejs-vite'])).exitCode).toBe(1);
      expect((await cli(['plan', 'approve', '--project', id])).body.plan.status).toBe('approved');
      expect((await cli(['scaffold', '--project', id, '--template', 'threejs-vite'])).body.engine).toBe('threejs');
    });

    it('will not approve from inside an agent run', async () => {
      const id = await create();
      const result = await cli(['plan', 'approve', '--project', id], { PIXO_TOOL_TOKEN: 'pixott_x' });
      expect(result.exitCode).toBe(1);
      expect(result.body.error.code).toBe('FORBIDDEN');
      expect((await project(id)).metadata?.gamePlan?.status).toBe('planning');
    });
  });

  describe('the host can run a brand-new game', () => {
    it('gives a managed project verification and engine detection', async () => {
      const id = await create();
      const context = await fetch(`${base}/api/projects/${id}/game/verify/context`, { headers: { Origin: base } });
      expect(context.status, await context.clone().text()).toBe(200);
      const body = await context.json() as GameVerifyContext;
      expect(body.profile.engine).toBe('unknown');
      expect(path.isAbsolute(body.projectDir)).toBe(true);
      const engine = await fetch(`${base}/api/projects/${id}/engine`);
      expect(engine.status).toBe(200);
      expect((await engine.json() as EngineProfileResponse).profile.engine).toBe('unknown');
    });

    it('scaffolds the chosen engine into the chosen folder only after approval', async () => {
      const dir = await folder('Scaffolded');
      const id = await create();
      expect((await post(`/api/projects/${id}/working-dir`, { baseDir: dir })).status).toBe(200);

      const early = await post(`/api/projects/${id}/game/scaffold`, { templateId: 'phaser3-vite' });
      expect(early.status).toBe(409);
      expect((await early.json() as ApiErrorResponse).error.code).toBe('GAME_PLAN_NOT_APPROVED');
      await expect(readFile(path.join(dir, 'package.json'))).rejects.toThrow();

      expect((await post(`/api/projects/${id}/game-plan/approve`)).status).toBe(200);
      const done = await post(`/api/projects/${id}/game/scaffold`, { templateId: 'phaser3-vite' });
      expect(done.status, await done.clone().text()).toBe(200);
      const scaffold = await done.json() as GameScaffoldResponse;
      expect(scaffold).toMatchObject({ templateId: 'phaser3-vite', engine: 'phaser', projectDir: dir });
      expect(scaffold.files).toContain('index.html');
      await expect(readFile(path.join(dir, 'package.json'), 'utf8')).resolves.toContain('phaser');
      expect((await project(id)).metadata?.engineProfile?.engine).toBe('phaser');

      const context = await (await fetch(`${base}/api/projects/${id}/game/verify/context`, { headers: { Origin: base } })).json() as GameVerifyContext;
      expect(context).toMatchObject({ projectDir: dir, profile: { engine: 'phaser' } });
    });

    it('never scaffolds over existing work and rejects an unknown starter', async () => {
      const dir = await folder('Occupied');
      const id = await create();
      expect((await post(`/api/projects/${id}/working-dir`, { baseDir: dir })).status).toBe(200);
      expect((await post(`/api/projects/${id}/game-plan/approve`)).status).toBe(200);
      expect((await post(`/api/projects/${id}/game/scaffold`, { templateId: 'no-such-starter' })).status).toBe(404);
      await writeFile(path.join(dir, 'game.js'), 'mine');
      const occupied = await post(`/api/projects/${id}/game/scaffold`, { templateId: 'phaser3-vite' });
      expect(occupied.status).toBe(409);
      await expect(readFile(path.join(dir, 'game.js'), 'utf8')).resolves.toBe('mine');
    });

    it('still scaffolds when planning left concept art in the folder', async () => {
      const dir = await folder('WithConcepts', { 'hero-concept.png': 'png' });
      const id = await create();
      expect((await post(`/api/projects/${id}/working-dir`, { baseDir: dir })).status).toBe(200);
      expect((await project(id)).metadata?.gamePlan?.status).toBe('planning');
      expect((await post(`/api/projects/${id}/game-plan/approve`)).status).toBe(200);
      expect((await post(`/api/projects/${id}/game/scaffold`, { templateId: 'phaser3-vite' })).status).toBe(200);
      await expect(readFile(path.join(dir, 'hero-concept.png'), 'utf8')).resolves.toBe('png');
    });

    it('lets the running agent scaffold with its own token', async () => {
      expect(CHAT_TOOL_OPERATIONS).toContain('game:scaffold');
      expect(CHAT_TOOL_ENDPOINTS).toContain('/api/projects/:id/game/scaffold');
      const id = await create();
      expect((await post(`/api/projects/${id}/game-plan/approve`)).status).toBe(200);
      const grant = toolTokenRegistry.mint({ runId: `run_${randomUUID()}`, projectId: id });
      const response = await post(`/api/projects/${id}/game/scaffold`, { templateId: 'threejs-vite' }, { Authorization: `Bearer ${grant.token}` });
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await response.json() as GameScaffoldResponse).engine).toBe('threejs');
    });
  });
});

describe('approval during a run', () => {
  it('waits for the run to end, so an agent shell can never approve its own plan', async () => {
    const store = new Map<string, { id: string; metadata: unknown }>();
    let busy = true;
    const app = express();
    app.use(express.json());
    const db = {} as never;
    registerGamePlanRoutes(app, {
      db,
      http: {
        sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
        requireLocalDaemonRequest: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
        isLocalSameOrigin: () => true,
        resolvedPortRef: { current: 0 },
      } as never,
      paths: { PROJECTS_DIR: '', RUNTIME_DATA_DIR: '' } as never,
      authorizeProjectRequest: (async () => true) as never,
      authorizeProjectToolRequest: (async () => true) as never,
      templatesRoot: '',
      isProjectBusy: () => busy,
      artBudget: {} as never,
      store: {
        get: (id) => store.get(id) as never,
        update: (id, patch) => { store.set(id, { id, metadata: patch.metadata }); return store.get(id) as never; },
        forgetAgentSessions: () => {},
        latestAgentMessage: () => null,
      },
    });
    store.set('p1', { id: 'p1', metadata: { kind: 'other', gamePlan: { status: 'planning', startedAt: 1 } } });
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const approve = () => fetch(`http://127.0.0.1:${port}/api/projects/p1/game-plan/approve`, { method: 'POST' });
      const during = await approve();
      expect(during.status).toBe(409);
      expect((await during.json() as ApiErrorResponse).error.code).toBe('RUN_ACTIVE');
      busy = false;
      expect((await approve()).status).toBe(200);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

describe('what counts as an empty folder', () => {
  it('ignores editor and host files, not game files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'openpixo-empty-'));
    try {
      await mkdir(path.join(dir, '.git'));
      await mkdir(path.join(dir, '.pixo-skills'));
      await writeFile(path.join(dir, 'README.md'), '# idea');
      await expect(folderHoldsExistingWork(dir)).resolves.toBe(false);
      // Concept samples from planning sit in the project before any code does.
      await mkdir(path.join(dir, 'concept'));
      await writeFile(path.join(dir, 'concept', 'hero.png'), 'png');
      await writeFile(path.join(dir, 'sample.webp'), 'webp');
      await expect(folderHoldsExistingWork(dir)).resolves.toBe(false);
      await mkdir(path.join(dir, 'scripts'));
      await writeFile(path.join(dir, 'scripts', 'main.gd'), 'extends Node');
      await expect(folderHoldsExistingWork(dir)).resolves.toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('engine options offered while planning', () => {
  it('reports what this machine has for each starter engine', async () => {
    const root = path.resolve(__dirname, '../../../../game-templates');
    const options = await gameEngineOptions(root, id => id === 'npm' ? 'C:\\tools\\npm.cmd' : null);
    const byEngine = new Map(options.map(option => [option.engine, option]));
    expect(byEngine.get('phaser')).toMatchObject({ available: true, missingTools: [] });
    expect(byEngine.get('phaser')?.templates.map(template => template.id)).toEqual(['phaser3-vite']);
    expect(byEngine.get('threejs')?.available).toBe(true);
    expect(byEngine.get('godot')).toMatchObject({ available: false, missingTools: ['godot'] });
    expect(byEngine.has('unity')).toBe(false);
  });

  it('adds an engine without a starter only when its tool is on this machine', async () => {
    const root = path.resolve(__dirname, '../../../../game-templates');
    const options = await gameEngineOptions(root, id => ['unity', 'npm'].includes(id) ? `/x/${id}` : null);
    expect(options.find(option => option.engine === 'unity')).toMatchObject({ available: true, templates: [] });
    const none = await gameEngineOptions(root, () => null);
    expect(none.find(option => option.engine === 'phaser')).toMatchObject({ available: false, missingTools: ['npm'] });
  });
});

describe('starter pages are games, not webpages', () => {
  it('leaves the whole window to the canvas', async () => {
    const root = path.resolve(__dirname, '../../../../game-templates');
    for (const id of ['phaser3-vite', 'threejs-vite', GAME_SAMPLE_TEMPLATE_ID]) {
      const html = await readFile(path.join(root, id, 'files', 'index.html'), 'utf8');
      expect(html, id).toMatch(/margin:\s*0/);
      expect(html, id).toMatch(/overflow:\s*hidden/);
      expect(html, id).not.toMatch(/<(header|footer|nav|main|section|h1)\b/i);
    }
  });
});
