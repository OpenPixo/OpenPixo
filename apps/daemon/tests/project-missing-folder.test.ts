import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EngineProfileResponse, ProjectResponse } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServer } from '../src/server.js';

// The starter checklist's environment facts probe local tools; they say nothing
// about the project folder.
vi.mock('../src/doctor/checks.js', async () => ({
  ...(await vi.importActual<typeof import('../src/doctor/checks.js')>('../src/doctor/checks.js')),
  checkEnvironment: vi.fn(async () => ({ checks: [] })),
}));

const ABSOLUTE_PATH = /[A-Za-z]:[\\/]|(?:^|["'\s])\/(?:[\w.-]+\/)+/;

let server: http.Server;
let base: string;
const folders: string[] = [];

beforeEach(async () => {
  const started = await startServer({ port: 0, returnServer: true }) as { url: string; server: http.Server };
  server = started.server;
  base = started.url;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

function request(url: string, method = 'GET', body?: unknown) {
  return fetch(`${base}${url}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: base },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A project as `POST /api/projects` leaves it: a row, and no folder until the first write. */
async function createProject(): Promise<string> {
  const created = await request('/api/projects', 'POST', { id: randomUUID(), name: 'No folder yet', metadata: { kind: 'prototype' } });
  expect(created.status).toBe(200);
  return (await created.json() as ProjectResponse).project.id;
}

/** An imported project whose folder has since gone away (deleted, or a drive that is not plugged in). */
async function importThenRemoveFolder(): Promise<{ id: string; folder: string }> {
  const folder = await mkdtemp(path.join(tmpdir(), 'openpixo-missing-'));
  folders.push(folder);
  const imported = await request('/api/import/folder', 'POST', { baseDir: folder });
  expect(imported.status).toBe(200);
  const { id } = (await imported.json() as ProjectResponse).project;
  await rm(folder, { recursive: true, force: true });
  return { id, folder };
}

async function expectEmptyProjectReads(id: string) {
  const endpoint = `/api/projects/${id}`;
  const nextSteps = await request(`${endpoint}/next-steps`);
  expect(nextSteps.status).toBe(200);
  expect(await nextSteps.json()).toMatchObject({ projectId: id, engine: 'unknown', steps: expect.any(Array) });

  const tuning = await request(`${endpoint}/game/tuning`);
  expect(tuning.status).toBe(200);
  expect(await tuning.json()).toEqual({ parameters: [], warnings: [] });

  const assets = await request(`${endpoint}/assets`);
  expect(assets.status).toBe(200);
  expect(await assets.json()).toEqual({ assets: [], nextCursor: null });

  const characters = await request(`${endpoint}/characters`);
  expect(characters.status).toBe(200);
  expect(await characters.json()).toEqual([]);

  const engine = await request(`${endpoint}/engine`);
  expect(engine.status).toBe(200);
  expect((await engine.json() as EngineProfileResponse).profile.engine).toBe('unknown');
}

describe('a project whose folder does not exist yet', () => {
  it('reads as an empty project', async () => {
    await expectEmptyProjectReads(await createProject());
  });

  it('lists assets written after the first empty read', async () => {
    const id = await createProject();
    expect((await request(`/api/projects/${id}/assets`)).status).toBe(200);
    // A lookup into the missing folder fails, and must not stick to the project.
    expect((await request(`/api/projects/${id}/assets/info?path=hero.png`)).status).toBe(404);

    const written = await request(`/api/projects/${id}/files`, 'POST', { name: 'hero.png', content: 'not really a png' });
    expect(written.status).toBe(200);

    const assets = await request(`/api/projects/${id}/assets`);
    expect(assets.status).toBe(200);
    expect((await assets.json() as { assets: { relPath: string }[] }).assets.map(asset => asset.relPath)).toEqual(['hero.png']);
    const nextSteps = await request(`/api/projects/${id}/next-steps`);
    expect(nextSteps.status).toBe(200);
  });

  it.each([
    'assets/info?path=hero.png',
    'assets/thumb?path=hero.png',
    'assets/waveform?path=hero.png',
    'assets/provenance?path=hero.png',
    'characters/hero',
    'game/install-deps',
  ])('names no absolute path when asked for %s', async (route) => {
    const id = await createProject();
    const response = await request(`/api/projects/${id}/${route}`);
    expect(await response.text()).not.toMatch(ABSOLUTE_PATH);
  });
});

describe('an imported project whose folder has gone away', () => {
  it('reads as an empty project', async () => {
    await expectEmptyProjectReads((await importThenRemoveFolder()).id);
  });

  it('answers engine reads without a path, and does not remember the empty answer', async () => {
    const { id, folder } = await importThenRemoveFolder();
    const endpoint = `/api/projects/${id}`;

    const missing = await request(`${endpoint}/engine`);
    expect(missing.status).toBe(200);
    expect((await missing.json() as EngineProfileResponse).profile.engine).toBe('unknown');

    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'project.godot'), 'config_version=5\nconfig/features=PackedStringArray("4.3")\n');
    const restored = await request(`${endpoint}/engine`);
    expect(restored.status).toBe(200);
    expect((await restored.json() as EngineProfileResponse).profile.engine).toBe('godot');
  });
});
