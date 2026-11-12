import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { GetMediaCapabilitiesResponse, Recipe } from '@openpixo/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as xaiTokens from '../../src/integrations/xai-tokens.js';
import { readMaskedConfig, type MaskedConfigResponse } from '../../src/media/config.js';
import { AUDIO_MODELS_BY_KIND, hostedAudioKind, MEDIA_PROVIDERS, type MediaModel } from '../../src/media/models.js';
import { configuredRecipeProviders, modelsForRecipe, RecipeNoModelError, selectRecipeModel } from '../../src/recipes/models.js';
import { registerMediaRoutes } from '../../src/routes/media.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'pixo-media-capabilities-'));
  roots.push(root);
  return root;
}

function noop() {}

function functionProxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      return property in target ? target[property as string] : noop;
    },
  });
}

function model(id: string, provider: string, caps: string[]): MediaModel {
  return { id, provider, caps, label: id, hint: '' };
}

const imageModels = [
  model('gateway-image', 'media-gateway', ['t2i', 'i2i']),
  model('gateway-image-2', 'media-gateway', ['t2i']),
  model('openai-image', 'openai', ['t2i']),
  model('custom-image', 'custom-image', ['t2i', 'i2i']),
  model('planned-image', 'replicate', ['t2i']),
  model('stub-image', 'stub', ['t2i']),
];
const videoModels = [
  model('gateway-video', 'media-gateway', ['t2v', 'i2v']),
  model('hyperframes-video', 'hyperframes', ['t2v']),
];
const audioModels = {
  music: [model('gateway-music', 'media-gateway', ['music'])],
  speech: [model('elevenlabs-speech', 'elevenlabs', ['tts'])],
  sfx: [],
};

function provider(
  overrides: Partial<MaskedConfigResponse['providers'][string]> = {},
): MaskedConfigResponse['providers'][string] {
  return { configured: true, source: 'stored', apiKeyTail: 'tail-secret', baseUrl: '', ...overrides };
}

function config(providers: MaskedConfigResponse['providers'] = {}): MaskedConfigResponse {
  return { providers, aliases: { effective: {}, env: {}, stored: {} } };
}

async function capabilitiesResponse(
  readConfig: typeof readMaskedConfig = vi.fn(async () => config()),
  audio: typeof audioModels = audioModels,
) {
  const root = await temporaryRoot();
  const dataRoot = await temporaryRoot();
  const handlers = new Map<string, RequestHandler>();
  const app = new Proxy({}, {
    get: (_target, method) => (route: string, ...routeHandlers: RequestHandler[]) => {
      if (method === 'get') handlers.set(route, routeHandlers.at(-1)!);
    },
  }) as Express;
  const deps = {
    db: {},
    design: functionProxy(),
    http: {
      sendApiError: noop,
      requireLocalDaemonRequest: noop,
      isLocalSameOrigin: () => true,
      resolvedPortRef: { current: 0 },
    },
    paths: { PROJECT_ROOT: root, PROJECTS_DIR: root, RUNTIME_DATA_DIR: dataRoot },
    ids: { randomUUID: () => 'unused' },
    auth: functionProxy(),
    media: functionProxy({
      MEDIA_PROVIDERS,
      IMAGE_MODELS: imageModels,
      VIDEO_MODELS: videoModels,
      MODEL3D_MODELS: [model('gateway-3d', 'media-gateway', ['image-to-3d'])],
      AUDIO_MODELS_BY_KIND: audio,
      readMaskedConfig: readConfig,
    }),
    appConfig: functionProxy(),
    nativeDialogs: functionProxy(),
    projectStore: functionProxy(),
    projectFiles: functionProxy(),
    conversations: functionProxy(),
    research: functionProxy(),
    authorizeProjectRequest: async () => true,
    authorizeProjectToolRequest: async () => true,
  } as unknown as Parameters<typeof registerMediaRoutes>[1];
  registerMediaRoutes(app, deps);
  const handler = handlers.get('/api/media/capabilities');
  if (!handler) throw new Error('media capabilities route was not registered');
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, unknown>();
  const response = {
    status(code: number) { statusCode = code; return this; },
    setHeader(name: string, value: unknown) { headers.set(name.toLowerCase(), value); return this; },
    json(value: unknown) { body = value; return this; },
  };
  await handler({} as Request, response as unknown as Response, noop);
  return { root, dataRoot, statusCode, headers, body: body as GetMediaCapabilitiesResponse };
}

