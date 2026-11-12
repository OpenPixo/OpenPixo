import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runProjectExtensionsCli } from '../../src/services/project-extensions-cli.js';

vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:7456' }));

const originalExitCode = process.exitCode;
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.exitCode = 0;
  vi.stubEnv('PIXO_PROJECT_ID', 'game-a');
  vi.stubEnv('PIXO_API_TOKEN', '');
  request = vi.fn(async () => new Response(JSON.stringify({ skills: [], mcpServers: [], catalog: { skills: [], mcpServers: [], mcpTemplates: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', request);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); process.exitCode = originalExitCode; });

describe('project extension CLI boundary', () => {
  it('preserves context-cost metadata in machine-readable listings', async () => {
    const contextCost = { indexBytes: 200, indexTokens: 50, onDemandBytes: 8000, onDemandTokens: 2000 };
    request.mockResolvedValue(new Response(JSON.stringify({
      skills: [{ id: 'game-assets-batch', contextCost }], mcpServers: [], catalog: { skills: [], mcpServers: [], mcpTemplates: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await runProjectExtensionsCli(['list', '--json']);
    const output = vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join('');
    expect(JSON.parse(output).skills[0].contextCost).toEqual(contextCost);
  });

  it('uses the current project and sends an explicit same-origin mutation', async () => {
    await runProjectExtensionsCli(['add', '--kind', 'skill', '--catalog', 'game-assets-batch', '--json']);
    const [url, options] = request.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:7456/api/projects/game-a/extensions');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ Origin: 'http://127.0.0.1:7456' });
    expect(JSON.parse(options.body as string)).toEqual({ kind: 'skill', catalogId: 'game-assets-batch' });
  });

  it('addresses the exact extension when disabling or removing it', async () => {
    await runProjectExtensionsCli(['disable', 'mcp', 'assets', '--project', 'game-b']);
    expect(request.mock.calls[0]![0]).toBe('http://127.0.0.1:7456/api/projects/game-b/extensions/mcp/assets');
    const disable = request.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(disable.body as string)).toEqual({ action: 'disable' });
    await runProjectExtensionsCli(['remove', 'mcp', 'assets', '--project', 'game-b']);
    expect((request.mock.calls[1]![1] as RequestInit).method).toBe('DELETE');
  });

  it('rejects ambiguous import sources before sending an HTTP request', async () => {
    await runProjectExtensionsCli(['add', '--kind', 'skill', '--source', 'somewhere', '--catalog', 'also-somewhere']);
    expect(process.exitCode).toBe(1);
    expect(request).not.toHaveBeenCalled();
  });
});
