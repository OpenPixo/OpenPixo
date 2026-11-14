import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runRecipeCli } from '../src/recipes/recipe-cli.js';

vi.mock('../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:7456' }));
const originalExitCode = process.exitCode;
beforeEach(() => { vi.stubEnv('PIXO_PROJECT_ID', ''); vi.stubEnv('PIXO_TOOL_TOKEN', ''); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); process.exitCode = originalExitCode; });

it.each([
  { flags: [], expected: {} },
  { flags: ['--style', 'pixel-16'], expected: { styleId: 'pixel-16' } },
  { flags: ['--style', 'none'], expected: { styleId: null } },
])('forwards recipe style selection $flags without resolving defaults in the CLI', async ({ flags, expected }) => {
  const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ id: 'run-1', status: 'queued', candidates: [] }));
  vi.stubGlobal('fetch', request);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await runRecipeCli(['run', 'sprite', '--project', 'game', '--json', ...flags]);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe('http://127.0.0.1:7456/api/generate/runs');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(init?.body as string)).toEqual({ recipeId: 'sprite', projectId: 'game', inputs: {}, ...expected });
});

it('prices a run, then spends that price with the same flags', async () => {
  const quote = { paid: true, quoteId: '7d0f6f36-1c5e-4d39-9a52-0b6c7a3f0a11', model: { provider: 'openpixo', id: 'openpixo-image' }, count: 2,
    credits: 8, available: 100, candidates: [{ credits: 4 }, { credits: 4 }], expiresAt: '2026-11-14T13:00:00.000Z', warnings: [] };
  const request = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.endsWith('/quote') ? quote : { id: 'run-1', status: 'queued', candidates: [] }));
  vi.stubGlobal('fetch', request);
  const printed: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => { printed.push(line); });
  await runRecipeCli(['quote', 'openpixo/image', '--project', 'game', '--input', 'prompt=a chest', '--count', '2']);
  expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:7456/api/generate/quote');
  expect(JSON.parse(request.mock.calls[0]![1]?.body as string)).toEqual({ recipeId: 'openpixo/image', projectId: 'game', inputs: { prompt: 'a chest' }, count: 2 });
  expect(printed[0]).toContain('8 credits for 2 candidates');
  expect(printed[0]).toContain(`--quote ${quote.quoteId}`);
  await runRecipeCli(['run', 'openpixo/image', '--project', 'game', '--input', 'prompt=a chest', '--count', '2', '--quote', quote.quoteId, '--json']);
  expect(JSON.parse(request.mock.calls[1]![1]?.body as string)).toEqual({ recipeId: 'openpixo/image', projectId: 'game', inputs: { prompt: 'a chest' }, count: 2, quoteId: quote.quoteId });
});

it('lists one game\'s runs, the no-game ones, or every run', async () => {
  const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ runs: [] }));
  vi.stubGlobal('fetch', request);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await runRecipeCli(['runs', '--project', 'game', '--surface', 'audio', '--origin', 'agent', '--limit', '5', '--json']);
  await runRecipeCli(['runs', '--no-game', '--json']);
  await runRecipeCli(['runs', '--json']);
  expect(request.mock.calls.map(call => call[0])).toEqual([
    'http://127.0.0.1:7456/api/generate/runs?projectId=game&surface=audio&origin=agent&limit=5',
    'http://127.0.0.1:7456/api/generate/runs?noGame=1',
    'http://127.0.0.1:7456/api/generate/runs?',
  ]);
});

it('makes art for no game from a terminal, and saves it into the game named on adopt', async () => {
  const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ id: 'run-1', status: 'ready', candidates: [] }));
  vi.stubGlobal('fetch', request);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await runRecipeCli(['run', 'openpixo/image', '--input', 'prompt=a chest', '--json']);
  expect(JSON.parse(request.mock.calls[0]![1]?.body as string)).toMatchObject({ projectId: null });
  // An agent's shell names its game; --no-game still asks for none.
  vi.stubEnv('PIXO_PROJECT_ID', 'game');
  await runRecipeCli(['run', 'openpixo/image', '--no-game', '--json']);
  expect(JSON.parse(request.mock.calls[1]![1]?.body as string)).toMatchObject({ projectId: null });
  vi.stubEnv('PIXO_PROJECT_ID', '');
  await runRecipeCli(['adopt', 'run-1', '--candidate', 'c1', '--json']);
  expect(process.exitCode).toBe(5);
  expect(request).toHaveBeenCalledTimes(2);
  process.exitCode = originalExitCode;
  await runRecipeCli(['adopt', 'run-1', '--candidate', 'c1', '--project', 'other', '--json']);
  expect(request.mock.calls[2]![0]).toBe('http://127.0.0.1:7456/api/generate/runs/run-1/adopt');
  expect(JSON.parse(request.mock.calls[2]![1]?.body as string)).toEqual({ projectId: 'other', candidateIds: ['c1'] });
});

it('uploads a reference picture for a run with no game', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pixo-recipe-cli-'));
  try {
    const file = path.join(dir, 'chest.png');
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ref: 'references/abc.png', mime: 'image/png', size: 4 }));
    vi.stubGlobal('fetch', request);
    const printed: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => { printed.push(line); });
    await runRecipeCli(['reference', file, '--json']);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:7456/api/generate/references');
    expect(init?.body).toBeInstanceOf(FormData);
    expect(((init?.body as FormData).get('file') as File).name).toBe('chest.png');
    expect(JSON.parse(printed[0]!)).toMatchObject({ ref: 'references/abc.png' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
