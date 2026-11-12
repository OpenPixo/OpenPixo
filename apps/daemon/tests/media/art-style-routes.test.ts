import type { ArtStyle } from '@openpixo/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMediaRoutes } from '../../src/routes/media.js';
import { resolveArtStyleForGeneration } from '../../src/styles/service.js';

vi.mock('../../src/styles/service.js', () => ({ resolveArtStyleForGeneration: vi.fn() }));
const resolveStyle = vi.mocked(resolveArtStyleForGeneration);
const style: ArtStyle = { id: 'ink-test', title: 'Ink test', description: 'Ink game art', dimension: ['2d'], medium: ['ink'],
  prompt: 'Carved ink shapes', negativePrompt: 'photography', constraints: { recommendedResolution: '1024x1024' }, previews: [], license: 'Apache-2.0' };

afterEach(() => vi.resetAllMocks());
const noop = () => {};
function functionProxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, { get: (target, key) => key in target ? target[key as string] : noop });
}

function harness() {
  const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const app = { get: noop, put: noop, post: (route: string, handler: any) => handlers.set(route, handler) };
  const generate = vi.fn(async () => ({ name: 'knight.png', mime: 'image/png', providerId: 'stub' }));
  const root = process.env.PIXO_DATA_DIR;
  if (!root) throw new Error('Test setup did not provide PIXO_DATA_DIR');
  const deps = {
    db: {}, design: functionProxy(),
    http: { sendApiError: (res: any, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }),
      requireLocalDaemonRequest: noop, isLocalSameOrigin: () => true, resolvedPortRef: { current: 0 } },
    paths: { PROJECT_ROOT: root, PROJECTS_DIR: root, RUNTIME_DATA_DIR: root }, ids: { randomUUID: () => 'task-id' },
    auth: functionProxy({ optionalToolGrantFromRequest: () => null,
      authorizeToolRequest: () => ({ projectId: 'p', token: 'test-token' }) }),
    media: functionProxy({ generateMedia: generate,
      createMediaTask: () => ({ id: 'task-id', status: 'queued', startedAt: Date.now(), progress: [] }) }),
    appConfig: functionProxy({ readAppConfig: async () => ({}) }), nativeDialogs: functionProxy(),
    projectStore: functionProxy({ getProject: () => ({ id: 'p', metadata: {} }) }), projectFiles: functionProxy(),
    conversations: functionProxy(), research: functionProxy(),
    authorizeProjectRequest: async () => true, authorizeProjectToolRequest: async () => true,
  } as unknown as Parameters<typeof registerMediaRoutes>[1];
  registerMediaRoutes(app as unknown as Parameters<typeof registerMediaRoutes>[0], deps);
  async function request(body: Record<string, unknown>, route = '/api/projects/:id/media/generate') {
    const res = { statusCode: 200, body: undefined as unknown,
      status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } };
    await handlers.get(route)!({ params: { id: 'p' }, body }, res);
    return res;
  }
  return { generate, request, root };
}

describe('media route art styles', () => {
  it.each(['/api/projects/:id/media/generate', '/api/tools/media/generate'])('applies the project default before dispatching %s', async route => {
    resolveStyle.mockResolvedValue(style);
    const { generate, request, root } = harness();
    expect((await request({ surface: 'image', model: 'gpt-image-2', prompt: 'A knight', negativePrompt: 'letters' }, route)).statusCode).toBe(202);
    expect(resolveStyle).toHaveBeenCalledWith(expect.anything(), root, 'p', undefined);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ resolution: '1024x1024',
      prompt: 'A knight\n\nCarved ink shapes\n\nRecommended output resolution: 1024x1024.\n\nAvoid: letters, photography' }));
  });

  it('passes an explicit override and explicit none through the same resolver', async () => {
    resolveStyle.mockImplementation(async (_db, _root, _id, styleId) => styleId === null ? null : style);
    const { generate, request, root } = harness();
    await request({ surface: 'image', model: 'gpt-image-2', prompt: 'A knight', styleId: 'ink-test' });
    expect(resolveStyle).toHaveBeenLastCalledWith(expect.anything(), root, 'p', 'ink-test');
    await request({ surface: 'image', model: 'gpt-image-2', prompt: 'A knight', styleId: null });
    expect(resolveStyle).toHaveBeenLastCalledWith(expect.anything(), root, 'p', null);
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: 'A knight', resolution: undefined }));
  });

  it.each(['video', 'audio'])('leaves %s requests unchanged and does not resolve a style', async surface => {
    const { generate, request } = harness();
    await request({ surface, model: 'test-model', prompt: 'A forest', styleId: 'missing-style' });
    expect(resolveStyle).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'A forest' }));
  });

  it('rejects an unavailable explicit style before creating a provider request', async () => {
    resolveStyle.mockRejectedValue(Object.assign(new Error('Art style is not installed'), { status: 400, code: 'STYLE_NOT_FOUND' }));
    const { generate, request } = harness();
    const response = await request({ surface: 'image', model: 'gpt-image-2', prompt: 'A knight', styleId: 'missing' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ error: 'Art style is not installed', code: 'STYLE_NOT_FOUND' });
    expect(generate).not.toHaveBeenCalled();
  });
});

