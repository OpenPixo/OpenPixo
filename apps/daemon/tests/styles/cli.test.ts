import { afterEach, expect, it, vi } from 'vitest';
import { runStyleCli } from '../../src/styles/cli.js';

vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:7456' }));
const originalExitCode = process.exitCode;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); process.exitCode = originalExitCode; });

it.each([
  { args: ['list'], route: '/api/styles', result: { styles: [{ id: 'pixel-16', title: '16-bit pixel' }] } },
  { args: ['info', 'pixel/16'], route: '/api/styles/pixel%2F16', result: { style: { id: 'pixel/16', title: '16-bit pixel' } } },
  { args: ['get', 'game/one'], route: '/api/projects/game%2Fone/art-style', result: { styleId: 'pixel-16', style: { id: 'pixel-16' } } },
])('uses the shared HTTP endpoint for style $args.0 and preserves JSON', async ({ args, route, result }) => {
  const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(result));
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStyleCli([...args, '--json']);
  expect(request.mock.calls[0]?.[0]).toBe('http://127.0.0.1:7456' + route);
  expect(request.mock.calls[0]?.[1]?.method).toBe('GET');
  expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toEqual(result);
});

it.each([{ requested: 'pixel-16', styleId: 'pixel-16' }, { requested: 'none', styleId: null }])(
  'sets project art style $requested through PUT', async ({ requested, styleId }) => {
    vi.stubEnv('PIXO_TOOL_TOKEN', 'test-token');
    const result = { styleId, style: null };
    const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(result));
    vi.stubGlobal('fetch', request);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStyleCli(['set', 'game', requested, '--json']);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:7456/api/projects/game/art-style');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ styleId });
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test-token', Origin: 'http://127.0.0.1:7456' });
    expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toEqual(result);
  },
);

it('prints style details and examples for humans', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ style: {
    id: 'pixel-16', title: '16-bit pixel', description: 'Crisp sprites.', dimension: ['2d'], medium: ['pixel'],
    prompt: 'Limited color clusters', negativePrompt: 'blur', palette: ['#123456'], license: 'Apache-2.0',
    examples: [{ title: 'Knight', prompt: 'Create a knight sprite.' }],
  } })));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStyleCli(['info', 'pixel-16']);
  expect(output.mock.calls[0]?.[0]).toContain('16-bit pixel (pixel-16)');
  expect(output.mock.calls[0]?.[0]).toContain('Negative prompt: blur');
  expect(output.mock.calls[0]?.[0]).toContain('Examples:\nKnight\n  Create a knight sprite.');
});

it('preserves server errors in machine output and reports failure', async () => {
  const result = { error: { code: 'STYLE_NOT_FOUND', message: 'Unknown art style' } };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(result, { status: 404 })));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStyleCli(['info', 'missing', '--json']);
  expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toEqual(result);
  expect(process.exitCode).toBe(1);
});

it.each([{ requested: 'concept/style-2.png', path: 'concept/style-2.png' }, { requested: 'none', path: null }])(
  'sets the style reference $requested through PUT', async ({ requested, path }) => {
    const result = { styleId: null, style: null, referenceImage: path };
    const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(result));
    vi.stubGlobal('fetch', request);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStyleCli(['reference', 'game', requested]);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:7456/api/projects/game/style-reference');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ path });
    expect(output.mock.calls[0]?.[0]).toBe(`Style reference: ${path ?? 'none'}`);
  },
);

it('shows the style reference with one argument', async () => {
  const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ styleId: null, style: null, referenceImage: 'concept/a.png' }));
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStyleCli(['reference', 'game']);
  expect(request.mock.calls[0]?.[0]).toBe('http://127.0.0.1:7456/api/projects/game/art-style');
  expect(output.mock.calls[0]?.[0]).toBe('Style reference: concept/a.png');
});
