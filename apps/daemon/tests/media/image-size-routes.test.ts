import type { ArtStyle } from '@openpixo/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMediaRoutes } from '../../src/routes/media.js';
import { resolveArtStyleForGeneration } from '../../src/styles/service.js';

vi.mock('../../src/styles/service.js', () => ({ resolveArtStyleForGeneration: vi.fn() }));
const resolveStyle = vi.mocked(resolveArtStyleForGeneration);

afterEach(() => vi.resetAllMocks());
const noop = () => {};
function functionProxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, { get: (target, key) => key in target ? target[key as string] : noop });
}

function harness() {
  const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const app = { get: noop, put: noop, post: (route: string, handler: any) => handlers.set(route, handler) };
  const generate = vi.fn(async () => ({ name: 'coin.png', mime: 'image/png', providerId: 'stub', width: 64, height: 64, transparent: true }));
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
  async function request(body: Record<string, unknown>, route = '/api/tools/media/generate') {
    const res = { statusCode: 200, body: undefined as unknown,
      status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } };
    await handlers.get(route)!({ params: { id: 'p' }, body }, res);
    return res;
  }
  return { generate, request };
}

describe('media route image size and transparency', () => {
  it.each(['/api/projects/:id/media/generate', '/api/tools/media/generate'])('passes size and an explicit cutout to the dispatcher on %s', async (route) => {
    resolveStyle.mockResolvedValue(null);
    const { generate, request } = harness();
    const response = await request({ surface: 'image', model: 'gpt-image-2', prompt: 'A coin', width: 64, height: 64, background: 'transparent' }, route);
    expect(response.statusCode).toBe(202);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ width: 64, height: 64, background: 'transparent', pixelArt: false }));
  });

  it('accepts an oversized size, leaving the clamp to the shared rule', async () => {
    resolveStyle.mockResolvedValue(null);
    const { generate, request } = harness();
    expect((await request({ surface: 'image', model: 'gpt-image-2', prompt: 'A map', width: 4096, height: 4096 })).statusCode).toBe(202);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ width: 4096, height: 4096 }));
  });

  it('resamples with nearest neighbour when the art style has a pixel grid', async () => {
    resolveStyle.mockResolvedValue({ id: 'pixel', title: 'Pixel', description: '', dimension: ['2d'], medium: ['pixel'], prompt: 'Pixel art',
      negativePrompt: '', constraints: { pixelSize: 4 }, previews: [], license: 'Apache-2.0' } as ArtStyle);
    const { generate, request } = harness();
    await request({ surface: 'image', model: 'gpt-image-2', prompt: 'A slime', width: 32 });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ width: 32, pixelArt: true }));
  });

  // A sheet renders once with no size (a sized cutout is cropped to its subject), and
  // the request's size is each piece's.
  it('sends a sheet as one unsized render with its layout prompt and the grid\'s shape', async () => {
    resolveStyle.mockResolvedValue(null);
    const { generate, request } = harness();
    const response = await request({ surface: 'image', model: 'gpt-image-2', prompt: 'Pickup icons', width: 64, height: 64, background: 'transparent',
      output: 'assets/icons/pickups-sheet.png', sheet: { columns: 3, rows: 2, names: ['coin', 'heart', 'key'] } });
    expect(response.statusCode).toBe(202);
    const call = (generate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(call).toMatchObject({ width: undefined, height: undefined, aspect: '4:3', background: 'transparent', output: 'assets/icons/pickups-sheet.png' });
    expect(String(call.prompt)).toMatch(/^Pickup icons\n\nLayout: one image split into an even grid of 3 columns and 2 rows/);
    expect(call.sheet).toMatchObject({ columns: 3, rows: 2, frames: false, names: ['coin', 'heart', 'key'], pieceSize: { width: 64, height: 64 }, transparent: true });
  });

  it.each([
    [{ surface: 'image', output: 'a/set-sheet.png', sheet: { columns: 9, rows: 1 } }, 'from 1 to 8'],
    [{ surface: 'image', sheet: { columns: 2, rows: 2 } }, 'a sheet needs --output'],
    [{ surface: 'image', output: 'a/set-sheet.png', count: 2, sheet: { columns: 2, rows: 2 } }, 'a sheet is one image'],
    [{ surface: 'image', width: '64' }, 'width must be a positive integer'],
    [{ surface: 'image', width: 0 }, 'width must be a positive integer'],
    [{ surface: 'image', height: 10.5 }, 'height must be a positive integer'],
    [{ surface: 'image', width: 64, aspect: '2:1' }, 'aspect must be one of'],
    [{ surface: 'image', background: 'checkerboard' }, 'background must be transparent or scene'],
    [{ surface: 'video', width: 64 }, 'width and height apply to image generation only'],
  ])('rejects %j before creating a task', async (body, message) => {
    resolveStyle.mockResolvedValue(null);
    const { generate, request } = harness();
    const response = await request({ model: 'gpt-image-2', prompt: 'x', ...body });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'BAD_REQUEST', message: expect.stringContaining(message) } });
    expect(generate).not.toHaveBeenCalled();
  });
});
