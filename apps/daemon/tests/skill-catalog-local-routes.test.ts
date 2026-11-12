import type { Server } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

// The catalog now belongs to one local user. Exercise its HTTP read/delete
// boundary with real files, without workspace bindings or cloud credentials.
describe('local skill catalog routes', () => {
  let server: Server | undefined;
  let shutdown: (() => Promise<void> | void) | undefined;
  let url: string;
  const id = 'local-catalog-route-fixture';
  const body = 'Local skill instructions.\n';

  beforeAll(async () => {
    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string; server: Server; shutdown?: () => Promise<void> | void;
    };
    ({ url, server, shutdown } = started);
    const folder = path.join(process.env.PIXO_DATA_DIR!, 'skills', id);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'SKILL.md'),
      `---\nname: ${id}\ndescription: Local route fixture.\n---\n\n${body}`);
  });

  afterAll(async () => {
    await shutdown?.();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  });

  it('lists and reads the local file without a workspace identity', async () => {
    const listing = await fetch(`${url}/api/skills`);
    expect(listing.status).toBe(200);
    const { skills } = await listing.json() as { skills: Array<Record<string, unknown>> };
    const summary = skills.find(skill => skill.id === id);
    expect(summary).toMatchObject({ id, source: 'user', hasBody: true });
    expect(summary).not.toHaveProperty('dir');
    expect(summary).not.toHaveProperty('body');
    const detail = await fetch(`${url}/api/skills/${id}`);
    expect(detail.status).toBe(200);
    const skill = await detail.json();
    expect(skill).toMatchObject({ id, body: expect.stringContaining(body.trim()) });
    expect(skill).not.toHaveProperty('dir');
  });

  it('keeps local-origin protection for mutation', async () => {
    const response = await fetch(`${url}/api/skills/${id}`, {
      method: 'DELETE', headers: { Origin: 'https://untrusted.invalid' },
    });
    expect(response.status).toBe(403);
    expect((await fetch(`${url}/api/skills/${id}`)).status).toBe(200);
  });

  it('deletes the local skill and returns a missing-resource response afterward', async () => {
    const response = await fetch(`${url}/api/skills/${id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect((await fetch(`${url}/api/skills/${id}`)).status).toBe(404);
    const { skills } = await (await fetch(`${url}/api/skills`)).json() as { skills: Array<{ id: string }> };
    expect(skills.some(skill => skill.id === id)).toBe(false);
  });
});
