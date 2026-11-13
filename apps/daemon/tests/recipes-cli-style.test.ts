import { afterEach, expect, it, vi } from 'vitest';
import { runRecipeCli } from '../src/recipes/recipe-cli.js';

vi.mock('../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:7456' }));
const originalExitCode = process.exitCode;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); process.exitCode = originalExitCode; });

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
  expect(url).toBe('http://127.0.0.1:7456/api/projects/game/recipe-runs');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(init?.body as string)).toEqual({ recipeId: 'sprite', inputs: {}, ...expected });
});

it('prices a run, then spends that price with the same flags', async () => {
  const quote = { paid: true, quoteId: '7d0f6f36-1c5e-4d39-9a52-0b6c7a3f0a11', model: { provider: 'openpixo', id: 'openpixo-image' }, count: 2,
    credits: 8, available: 100, candidates: [{ credits: 4 }, { credits: 4 }], expiresAt: '2026-11-14T13:00:00.000Z', warnings: [] };
  const request = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.endsWith('/quote') ? quote : { id: 'run-1', status: 'queued', candidates: [] }));
  vi.stubGlobal('fetch', request);
  const printed: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => { printed.push(line); });
  await runRecipeCli(['quote', 'openpixo/image', '--project', 'game', '--input', 'prompt=a chest', '--count', '2']);
  expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:7456/api/projects/game/recipe-runs/quote');
  expect(JSON.parse(request.mock.calls[0]![1]?.body as string)).toEqual({ recipeId: 'openpixo/image', inputs: { prompt: 'a chest' }, count: 2 });
  expect(printed[0]).toContain('8 credits for 2 candidates');
  expect(printed[0]).toContain(`--quote ${quote.quoteId}`);
  await runRecipeCli(['run', 'openpixo/image', '--project', 'game', '--input', 'prompt=a chest', '--count', '2', '--quote', quote.quoteId, '--json']);
  expect(JSON.parse(request.mock.calls[1]![1]?.body as string)).toEqual({ recipeId: 'openpixo/image', inputs: { prompt: 'a chest' }, count: 2, quoteId: quote.quoteId });
});

it('lists the project\'s runs with its filters', async () => {
  const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ runs: [] }));
  vi.stubGlobal('fetch', request);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await runRecipeCli(['runs', '--project', 'game', '--surface', 'audio', '--origin', 'agent', '--limit', '5', '--json']);
  expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:7456/api/projects/game/recipe-runs?surface=audio&origin=agent&limit=5');
});
