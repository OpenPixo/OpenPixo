import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerChatRoutes } from '../src/routes/chat.js';

let server: http.Server | null = null;

afterEach(async () => {
  if (!server) return;
  const toClose = server;
  server = null;
  await new Promise<void>((resolve) => toClose.close(() => resolve()));
});

async function startChatServer(options: {
  authorizeProjectRequest: any;
}) {
  const app = express();
  app.use(express.json());
  registerChatRoutes(app, {
    db: {},
    http: {
      createSseResponse: () => ({
        send: () => true,
        end: () => undefined,
      }),
      sendApiError: (
        res: express.Response,
        status: number,
        code: string,
        message: string,
        details?: Record<string, unknown>,
      ) => res.status(status).json({ error: code, message, ...details }),
    },
    paths: {},
    chat: {},
    agents: {},
    appConfig: { readAppConfig: async () => ({}) },
    validation: {},
    lifecycle: { isDaemonShuttingDown: () => false },
    authorizeProjectRequest: options.authorizeProjectRequest,
  } as any);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe('chat-owned project route authority', () => {
  it.each([
    {
      label: 'SenseAudio',
      path: '/api/proxy/senseaudio/stream',
    },
    {
      label: 'AIHubMix',
      path: '/api/proxy/aihubmix/stream',
    },
  ])('denies the $label BYOK tool loop before provider work for a non-creator', async ({
    path,
  }) => {
    const authorizeProjectRequest = vi.fn(
      async (_req, res: express.Response) => {
        res.status(403).json({ error: 'WORKSPACE_PROJECT_PERMISSION_DENIED' });
        return false;
      },
    );
    const api = await startChatServer({ authorizeProjectRequest });

    const response = await fetch(`${api.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: 'test-key',
        model: 'test-model',
        projectId: 'project-a',
        // Authority must run before even provider URL validation: resolving a
        // valid URL may touch DNS, and a later valid request would spend the
        // caller's key and write the generated file.
        baseUrl: 'not-a-url',
        messages: [],
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'WORKSPACE_PROJECT_PERMISSION_DENIED',
    });
    expect(authorizeProjectRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'project-a',
      { mode: 'write', capability: 'writeFiles' },
    );
  });

  it.each([
    {
      label: 'SenseAudio',
      path: '/api/proxy/senseaudio/stream',
    },
    {
      label: 'AIHubMix',
      path: '/api/proxy/aihubmix/stream',
    },
  ])('keeps the $label BYOK tool loop available when the unified gate accepts the creator or an unbound local project', async ({
    path,
  }) => {
    const authorizeProjectRequest = vi.fn(async () => true);
    const api = await startChatServer({ authorizeProjectRequest });

    const response = await fetch(`${api.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'test-key',
        model: 'test-model',
        projectId: 'legacy-project',
        baseUrl: 'not-a-url',
        messages: [],
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'BAD_REQUEST' });
    expect(authorizeProjectRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'legacy-project',
      { mode: 'write', capability: 'writeFiles' },
    );
  });
});
