import { describe, expect, it } from 'vitest';
import { codexProjectMcpConfig } from '../../src/runtimes/extension-injection.js';

describe('project MCP native thread RPC configuration', () => {
  it('preserves stdio environment and HTTP credentials as structured config', () => {
    const result = codexProjectMcpConfig([
      { id: 'game-assets', transport: 'stdio', enabled: true, command: 'node', args: ['C:\\Game Files\\mcp.ts'], env: { GAME_TOKEN: 'dummy-stdio-secret', 'OD.KEY': 'a"b' } },
      { id: 'remote', transport: 'http', enabled: true, url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer dummy-http-secret' } },
    ]);
    expect(result).toEqual({ mcp_servers: {
      'openpixo_game-assets': { enabled: true, command: 'node', args: ['C:\\Game Files\\mcp.ts'], env: { GAME_TOKEN: 'dummy-stdio-secret', 'OD.KEY': 'a"b' } },
      openpixo_remote: { enabled: true, url: 'https://example.invalid/mcp', http_headers: { Authorization: 'Bearer dummy-http-secret' } },
    } });
  });

  it('adds no runtime inputs for empty or disabled project extensions', () => {
    expect(codexProjectMcpConfig()).toEqual({});
    expect(codexProjectMcpConfig([{ id: 'disabled', transport: 'stdio', enabled: false, command: 'bad' }])).toEqual({});
  });

  it('rejects invalid identities, unsupported SSE, and incomplete transports', () => {
    expect(() => codexProjectMcpConfig([{ id: 'bad.name', transport: 'stdio', enabled: true, command: 'node' }])).toThrow('Invalid');
    expect(() => codexProjectMcpConfig([{ id: 'old', transport: 'sse', enabled: true, url: 'https://example.invalid/sse' }])).toThrow('streamable HTTP');
    expect(() => codexProjectMcpConfig([{ id: 'missing', transport: 'stdio', enabled: true, command: ' ' }])).toThrow('stdio command');
  });

  it('captures independent run values when extension configuration later changes', () => {
    const server = { id: 'assets', transport: 'stdio' as const, enabled: true, command: 'node', args: ['old.ts'], env: { GAME_TOKEN: 'old-secret' } };
    const remote = { id: 'remote', transport: 'http' as const, enabled: true, url: 'https://example.invalid/mcp', headers: { Authorization: 'old-header' } };
    const config = codexProjectMcpConfig([server, remote]);
    server.args[0] = 'new.ts';
    server.env.GAME_TOKEN = 'new-secret';
    remote.headers.Authorization = 'new-header';
    expect(config.mcp_servers?.openpixo_assets?.args).toEqual(['old.ts']);
    expect(config.mcp_servers?.openpixo_assets?.env).toEqual({ GAME_TOKEN: 'old-secret' });
    expect(config.mcp_servers?.openpixo_remote?.http_headers).toEqual({ Authorization: 'old-header' });
  });
});
