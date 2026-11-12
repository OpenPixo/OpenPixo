import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAliasMap, readMaskedConfig, resolveModelAlias, resolveProviderConfig, seedProviderIfMissing, writeConfig } from '../../src/media/config.js';
import { generateMedia } from '../../src/media/index.js';

const UPSTREAM_NAME = /\bfal\b|fal\.(?:ai|run|media)|fal-ai|-fal\b/i;
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';

describe('saved media model migration', () => {
  let root: string;
  const save = (data: unknown) => writeFile(path.join(root, 'media-config.json'), JSON.stringify(data), 'utf8');
  const stored = async () => JSON.parse(await readFile(path.join(root, 'media-config.json'), 'utf8'));

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pixo-media-model-migration-'));
    vi.stubEnv('PIXO_MEDIA_CONFIG_DIR', root);
    vi.stubEnv('PIXO_DATA_DIR', root);
    vi.stubEnv('PIXO_SANDBOX_MODE', '1');
    vi.stubEnv('PIXO_MEDIA_MODEL_ALIASES', '');
    for (const key of ['PIXO_OPENAI_API_KEY', 'OPENAI_API_KEY', 'AZURE_API_KEY', 'AZURE_OPENAI_API_KEY', 'PIXO_FAL_KEY', 'FAL_KEY']) vi.stubEnv(key, '');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('reads retired provider models as successors without rewriting credentials or crossing providers', async () => {
    await save({ providers: {
      openai: { apiKey: 'test-key', model: 'gpt-image-1' },
      fal: { apiKey: 'test-gateway', model: 'veo-2-fal' },
      aihubmix: { model: 'gpt-image-1' },
      'custom-image': { model: 'gpt-image-1' },
    } });
    expect(await resolveProviderConfig(root, 'openai')).toMatchObject({ apiKey: 'test-key', model: 'gpt-image-2' });
    expect((await resolveProviderConfig(root, 'media-gateway')).model).toBe('veo-3-gateway');
    expect((await resolveProviderConfig(root, 'aihubmix')).model).toBe('gpt-image-1');
    expect((await resolveProviderConfig(root, 'custom-image')).model).toBe('gpt-image-1');
    expect((await readMaskedConfig(root)).providers.openai?.model).toBe('gpt-image-2');
    expect((await stored()).providers.openai.model).toBe('gpt-image-1');
  });

  it('persists successors when settings submit a saved retired model', async () => {
    const result = await writeConfig(root, { providers: { openai: { apiKey: 'test-key', model: 'gpt-image-1.5' } } });
    expect(result.providers.openai?.model).toBe('gpt-image-2');
    expect((await stored()).providers.openai).toMatchObject({ apiKey: 'test-key', model: 'gpt-image-2' });
  });

  it('migrates a seeded provider model', async () => {
    expect(await seedProviderIfMissing(root, 'media-gateway', { apiKey: 'test-gateway', model: 'veo-2-fal' })).toBe(true);
    expect((await stored()).providers['media-gateway'].model).toBe('veo-3-gateway');
  });

  it('answers credentials saved under the old provider id without echoing its name', async () => {
    await save({ providers: { fal: { apiKey: 'test-gateway', baseUrl: 'https://fal.run', model: 'flux-dev-fal' } } });
    expect(await resolveProviderConfig(root, 'media-gateway')).toEqual({ apiKey: 'test-gateway', baseUrl: '', model: 'flux-dev-gateway' });
    const masked = await readMaskedConfig(root);
    expect(masked.providers['media-gateway']).toMatchObject({ configured: true, baseUrl: '', model: 'flux-dev-gateway' });
    expect(JSON.stringify(masked)).not.toMatch(UPSTREAM_NAME);
  });

  it('moves a saved old id to the current one on the next save, keeping the key', async () => {
    await save({ providers: { fal: { apiKey: 'test-gateway' } } });
    await writeConfig(root, { providers: { fal: { preserveApiKey: true, baseUrl: 'https://fal.run' }, openai: { apiKey: 'test-key' } } });
    expect((await stored()).providers).toEqual({
      'media-gateway': { apiKey: 'test-gateway', baseUrl: '' },
      openai: { apiKey: 'test-key', baseUrl: '' },
    });
  });

  it('prefers an entry already saved under the current id', async () => {
    await save({ providers: { fal: { apiKey: 'old' }, 'media-gateway': { apiKey: 'current' } } });
    expect((await resolveProviderConfig(root, 'media-gateway')).apiKey).toBe('current');
  });

  it('keeps deployment aliases while explicit successor aliases and environment overrides take precedence', async () => {
    await save({ providers: {}, aliases: {
      'gpt-image-2': 'current-deployment', 'gpt-image-1': 'legacy-deployment', 'dall-e-2': 'dalle-deployment',
    } });
    expect(await resolveModelAlias(root, 'gpt-image-1')).toBe('current-deployment');
    expect(await resolveModelAlias(root, 'dall-e-2')).toBe('dalle-deployment');
    expect((await readAliasMap(root)).stored).toEqual({ 'gpt-image-2': 'current-deployment', 'dall-e-3': 'dalle-deployment' });
    vi.stubEnv('PIXO_MEDIA_MODEL_ALIASES', JSON.stringify({ 'gpt-image-1': 'environment-deployment' }));
    expect(await resolveModelAlias(root, 'gpt-image-2')).toBe('environment-deployment');
    expect((await readAliasMap(root)).effective['gpt-image-2']).toBe('environment-deployment');
  });

  it.each([
    { aliases: {}, expected: 'gpt-image-2' },
    { aliases: { 'gpt-image-1': 'custom-deployment' }, expected: 'custom-deployment' },
  ])('dispatches a saved gpt-image-1 selection using $expected on the wire', async ({ aliases, expected }) => {
    await save({ providers: { openai: { apiKey: 'test-key' } }, aliases });
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).model).toBe(expected);
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateMedia({ projectRoot: root, projectsRoot: path.join(root, 'projects'), projectId: 'project-1',
      surface: 'image', model: 'gpt-image-1', prompt: 'A sword icon', output: 'generated.png' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.providerNote).toContain(expected);
  });

  describe('media gateway adapter', () => {
    const png = () => new Response(Buffer.from(PNG_BASE64, 'base64'), { headers: { 'content-type': 'image/png' } });
    const asJson = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const generate = (model: string) => generateMedia({ projectRoot: root, projectsRoot: path.join(root, 'projects'), projectId: 'project-1',
      surface: 'image', model, prompt: 'A sword icon', output: 'generated.png' });

    it('runs a recipe model saved under its old id under its neutral id', async () => {
      await save({ providers: { fal: { apiKey: 'test-gateway' } } });
      const fetchMock = vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === 'https://queue.fal.run/fal-ai/flux/dev') return asJson({ request_id: 'req-12345678', status_url: 'https://queue.fal.run/s', response_url: 'https://queue.fal.run/r' });
        if (url === 'https://queue.fal.run/s') return asJson({ status: 'COMPLETED' });
        if (url === 'https://queue.fal.run/r') return asJson({ images: [{ url: 'https://v3.fal.media/files/result.png' }] });
        if (url === 'https://v3.fal.media/files/result.png') return png();
        throw new Error(`unexpected request ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const result = await generate('flux-dev-fal');
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(result).toMatchObject({ model: 'flux-dev-gateway', providerId: 'media-gateway' });
    });

    it('names the service to a user with their own key, keeping the status first so the failure routes to a next step', async () => {
      await save({ providers: { 'media-gateway': { apiKey: 'test-gateway' } } });
      vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })));
      await expect(generate('flux-dev-gateway')).rejects.toThrow(/^fal submit 401: /);
    });

    it('does not name the service to a user without a key', async () => {
      const failure = await generate('flux-dev-gateway').then(() => null, (err: Error) => err);
      expect(failure?.message).toMatch(/^no media gateway API key/);
      expect(failure?.message).not.toMatch(UPSTREAM_NAME);
    });

    it('does not advertise the passthrough in the unknown-model error', async () => {
      const failure = await generate('not-a-model').then(() => null, (err: Error) => err);
      expect(failure?.message).toContain('unknown model');
      expect(failure?.message).not.toMatch(UPSTREAM_NAME);
    });
  });
});
