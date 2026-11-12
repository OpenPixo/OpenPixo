import type http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { OnlineInstallResponse, OnlineStatusResponse, OnlineTestResponse, ProjectResponse } from '@openpixo/contracts';
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

const emulator = async (gameUrl = 'http://127.0.0.1:5173/') =>
  (await (await request(`/api/projects/${projectId}/online/test`, 'POST', { gameUrl })).json() as OnlineTestResponse).emulatorUrl;

const post = (url: string, body: unknown, origin = 'http://127.0.0.1:5173', token?: string) => fetch(url, { method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

beforeAll(async () => {
  const started = await startServer({ port: 0, returnServer: true }) as { url: string; server: http.Server };
  server = started.server;
  base = started.url;
  folder = await mkdtemp(path.join(tmpdir(), 'openpixo-online-wiring-'));
  await writeFile(path.join(folder, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { phaser: '3.90.0' } }));
  await writeFile(path.join(folder, 'index.html'), '<canvas></canvas>');
  await writeFile(path.join(folder, 'tsconfig.json'), '{}');
  await mkdir(path.join(folder, 'src'));
  const imported = await request('/api/import/folder', 'POST', { baseDir: folder });
  expect(imported.status).toBe(200);
  projectId = (await imported.json() as ProjectResponse).project.id;
});

afterAll(async () => {
  await request(`/api/projects/${projectId}/online/data`, 'DELETE');
  server.closeAllConnections();
  await new Promise<void>(resolve => { server.close(() => resolve()); });
  await rm(folder, { recursive: true, force: true });
});

it('answers a game page on a dev-server origin at the emulator, with CORS for its token, and nowhere else', async () => {
  const devServer = 'http://127.0.0.1:5173';
  const url = await emulator();
  const preflight = await fetch(`${url}/v1`, { method: 'OPTIONS', headers: { Origin: devServer, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');
  const registered = await post(`${url}/v1`, { v: 1, op: 'register' });
  expect(registered.headers.get('access-control-allow-origin')).toBe(devServer);
  const { token } = await registered.json() as { ok: true; token: string };
  const put = await post(`${url}/v1`, { v: 1, op: 'put', collection: 'scores', data: { level: 1 }, score: 10 }, devServer, token);
  expect(await put.json()).toMatchObject({ ok: true, doc: { score: 10 } });
  expect((await (await request(`/api/projects/${projectId}/online`)).json() as OnlineStatusResponse).local).toEqual({ players: 1, collections: { scores: 1 } });
  expect((await post(`${url}/v1`, { v: 1, op: 'register' }, 'https://evil.example')).status).toBe(403);
  const unknown = await post(`${url.replace(encodeURIComponent(projectId), 'no-such-project')}/v1`, { v: 1, op: 'register' });
  expect(await unknown.json()).toMatchObject({ ok: false, error: { code: 'not-found' } });
  expect((await request(`/api/projects/${projectId}/online/data`, 'DELETE')).status).toBe(200);
});

it('answers an oversized request with too-large', async () => {
  const response = await post(`${await emulator()}/v1`, { v: 1, op: 'put', collection: 'big', data: 'x'.repeat(200_000) });
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ ok: false, error: { code: 'too-large' } });
});

it('copies the SDK from the repository resource folder and leaves the JSON parser working', async () => {
  const response = await request(`/api/projects/${projectId}/online/install`, 'POST', {});
  expect(await response.json()).toEqual({ sdkPath: 'src/openpixo-online.ts', changed: true } satisfies OnlineInstallResponse);
  expect(await readFile(path.join(folder, 'src', 'openpixo-online.ts'), 'utf8')).toContain('export const online');
  const seeded = await request(`/api/projects/${projectId}/online/seed`, 'POST', { players: 2, collection: 'teams' });
  expect(await seeded.json()).toEqual({ players: 2, docs: 2 });
});

it('reports a build with no cloud as unpublished', async () => {
  expect(await (await request(`/api/projects/${projectId}/online`)).json()).toMatchObject({ sdkInstalled: true, usage: null });
  expect((await request(`/api/projects/${projectId}/online/hosted`, 'DELETE')).status).toBe(409);
});
