
import { rm } from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerProjectRoutes } from '../../src/routes/project/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const WEB_PROTOTYPE_DIR = path.join(
  REPO_ROOT,
  'plugins',
  '_official',
  'examples',
  'web-prototype',
);
const EXAMPLE_PLUGIN_ID = 'example-web-prototype';

const servers: http.Server[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

function noop() {}

function functionProxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      return property in target ? target[property as string] : noop;
    },
  });
}

function buildDeps(input: {
  insertProject: ReturnType<typeof vi.fn>;
  getLocalPluginBySource?: ReturnType<typeof vi.fn>;
  existingMetadata?: Record<string, unknown> | null;
  updateProject?: ReturnType<typeof vi.fn>;
}) {
  return {
    db: {
      transaction: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => fn(...args),
    },
    design: {},
    http: {
      createSseResponse: noop,
      sendApiError: (
        res: express.Response,
        status: number,
        code: string,
        message: string,
      ) => res.status(status).json({ error: { code, message } }),
    },
    paths: {
      PROJECTS_DIR: '',
      SKILLS_DIR: '',
    },
    projectStore: functionProxy({
      insertProject: input.insertProject,
      updateProject: input.updateProject ?? vi.fn(),
      // The route 404s on a falsy updateProject result, so a stub that
      // returns nothing would hide every real assertion below it.
      validateLinkedDirs: () => ({ dirs: [] }),
      getProject: () => ({
        id: 'example-project',
        name: 'Example project',
        skillId: null,
        metadata: input.existingMetadata ?? null,
        createdAt: 1,
        updatedAt: 1,
      }),
      getWorkspaceProject: () => null,
      getWorkspaceProjectByProjectId: () => null,
      listWorkspaceProjects: () => [],
      listProjects: () => [],
    }),
    projectFiles: functionProxy({
      listFiles: () => [],
      listTabs: () => [],
      resolveProjectDir: () => '',
    }),
    conversations: functionProxy({ insertConversation: vi.fn() }),
    templates: functionProxy({ listTemplates: () => [] }),
    status: functionProxy({
      listLatestProjectRunStatuses: () => new Map(),
      listProjectsAwaitingInput: () => new Set(),
      listProjects: () => [],
      listUnboundProjects: () => [],
    }),
    events: functionProxy({ activeProjectEventSinks: new Map() }),
    ids: { randomId: () => 'conversation-id' },
    telemetry: { },
    appConfig: { readAppConfig: async () => ({}), writeAppConfig: noop },
    agents: {},
    validation: {
      validateProjectSkillId: vi.fn(async (id: string) => ({ ok: true, id })),
    },
    collabSync: functionProxy(),
    authorizeProjectRequest: vi.fn(async () => true),
    fetchProjectCreationWorkspaceDirectory: vi.fn(async () => ({ ok: false, items: [] })),
    pluginScope: {
      loadRegistry: vi.fn(async () => ({
        skills: [],
        atoms: [],
        scenarios: [],
      })),
      getPlugin: vi.fn(async () => ({})),
      ...(input.getLocalPluginBySource
        ? { getLocalPluginBySource: input.getLocalPluginBySource }
        : {}),
    },
  } as unknown as Parameters<typeof registerProjectRoutes>[1];
}

async function start(deps: Parameters<typeof registerProjectRoutes>[1]) {
  const app = express();
  app.use(express.json());
  registerProjectRoutes(app, deps);
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

describe('PATCH /api/projects/:id keeps the example binding daemon-owned', () => {
  const exampleBinding = {
    schemaVersion: 1,
    provenance: 'example_card',
    pluginId: EXAMPLE_PLUGIN_ID,
    pluginSource: WEB_PROTOTYPE_DIR,
    manifestSourceDigest: `sha256:${'a'.repeat(64)}`,
    boundAt: 42,
  };

  it('preserves the binding through a metadata patch that omits it', async () => {
    const updateProject = vi.fn((
      _db: unknown,
      id: string,
      patch: Record<string, unknown>,
    ) => ({ id, ...patch }));
    const baseUrl = await start(buildDeps({
      insertProject: vi.fn(),
      updateProject,
      existingMetadata: { kind: 'prototype', exampleBinding },
    }));

    const response = await fetch(`${baseUrl}/api/projects/example-project`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metadata: { kind: 'prototype' } }),
    });

    expect(response.status).toBe(200);
    expect(updateProject).toHaveBeenCalledWith(
      expect.anything(),
      'example-project',
      expect.objectContaining({
        metadata: expect.objectContaining({ exampleBinding }),
      }),
    );
  });

  it('rejects a patch that rewrites or clears the binding', async () => {
    const updateProject = vi.fn((
      _db: unknown,
      id: string,
      patch: Record<string, unknown>,
    ) => ({ id, ...patch }));
    const baseUrl = await start(buildDeps({
      insertProject: vi.fn(),
      updateProject,
      existingMetadata: { kind: 'prototype', exampleBinding },
    }));

    for (const body of [
      { metadata: { kind: 'prototype', exampleBinding: { ...exampleBinding, pluginId: 'other' } } },
      { metadata: null },
    ]) {
      const response = await fetch(`${baseUrl}/api/projects/example-project`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(updateProject).not.toHaveBeenCalled();
  });
});
