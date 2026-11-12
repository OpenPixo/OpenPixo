// 3D generation through the media gateway. Every network call here is a stub: a real
// call would spend money, so the test fails on any request it does not expect.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';
import { findMediaModel, hostedModelSurface, modelsForSurface, MODEL3D_MODELS } from '../../src/media/models.js';
import { gameMediaModelCatalog } from '../../src/game/media-contract.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const GLB = Buffer.concat([Buffer.from('glTF', 'latin1'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(120, 1)]);

function falQueue(result: Record<string, unknown>, media: Buffer) {
  const inputs: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      inputs.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ request_id: 'r1', status_url: 'https://queue.fal.run/status/r1', response_url: 'https://queue.fal.run/result/r1' });
    }
    if (url.includes('/status/')) return Response.json({ status: 'COMPLETED' });
    if (url.includes('/result/')) return Response.json(result);
    if (url === 'https://v3.fal.media/model.glb') return new Response(new Uint8Array(media));
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return inputs;
}

describe('3D generation', () => {
  let root: string;
  const generate = (model: string, reference: { image?: string } = { image: 'art/chest.png' }) => generateMedia({
    surface: 'model3d', model, output: 'models/chest.glb',
    projectRoot: root, projectsRoot: path.join(root, 'projects'), projectId: 'p1', ...reference,
  });

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pixo-model3d-'));
    await mkdir(path.join(root, 'projects', 'p1', 'art'), { recursive: true });
    await writeFile(path.join(root, 'projects', 'p1', 'art', 'chest.png'), PNG);
    vi.stubEnv('FAL_KEY', 'test-key-not-real');
    vi.stubEnv('PIXO_FAL_KEY', '');
    vi.stubEnv('PIXO_MEDIA_ALLOW_STUBS', '');
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('sends the image with a face cap and writes the returned GLB', async () => {
    const inputs = falQueue({ model_mesh: { url: 'https://v3.fal.media/model.glb' } }, GLB);
    const file = await generate('tripo-v2.5-gateway');
    expect(inputs[0]!.url).toContain('tripo3d/tripo/v2.5/image-to-3d');
    expect(inputs[0]!.body).toMatchObject({ texture: 'standard', face_limit: 30_000 });
    expect(String(inputs[0]!.body.image_url)).toMatch(/^data:image\/png;base64,/u);
    expect(file).toMatchObject({ name: 'models/chest.glb', kind: 'model3d', mime: 'model/gltf-binary', surface: 'model3d', usedStubFallback: false });
    expect(await readFile(path.join(root, 'projects', 'p1', 'models', 'chest.glb'))).toEqual(GLB);
  });

  it('reads the other output shape for Meshy', async () => {
    const inputs = falQueue({ model_glb: { url: 'https://v3.fal.media/model.glb' } }, GLB);
    await generate('meshy-6-gateway');
    expect(inputs[0]!.url).toContain('fal-ai/meshy/v6/image-to-3d');
    expect(inputs[0]!.body).toMatchObject({ should_texture: true, target_polycount: 30_000 });
  });

  it('refuses a result that is not a GLB rather than saving it as one', async () => {
    falQueue({ model_mesh: { url: 'https://v3.fal.media/model.glb' } }, Buffer.alloc(200, 9));
    await expect(generate('tripo-v2.5-gateway')).rejects.toThrow(/not a binary glTF/u);
  });

  it('needs a reference image', async () => {
    falQueue({}, GLB);
    await expect(generate('tripo-v2.5-gateway', {})).rejects.toThrow(/reference image/u);
  });

  it('keeps the vendor out of what every CLI and agent reads', () => {
    expect(JSON.stringify(MODEL3D_MODELS)).not.toMatch(/\bfal\b/iu);
    expect(modelsForSurface('model3d')).toBe(MODEL3D_MODELS);
    expect(findMediaModel('openpixo-model3d')?.provider).toBe('openpixo');
    // The hosted service does not say whose model runs it; a user's own key still names the model it buys.
    expect(findMediaModel('openpixo-model3d')).toMatchObject({ label: 'OpenPixo 3D model', hint: 'OpenPixo cloud · credits · medium quality, the default' });
    for (const id of ['openpixo-model3d-draft', 'openpixo-model3d-high']) {
      expect(findMediaModel(id)?.provider).toBe('openpixo');
      expect(hostedModelSurface(id)).toBe('model3d');
    }
    // The draft tier runs on another vendor's model, which no hosted entry names either.
    expect(JSON.stringify(MODEL3D_MODELS)).not.toMatch(/rodin|hyper3d/iu);
    expect(findMediaModel('tripo-v2.5-gateway')?.label).toBe('Tripo v2.5');
    expect(findMediaModel('meshy-6-gateway')?.label).toBe('Meshy 6');
  });

  it('offers hosted 3D to an agent only with an art budget', () => {
    expect(gameMediaModelCatalog(['media-gateway'], false).model3d).toEqual(['tripo-v2.5-gateway', 'meshy-6-gateway']);
    expect(gameMediaModelCatalog([], false).model3d).toEqual([]);
    expect(gameMediaModelCatalog([], true).model3d).toEqual(['openpixo-model3d', 'openpixo-model3d-draft', 'openpixo-model3d-high']);
  });
});
