import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerSocialShareRoutes, type RegisterSocialShareRoutesDeps } from '../../src/routes/social-share.js';

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerSocialShareRoutes(app, {
    http: { sendApiError: (res, status, code, message) => res.status(status).json({ code, message }) },
  } as RegisterSocialShareRoutesDeps);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing listener address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('project URL sharing API', () => {
  it('returns share links for the user’s deployed project', async () => {
    const response = await fetch(`${base}/api/social-share`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'project-html', url: 'https://example.com/game' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: 'project-html', url: 'https://example.com/game' });
  });

  it.each([
    { url: 'https://example.com/game' },
    { kind: 'retired', url: 'https://example.com/game' },
    { kind: 'project-html', url: 'javascript:alert(1)' },
  ])('rejects a missing or unsupported kind or unsafe URL: %j', async body => {
    const response = await fetch(`${base}/api/social-share`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'BAD_REQUEST' });
  });
});
