import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { runStoreCli } from '../../src/store/cli.js';

vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:7456' }));
const originalExitCode = process.exitCode;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); process.exitCode = originalExitCode; });

it(`parses ${PRODUCT_CLI_NAME} store list --paid --json and uses the store catalog endpoint`, async () => {
  const result = { items: [{ name: 'openpixo/paid', pricing: { type: 'paid', credits: 300 } }] };
  const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(result), { status: 200 }));
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStoreCli(['list', '--paid', '--json']);
  expect(request.mock.calls[0]?.[0]).toBe('http://127.0.0.1:7456/api/store/catalog?pricing=paid');
  expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toEqual(result);
});

it('splits an install version from a namespaced name and forwards the project', async () => {
  const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ name: 'openpixo/free', version: '1.2.0' }), { status: 200 }));
  vi.stubGlobal('fetch', request);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStoreCli(['install', 'openpixo/free@1.2.0', '--project', 'game', '--json']);
  const [url, init] = request.mock.calls[0]! as unknown as [string, RequestInit];
  expect(url).toBe('http://127.0.0.1:7456/api/store/install');
  expect(JSON.parse(init.body as string)).toEqual({ name: 'openpixo/free', version: '1.2.0', projectId: 'game' });
});

it.each([false, true])('includes example prompts in store info (json=%s)', async (json) => {
  const item = { name: 'openpixo/sprite', version: '1.0.0', title: 'Sprite helper', description: 'Sprite workflow',
    license: 'Apache-2.0', requires: {}, examples: [{ title: 'Knight', prompt: 'Make a knight sprite.' }] };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(item)));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStoreCli(['info', item.name, ...(json ? ['--json'] : [])]);
  if (json) expect(JSON.parse(output.mock.calls[0]?.[0] as string).examples).toEqual(item.examples);
  else expect(output.mock.calls.flat().join('\n')).toContain('Examples:\nKnight\n  Make a knight sprite.');
});

it('keeps store list text output readable for free and paid items', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [
    { name: 'openpixo/free', version: '1.0.0', kind: 'skill', pricing: { type: 'free' }, tags: ['tools'] },
    { name: 'openpixo/paid', version: '1.0.0', kind: 'asset-pack', pricing: { type: 'paid', credits: 600 },
      coverUrl: '/api/store/items/openpixo%2Fpaid/cover' },
  ] })));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStoreCli(['list']);
  expect(output).toHaveBeenCalledWith('openpixo/free@1.0.0\tskill\tfree\nopenpixo/paid@1.0.0\tasset-pack\t600 credits');
});

it.each([false, true])('reports a failed store buy and exits non-zero (json=%s)', async json => {
  const error = { error: { code: 'STORE_PURCHASE_UNAVAILABLE', message: 'Buying Workshop items with credits opens soon.' } };
  const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(error, { status: 503 }));
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await runStoreCli(['buy', 'openpixo/pixel-dungeon-kit', '--version', '1.0.0', ...(json ? ['--json'] : [])]);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe('http://127.0.0.1:7456/api/store/purchase');
  expect(init).toMatchObject({ method: 'POST', headers: { Origin: 'http://127.0.0.1:7456' } });
  expect(JSON.parse(init!.body as string)).toEqual({ name: 'openpixo/pixel-dungeon-kit', version: '1.0.0' });
  expect(process.exitCode).toBe(1);
  if (json) {
    expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toEqual(error);
    expect(errors).not.toHaveBeenCalled();
  } else {
    expect(errors).toHaveBeenCalledWith(error.error.message);
    expect(output).not.toHaveBeenCalled();
  }
});

it.each([false, true])('formats a successful store purchase (json=%s)', async json => {
  const result = { name: 'openpixo/pixel-dungeon-kit', version: '1.0.0', creditsSpent: 600, balance: 400, entitlementId: 'test-entitlement' };
  const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(result));
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStoreCli(['buy', result.name, ...(json ? ['--json'] : [])]);
  expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toEqual({ name: result.name });
  if (json) expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toEqual(result);
  else expect(output).toHaveBeenCalledWith('Purchased openpixo/pixel-dungeon-kit@1.0.0 for 600 credits. Balance: 400 credits.');
  expect(process.exitCode).toBe(originalExitCode);
});

it('includes the buy syntax in store usage', async () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await runStoreCli(['--help']);
  expect(output.mock.calls[0]?.[0]).toContain(PRODUCT_CLI_NAME + ' store buy <name> [--version <v>] [--json]');
  expect(request).not.toHaveBeenCalled();
});