describe('hosted audio and recipes', () => {
  // A recipe run carries no quote, so credits alone must not look like an audio provider.
  it('does not make a credit-only user look configured for audio', async () => {
    const readConfig = vi.fn(async () => config({ openpixo: provider() }));
    const response = await capabilitiesResponse(readConfig, AUDIO_MODELS_BY_KIND as typeof audioModels);
    expect(response.body.capabilities.sfx).toEqual({ configured: false, providers: [] });
    expect(response.body.capabilities.tts).toEqual({ configured: false, providers: [] });
    expect(response.body.capabilities.music).toEqual({ configured: false, providers: [] });
  });

  it('never lets a recipe select a hosted audio model, even when asked for by name', () => {
    const available = configuredRecipeProviders(config({ openpixo: provider() }), false);
    expect(available.has('openpixo')).toBe(false);
    const recipe = { surface: 'audio', models: { recommended: ['openpixo-sfx'] } } as unknown as Recipe;
    for (const id of ['openpixo-sfx', 'openpixo-voice', 'openpixo-music']) {
      expect(() => selectRecipeModel(recipe, modelsForRecipe(recipe), available, id)).toThrow(RecipeNoModelError);
    }
    expect(() => selectRecipeModel(recipe, modelsForRecipe(recipe), new Set(['elevenlabs']))).not.toThrow();
    expect(selectRecipeModel(recipe, modelsForRecipe(recipe), new Set(['elevenlabs'])).provider).toBe('elevenlabs');
  });

  it('never lets a recipe select the hosted 3D model, and still finds one on a user\'s own key', () => {
    const recipe = { surface: 'model3d', models: { requires: ['image-to-3d'], recommended: ['openpixo-model3d'] } } as unknown as Recipe;
    expect(modelsForRecipe(recipe).map(model => model.id)).not.toContain('openpixo-model3d');
    // Even with the provider present, by name or by preference.
    expect(() => selectRecipeModel(recipe, modelsForRecipe(recipe), new Set(['openpixo']), 'openpixo-model3d')).toThrow(RecipeNoModelError);
    expect(() => selectRecipeModel(recipe, modelsForRecipe(recipe), configuredRecipeProviders(config({ openpixo: provider() }), false))).toThrow(RecipeNoModelError);
    expect(selectRecipeModel(recipe, modelsForRecipe(recipe), new Set(['media-gateway'])).provider).toBe('media-gateway');
  });

  it('gives each hosted audio model the kind and neutral naming the catalogue promises', () => {
    expect(hostedAudioKind('openpixo-sfx')).toBe('sfx');
    expect(hostedAudioKind('openpixo-voice')).toBe('speech');
    expect(hostedAudioKind('openpixo-music')).toBe('music');
    expect(hostedAudioKind('openpixo-image')).toBeNull();
    expect(hostedAudioKind('elevenlabs-sfx')).toBeNull();
    const hosted = Object.values(AUDIO_MODELS_BY_KIND).flat().filter((entry) => entry.provider === 'openpixo');
    expect(hosted.map((entry) => entry.id).sort()).toEqual(['openpixo-music', 'openpixo-sfx', 'openpixo-voice']);
    for (const entry of hosted) {
      expect(entry.default).toBeUndefined();
      expect(`${entry.label} ${entry.hint}`).not.toMatch(/\bfal\b|elevenlabs|minimax/iu);
    }
  });
});

describe('GET /api/media/capabilities', () => {
  it('reports every catalogue capability as unconfigured when no providers are configured', async () => {
    const readConfig = vi.fn(async () => config());
    const response = await capabilitiesResponse(readConfig);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ capabilities: {
      t2i: { configured: false, providers: [] },
      i2i: { configured: false, providers: [] },
      t2v: { configured: false, providers: [] },
      i2v: { configured: false, providers: [] },
      'image-to-3d': { configured: false, providers: [] },
      music: { configured: false, providers: [] },
      tts: { configured: false, providers: [] },
    } });
    expect(readConfig).toHaveBeenCalledOnce();
    // The Generate panel waits on this read: it must never launch an agent CLI to answer.
    expect(readConfig).toHaveBeenCalledWith(response.root, {
      refreshCredentials: false,
      cachedAgentDetection: true,
      dataDir: response.dataRoot,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('only covers capabilities supplied by configured providers and deduplicates provider IDs', async () => {
    const response = await capabilitiesResponse(vi.fn(async () => config({
      'media-gateway': provider(),
      openai: provider(),
      elevenlabs: provider({ configured: false, source: 'unset' }),
    })));

    expect(response.body).toEqual({ capabilities: {
      t2i: { configured: true, providers: ['media-gateway', 'openai'] },
      i2i: { configured: true, providers: ['media-gateway'] },
      t2v: { configured: true, providers: ['media-gateway'] },
      i2v: { configured: true, providers: ['media-gateway'] },
      'image-to-3d': { configured: true, providers: ['media-gateway'] },
      music: { configured: true, providers: ['media-gateway'] },
      tts: { configured: false, providers: [] },
    } });
  });

  it('accepts a custom image base URL without requiring an API key', async () => {
    const response = await capabilitiesResponse(vi.fn(async () => config({
      'custom-image': provider({ configured: false, source: 'unset', baseUrl: 'http://127.0.0.1:4321/v1' }),
    })));

    expect(response.body.capabilities.t2i).toEqual({ configured: true, providers: ['custom-image'] });
    expect(response.body.capabilities.i2i).toEqual({ configured: true, providers: ['custom-image'] });
    expect(response.body.capabilities.music).toEqual({ configured: false, providers: [] });
  });

  it('does not count planned providers, local HyperFrames rendering, or the test stub', async () => {
    const response = await capabilitiesResponse(vi.fn(async () => config({
      replicate: provider(),
      hyperframes: provider(),
      stub: provider(),
    })));

    expect(Object.values(response.body.capabilities)).toEqual(
      Array.from({ length: 7 }, () => ({ configured: false, providers: [] })),
    );
  });

  it('returns only boolean status and provider IDs, without masked configuration details', async () => {
    const response = await capabilitiesResponse(vi.fn(async () => config({
      'media-gateway': provider({
        apiKeyTail: 'private-key-tail',
        source: 'private-source',
        baseUrl: 'https://user:private-password@provider.invalid/v1?api_key=private-query',
        model: 'private-model',
      }),
    })));

    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('private-');
    for (const capability of Object.values(response.body.capabilities)) {
      expect(Object.keys(capability).sort()).toEqual(['configured', 'providers']);
      expect(typeof capability.configured).toBe('boolean');
      expect(capability.providers.every((id) => typeof id === 'string')).toBe(true);
    }
  });

  it('does not return credential details if reading configuration fails', async () => {
    const response = await capabilitiesResponse(vi.fn(async () => {
      throw new Error('credential=private-secret https://user:password@provider.invalid');
    }));

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'Unable to read media capabilities' });
  });
});

