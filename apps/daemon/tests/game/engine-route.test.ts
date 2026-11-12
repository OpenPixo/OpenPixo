import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppConfigResponse, EngineProfileResponse, ProjectResponse } from '@openpixo/contracts';
import { afterEach, expect, it } from 'vitest';
import { startServer } from '../../src/server.js';

let server: http.Server | undefined;
let folder: string | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (folder) await rm(folder, { recursive: true, force: true });
});

it('lazily persists, caches and refreshes the profile, and rejects client-owned engineProfile metadata', async () => {
  const started = await startServer({ port: 0, returnServer: true }) as { url: string; server: http.Server };
  server = started.server;
  const base = started.url;
  folder = await mkdtemp(path.join(tmpdir(), 'openpixo-engine-'));
  await writeFile(path.join(folder, 'project.godot'), 'config_version=5\nconfig/features=PackedStringArray("4.3")\n');
  const request = (url: string, method = 'GET', body?: unknown) => fetch(`${base}${url}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: base },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const imported = await request('/api/import/folder', 'POST', { baseDir: folder });
  expect(imported.status).toBe(200);
  const { project } = await imported.json() as ProjectResponse;
  const endpoint = `/api/projects/${project.id}`;
  const firstResponse = await request(`${endpoint}/engine`);
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json() as EngineProfileResponse;
  expect(first.profile).toMatchObject({ engine: 'godot', engineVersion: '4.3' });

  // PATCH follows the same startServer/import harness as the baseDir rejection tests.
  for (const engineProfile of [first.profile, null, {}]) {
    const rejected = await request(endpoint, 'PATCH', { metadata: { kind: 'prototype', engineProfile } });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: 'BAD_REQUEST', message: 'engineProfile is daemon-owned' } });
  }
  const preserved = await request(endpoint, 'PATCH', { metadata: { kind: 'prototype', linkedDirs: [] } });
  expect(preserved.status).toBe(200);
  expect((await preserved.json() as ProjectResponse).project.metadata?.engineProfile).toEqual(first.profile);

  await writeFile(path.join(folder, 'project.godot'), 'config_version=5\nconfig/features=PackedStringArray("4.4")\n');
  expect((await (await request(`${endpoint}/engine`)).json() as EngineProfileResponse).profile).toEqual(first.profile);
  const saved = await request('/api/app-config', 'PUT', { gameEnginePaths: { godot: process.execPath, unity: '', unwanted: 'ignored' } });
  expect(saved.status).toBe(200);
  expect((await (await request('/api/app-config')).json() as AppConfigResponse).config.gameEnginePaths).toEqual({ godot: process.execPath });
  const refreshed = await request(`${endpoint}/engine/refresh`, 'POST');
  expect(refreshed.status).toBe(200);
  expect((await refreshed.json() as EngineProfileResponse).profile).toMatchObject({ engineVersion: '4.4',
    tools: [{ id: 'godot', resolved: true, source: 'settings' }] });
  const created = await request('/api/projects', 'POST', { id: randomUUID(), name: 'Not a game', metadata: { kind: 'prototype' } });
  expect(created.status).toBe(200);
  const ordinary = await created.json() as ProjectResponse;
  expect((await request(`/api/projects/${ordinary.project.id}/engine`)).status).toBe(400);
  expect((await request('/api/projects/missing-engine-fixture/engine')).status).toBe(404);
});

it('keeps the hidden starter checklist preference through unrelated metadata patches and accepts explicit false', async () => {
  const started = await startServer({ port: 0, returnServer: true }) as { url: string; server: http.Server };
  server = started.server;
  const base = started.url;
  const request = (url: string, method = 'GET', body?: unknown) => fetch(`${base}${url}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: base },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const created = await request('/api/projects', 'POST', { id: randomUUID(), name: 'Starter preference', metadata: { kind: 'prototype', starterChecklistDismissed: true } });
  expect(created.status).toBe(200);
  const { project } = await created.json() as ProjectResponse;
  const endpoint = `/api/projects/${project.id}`;
  const unrelated = await request(endpoint, 'PATCH', { metadata: { kind: 'prototype', imageModel: 'saved-model' } });
  expect(unrelated.status).toBe(200);
  expect((await unrelated.json() as ProjectResponse).project.metadata).toMatchObject({ imageModel: 'saved-model', starterChecklistDismissed: true });
  expect((await (await request(endpoint)).json() as ProjectResponse).project.metadata?.starterChecklistDismissed).toBe(true);
  const shown = await request(endpoint, 'PATCH', { metadata: { kind: 'prototype', starterChecklistDismissed: false } });
  expect(shown.status).toBe(200);
  expect((await shown.json() as ProjectResponse).project.metadata?.starterChecklistDismissed).toBe(false);
  const again = await request(endpoint, 'PATCH', { metadata: { kind: 'prototype', imageModel: 'another-model' } });
  expect(again.status).toBe(200);
  expect((await again.json() as ProjectResponse).project.metadata?.starterChecklistDismissed).toBe(false);
});
