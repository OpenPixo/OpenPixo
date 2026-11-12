import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { startServer } from '../../src/server.js';

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); });

it('preserves the project art style through unrelated metadata edits and validates its dedicated boundary', async () => {
  const started = await startServer({ port: 0, returnServer: true }) as { url: string; server: Server };
  server = started.server;
  const request = (endpoint: string, method = 'GET', body?: unknown) => fetch(`${started.url}${endpoint}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: started.url },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const id = randomUUID();
  expect((await request('/api/projects', 'POST', { id, name: 'Styled game', metadata: { kind: 'prototype' } })).status).toBe(200);
  expect((await request(`/api/projects/${id}/art-style`, 'PUT', { styleId: 'pixel-16-bit' })).status).toBe(200);
  const edited = await request(`/api/projects/${id}`, 'PATCH', { metadata: { kind: 'prototype', imageModel: 'preserved' } });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({ project: { metadata: { artStyleId: 'pixel-16-bit', imageModel: 'preserved' } } });
  expect((await request(`/api/projects/${id}`, 'PATCH', { metadata: { kind: 'prototype', artStyleId: 'pixel-16-bit', imageModel: 'echoed' } })).status).toBe(200);
  expect((await request(`/api/projects/${id}`, 'PATCH', { metadata: { artStyleId: 'missing' } })).status).toBe(400);
  expect((await request(`/api/projects/${id}`, 'PATCH', { metadata: null })).status).toBe(400);
  expect((await request(`/api/projects/${id}/art-style`, 'PUT', { styleId: null })).status).toBe(200);
});
