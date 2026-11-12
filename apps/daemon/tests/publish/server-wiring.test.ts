import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ProjectResponse, PublishStatusResponse, RoomsInstallResponse, RoomsTestResponse } from '@openpixo/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startServer } from '../../src/server.js';

/** The real server: registration order and path wiring, which the route tests cannot see. */
let server: http.Server;
let base: string;
let folder: string;
let projectId: string;

const request = (url: string, method = 'GET', body?: unknown, origin = base) => fetch(`${base}${url}`, {
  method, headers: { 'Content-Type': 'application/json', Origin: origin },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeAll(async () => {
  const started = await startServer({ port: 0, returnServer: true }) as { url: string; server: http.Server };
  server = started.server;
  base = started.url;
  folder = await mkdtemp(path.join(tmpdir(), 'openpixo-publish-wiring-'));
  await writeFile(path.join(folder, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { phaser: '3.90.0' } }));
  await writeFile(path.join(folder, 'index.html'), '<canvas></canvas>');
  await writeFile(path.join(folder, 'tsconfig.json'), '{}');
  await mkdir(path.join(folder, 'src'));
  const imported = await request('/api/import/folder', 'POST', { baseDir: folder });
  expect(imported.status).toBe(200);
  projectId = (await imported.json() as ProjectResponse).project.id;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
  await rm(folder, { recursive: true, force: true });
});

it('answers a game page on a dev-server origin at the relay and nowhere else', async () => {
  const devServer = 'http://127.0.0.1:5173';
  const created = await request('/api/rooms/local/rooms', 'POST', { v: 1 }, devServer);
  expect(created.status).toBe(200);
  expect(created.headers.get('access-control-allow-origin')).toBe(devServer);
  expect(await created.json()).toMatchObject({ ok: true, maxPlayers: 8 });
  expect((await request('/api/projects', 'GET', undefined, 'https://evil.example')).status).toBe(403);
  expect((await request('/api/rooms/local/rooms', 'POST', { v: 1 }, 'https://evil.example')).status).toBe(403);
});

it('leaves the JSON parser working for the routes after the relay', async () => {
  const response = await request(`/api/projects/${projectId}/rooms/test`, 'POST', { gameUrl: 'http://127.0.0.1:5173/' });
  expect(response.status).toBe(200);
  const { urls, relayUrl } = await response.json() as RoomsTestResponse;
  expect(relayUrl).toBe(`${base.replace('localhost', '127.0.0.1')}/api/rooms/local`);
  expect(new URL(urls[0]).searchParams.get('pixoRooms')).toBe(relayUrl);
  expect(urls[1]).toBe(urls[0]);
});

it('copies the SDK from the repository resource folder', async () => {
  const response = await request(`/api/projects/${projectId}/rooms/install`, 'POST', {});
  expect(await response.json()).toEqual({ sdkPath: 'src/openpixo-rooms.ts', changed: true } satisfies RoomsInstallResponse);
  expect(await readFile(path.join(folder, 'src', 'openpixo-rooms.ts'), 'utf8')).toContain('export async function joinFromUrl');
});

it('reports a build with no cloud in plain terms', async () => {
  expect(await (await request(`/api/projects/${projectId}/publish`)).json() as PublishStatusResponse).toMatchObject({ available: false, unavailableReason: 'no_cloud' });
  const started = await request(`/api/projects/${projectId}/publish`, 'POST', {});
  expect(started.status).toBe(503);
  expect(await started.json()).toMatchObject({ error: { code: 'ACCOUNT_NOT_CONFIGURED' } });
});

it('does not let a client set the share id', async () => {
  const patched = await request(`/api/projects/${projectId}`, 'PATCH', { metadata: { kind: 'prototype', publishShareId: 'someone-elses' } });
  expect(patched.status).toBe(400);
  expect(await patched.json()).toMatchObject({ error: { message: 'publishShareId is daemon-owned' } });
  const created = await request('/api/projects', 'POST', { id: randomUUID(), name: 'x', metadata: { kind: 'prototype', publishShareId: 'someone-elses' } });
  expect(created.status).toBe(400);
});
