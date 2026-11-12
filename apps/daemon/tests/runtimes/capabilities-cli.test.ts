import { afterEach, expect, it, vi } from 'vitest';
import { RUNTIME_CAPABILITY_MATRIX, type AgentCapabilitiesResponse } from '@openpixo/contracts';
import { runAgentCapabilitiesCli } from '../../src/runtimes/capabilities-cli.js';

vi.mock('../../src/daemon-url.js', () => ({ resolveDaemonUrl: async () => 'http://127.0.0.1:17456/' }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const result: AgentCapabilitiesResponse = {
    matrix: RUNTIME_CAPABILITY_MATRIX,
    runtimes: { codex: { installedVersion: 'codex-cli 0.160.0' }, claude: {}, opencode: {} },
  };
  const fetchMock = vi.fn(async () => Response.json(result));
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, stdout: vi.spyOn(process.stdout, 'write').mockImplementation(() => true) };
}

it('requests daemon capabilities and filters the JSON response by runtime', async () => {
  const { fetchMock, stdout } = setup();
  await runAgentCapabilitiesCli(['--agent', 'claude', '--json']);
  expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:17456/api/agents/capabilities', expect.any(Object));
  expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({
    matrix: { claude: RUNTIME_CAPABILITY_MATRIX.claude }, runtimes: { claude: {} },
  });
});

it('prints the runtime columns and capability states as a human table', async () => {
  const { stdout } = setup();
  await runAgentCapabilitiesCli([]);
  const output = String(stdout.mock.calls[0]?.[0]);
  expect(output).toContain('codex (codex-cli 0.160.0)');
  expect(output).toMatch(/Capability\s+codex.*claude\s+opencode/);
  expect(output).toMatch(/steer\s+unsupported\s+implemented\s+unsupported/);
});