describe('media configuration status without credential refresh', () => {
  it.each([
    { label: 'fresh access token', expired: false, refreshToken: '', configured: true },
    { label: 'expired renewable token', expired: true, refreshToken: 'refresh-secret', configured: true },
    { label: 'expired token without renewal', expired: true, refreshToken: '', configured: false },
  ])('reports $label without provider calls or token writes', async ({ expired, refreshToken, configured }) => {
    const root = await temporaryRoot();
    vi.stubEnv('PIXO_DATA_DIR', root);
    vi.stubEnv('PIXO_MEDIA_CONFIG_DIR', root);
    vi.stubEnv('PIXO_SANDBOX_MODE', '1');
    vi.stubEnv('PIXO_GROK_API_KEY', '');
    vi.stubEnv('XAI_API_KEY', '');
    const fetchSpy = vi.fn(() => { throw new Error('unexpected provider call'); });
    vi.stubGlobal('fetch', fetchSpy);
    await xaiTokens.setXAIToken(root, {
      accessToken: 'access-secret',
      refreshToken,
      expiresAt: Date.now() + (expired ? -1_000 : 3_600_000),
      tokenType: 'Bearer',
      savedAt: Date.now(),
    });
    const tokenPath = path.join(root, 'xai-tokens.json');
    const before = await readFile(tokenPath, 'utf8');

    const result = await readMaskedConfig(root, { refreshCredentials: false });

    expect(result.providers.grok).toEqual({
      configured,
      source: configured ? 'oauth-xai-stored' : 'unset',
      apiKeyTail: '',
      baseUrl: '',
    });
    expect(JSON.stringify(result)).not.toContain('access-secret');
    expect(JSON.stringify(result)).not.toContain('refresh-secret');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await readFile(tokenPath, 'utf8')).toBe(before);
  });

  it('reads native xAI tokens from the explicit data root when the media config directory is overridden', async () => {
    const projectRoot = await temporaryRoot();
    const dataRoot = await temporaryRoot();
    const mediaConfigRoot = await temporaryRoot();
    vi.stubEnv('PIXO_DATA_DIR', dataRoot);
    vi.stubEnv('PIXO_MEDIA_CONFIG_DIR', mediaConfigRoot);
    vi.stubEnv('PIXO_SANDBOX_MODE', '1');
    vi.stubEnv('PIXO_GROK_API_KEY', '');
    vi.stubEnv('XAI_API_KEY', '');
    const fetchSpy = vi.fn(() => { throw new Error('unexpected provider call'); });
    vi.stubGlobal('fetch', fetchSpy);
    await xaiTokens.setXAIToken(dataRoot, {
      accessToken: 'explicit-root-access-secret',
      refreshToken: 'explicit-root-refresh-secret',
      expiresAt: Date.now() - 1_000,
      tokenType: 'Bearer',
      savedAt: Date.now(),
    });
    const getTokenSpy = vi.spyOn(xaiTokens, 'getXAIToken');

    const result = await readMaskedConfig(projectRoot, {
      refreshCredentials: false,
      dataDir: dataRoot,
    });

    expect(result.providers.grok).toEqual({
      configured: true,
      source: 'oauth-xai-stored',
      apiKeyTail: '',
      baseUrl: '',
    });
    expect(getTokenSpy).toHaveBeenCalledWith(dataRoot);
    expect(getTokenSpy).not.toHaveBeenCalledWith(mediaConfigRoot);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('explicit-root-');
  });
});
