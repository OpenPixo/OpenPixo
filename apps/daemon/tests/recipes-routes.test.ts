import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import express from 'express';
import { expect, it, vi } from 'vitest';
import { insertProject, openDatabase } from '../src/db.js';
import { createMediaTaskStore } from '../src/media/task-store.js';
import { registerRecipeRoutes } from '../src/recipes/routes.js';
import { runRecipeCli } from '../src/recipes/recipe-cli.js';
import { detectEngineProfile } from '../src/game/engine-detect.js';

it('discovers recipes, serves character CRUD, reports missing skills and forwards code recipes to the existing run entry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'recipe-routes-'));
  const dataDir = path.join(root, 'data'); const projectRoot = path.join(root, 'game');
  const bundled = path.join(root, 'plugins'); const recipeDir = path.join(bundled, 'recipes', 'test-code');
  await mkdir(projectRoot); await mkdir(recipeDir, { recursive: true });
  const db = openDatabase(root, { dataDir });
  insertProject(db, { id: 'p', name: 'Game', metadata: { baseDir: projectRoot }, createdAt: 1, updatedAt: 1 });
  const manifest = { name: 'test-code', title: 'Test code', version: '0.1.0', pixo: { kind: 'recipe', recipe: { surface: 'code', category: 'feature', engines: ['any'], inputs: [] }, useCase: { query: 'Build a {{engine.id}} game' }, context: { skills: [{ ref: 'required-skill' }] } } };
  await writeFile(path.join(recipeDir, 'pixo.json'), JSON.stringify(manifest));
  const catalogSkills: Array<{ id: string; engines?: string[] }> = [];
  const app = express(); app.use(express.json());
  const authorize = vi.fn(async () => true);
  const executor = registerRecipeRoutes(app, { db, mediaTasks: createMediaTaskStore(db),
    paths: { RUNTIME_DATA_DIR: dataDir, PROJECT_ROOT: root, PROJECTS_DIR: root, SKILLS_DIR: path.join(root, 'skills'), USER_SKILLS_DIR: path.join(root, 'user-skills'), BUNDLED_PLUGINS_DIR: bundled },
    http: { requireLocalDaemonRequest: (_req, _res, next) => next(), isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 },
      sendApiError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
      createSseResponse: () => undefined, sendMulterError: () => undefined },
    authorizeProjectRequest: authorize, authorizeProjectToolRequest: async (_res, projectId) => ({ projectId }), resources: { listAllSkills: async () => catalogSkills as never },
  });
  const start = vi.fn();
  app.post('/api/runs', (req, res) => { start(req.body); res.status(202).json({ runId: 'chat-1' }); });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (url: string, method = 'GET', body?: unknown) => fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    expect(await (await request('/api/recipes?surface=code')).json()).toMatchObject([{ id: 'test-code', verified: false }]);
    expect(await (await request('/api/recipes/test-code')).json()).toMatchObject({ id: 'test-code', verified: false });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runRecipeCli(['list', '--json', '--daemon-url', base]);
      expect(JSON.parse(String(output.mock.calls.at(-1)![0]))).toMatchObject([{ id: 'test-code', verified: false }]);
      await runRecipeCli(['show', 'test-code', '--json', '--daemon-url', base]);
      expect(JSON.parse(String(output.mock.calls.at(-1)![0]))).toMatchObject({ id: 'test-code', verified: false });
    } finally { output.mockRestore(); }
    const prefix = '/api/projects/p/characters';
    expect((await request(prefix, 'POST', { slug: 'fox', name: 'Fox', description: 'Orange fox' })).status).toBe(201);
    expect(await (await request(`${prefix}/fox`)).json()).toMatchObject({ slug: 'fox' });
    expect((await request(`${prefix}/fox`, 'PUT', { style: 'pixel' })).status).toBe(200);
    expect(await (await request(`${prefix}/fox`, 'DELETE')).json()).toEqual({ deleted: true });
    const blocked = await request('/api/projects/p/recipe-runs', 'POST', { recipeId: 'test-code' });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ query: 'Build a unknown game', missingSkills: ['required-skill'], status: 'missing-skills' });
    expect(start).not.toHaveBeenCalled();
    // A catalog (bundled) skill that is not enabled in the project rides along instead of blocking.
    catalogSkills.push({ id: 'required-skill' });
    const started = await request('/api/projects/p/recipe-runs', 'POST', { recipeId: 'test-code' });
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual({ runId: 'chat-1', query: 'Build a unknown game', missingSkills: [], status: 'started' });
    expect(start).toHaveBeenCalledWith({ projectId: 'p', message: 'Build a unknown game', skillIds: ['required-skill'] });
    expect(authorize).toHaveBeenCalled();

    const dualDir = path.join(bundled, 'recipes', 'test-dual');
    await mkdir(dualDir);
    // A recipe for two engines names each engine's skill; only the project's engine's one rides along.
    await writeFile(path.join(dualDir, 'pixo.json'), JSON.stringify({ ...manifest, name: 'test-dual', pixo: {
      ...manifest.pixo, recipe: { ...manifest.pixo.recipe, engines: ['godot', 'phaser'] },
      context: { skills: [{ ref: 'required-skill' }, { ref: 'godot-only' }, { ref: 'phaser-only' }] },
    } }));
    catalogSkills.push({ id: 'godot-only', engines: ['godot'] }, { id: 'phaser-only', engines: ['phaser'] });
    for (const engine of ['godot', 'phaser'] as const) {
      const engineRoot = path.join(root, engine);
      await mkdir(engineRoot);
      await writeFile(path.join(engineRoot, engine === 'godot' ? 'project.godot' : 'package.json'),
        engine === 'godot' ? 'config_version=5\n' : JSON.stringify({ dependencies: { phaser: '3.90.0' } }));
      insertProject(db, { id: engine, name: engine, createdAt: 1, updatedAt: 1, metadata: {
        baseDir: engineRoot, engineProfile: detectEngineProfile(engineRoot, { resolveOnPath: () => null }),
      } });
      const summaries = await (await request(`/api/recipes?surface=code&category=feature&engine=${engine}`)).json();
      expect(summaries).toMatchObject([{ id: 'test-code' }, { id: 'test-dual', engines: ['godot', 'phaser'] }]);
      const output = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await runRecipeCli(['list', '--surface', 'code', '--category', 'feature', '--engine', engine, '--json', '--daemon-url', base]);
        expect(JSON.parse(String(output.mock.calls.at(-1)![0]))).toEqual(summaries);
        await runRecipeCli(['run', 'test-dual', '--project', engine, '--json', '--daemon-url', base]);
        expect(JSON.parse(String(output.mock.calls.at(-1)![0]))).toMatchObject({ status: 'started', query: `Build a ${engine} game` });
        expect(start).toHaveBeenLastCalledWith({ projectId: engine, message: `Build a ${engine} game`, skillIds: ['required-skill', `${engine}-only`] });
      } finally { output.mockRestore(); }
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await executor.initialized; db.close();
    if (!path.resolve(root).startsWith(path.join(tmpdir(), 'recipe-routes-'))) throw new Error('Unsafe cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});
