import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCP_TEMPLATES } from '../../src/mcp-config.js';
import { runMcpTemplateCli } from '../../src/mcp/templates-cli.js';

const flags = ['--daemon-url', 'http://daemon.test', '--json'];
const existing = { id: 'existing', command: 'existing-server', transport: 'stdio', enabled: false };

function mockApi() {
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const servers = init?.method === 'PUT'
      ? (JSON.parse(String(init.body)) as { servers: unknown[] }).servers
      : [existing];
    return new Response(JSON.stringify({ servers, templates: MCP_TEMPLATES }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.exitCode = 0;
});

describe('MCP template CLI', () => {
  it('lists the same engine presets as the API in JSON', async () => {
    const fetchMock = mockApi();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMcpTemplateCli(['templates', '--category', 'game-engine', ...flags]);
    const output = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output.templates.map((entry: { id: string }) => entry.id)).toEqual(['godot-mcp', 'unity-mcp', 'blender-mcp']);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('http://daemon.test/api/mcp/servers');
  });

  it('adds a preset through the config API, preserving saved servers and env values', async () => {
    const fetchMock = mockApi();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMcpTemplateCli(['add', '--template', 'godot-mcp', '--env', 'GODOT_PATH=C:/Game Tools/Godot.exe', ...flags]);
    const request = fetchMock.mock.calls[1];
    expect(request?.[0]).toBe('http://daemon.test/api/mcp/servers');
    expect(request?.[1]?.method).toBe('PUT');
    const body = JSON.parse(String(request?.[1]?.body));
    expect(body.servers[0]).toEqual(existing);
    expect(body.servers[1]).toMatchObject({ id: 'godot-mcp', command: process.platform === 'win32' ? 'cmd' : 'godot-mcp', env: { GODOT_PATH: 'C:/Game Tools/Godot.exe' } });
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).server.id).toBe('godot-mcp');
  });

  it('rejects an existing id without overwriting it', async () => {
    const fetchMock = mockApi();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runMcpTemplateCli(['add', '--template', 'unity-mcp', '--id', 'existing', ...flags]);
    expect(error).toHaveBeenCalledWith('MCP server already exists: existing');
    expect(process.exitCode).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
