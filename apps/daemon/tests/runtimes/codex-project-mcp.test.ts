import { describe, expect, it } from 'vitest';
import { codexAgentDef, codexNeedsDangerFullAccessSandbox, codexProjectMcpArgs, withCodexTransport } from '../../src/runtimes/defs/codex.js';

describe('project Codex process configuration', () => {
  it('keeps Windows and WSL in workspace-write unless explicitly overridden', () => {
    expect(codexNeedsDangerFullAccessSandbox('win32', {})).toBe(false);
    expect(codexNeedsDangerFullAccessSandbox('linux', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe(false);
    expect(codexNeedsDangerFullAccessSandbox('win32', { PIXO_CODEX_SANDBOX: 'danger-full-access' })).toBe(true);
  });

  it('rejects enabled project MCP on the operator exec-json rollback before any config enters argv', () => {
    const servers = [
      { id: 'assets', transport: 'stdio' as const, enabled: true, command: 'node', args: ['--token=hidden-argument'], env: { GAME_TOKEN: 'hidden-env' } },
      { id: 'remote', transport: 'http' as const, enabled: true, url: 'https://example.invalid/mcp?token=hidden-url', headers: { Authorization: 'Bearer hidden-header' } },
    ];
    for (const server of servers) {
      expect(() => codexProjectMcpArgs([server])).toThrow('app-server');
      expect(() => codexAgentDef.buildArgs('prompt', [], [], {}, { codexMcpServers: [server] })).toThrow('app-server');
    }
  });

  it('keeps project MCP off app-server argv while retaining native multi-agent mode', () => {
    const args = withCodexTransport(codexAgentDef, 'app-server').buildArgs('prompt', [], [], {}, {
      codexMcpServers: [{ id: 'assets', transport: 'stdio', enabled: true, command: 'node', env: { GAME_TOKEN: 'hidden-env' } }],
    });
    expect(args.some(arg => arg.includes('mcp_servers') || arg.includes('hidden-env'))).toBe(false);
    expect(args[args.indexOf('--enable') + 1]).toBe('multi_agent');
  });

  it('adds no MCP argv for empty or disabled project extensions', () => {
    expect(codexProjectMcpArgs()).toEqual([]);
    expect(codexProjectMcpArgs([{ id: 'disabled', transport: 'stdio', enabled: false, command: 'bad' }])).toEqual([]);
  });
});
