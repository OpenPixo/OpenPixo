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
