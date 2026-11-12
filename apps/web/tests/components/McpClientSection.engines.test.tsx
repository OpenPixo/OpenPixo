// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { McpClientSection } from '../../src/components/McpClientSection';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('exposes the game-engine presets in an expanded picker group', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    servers: [],
    templates: ['Godot', 'Unity', 'Blender'].map((engine) => ({
      id: `${engine.toLowerCase()}-mcp`, label: `${engine} MCP`, category: 'game-engine',
      transport: 'stdio', command: `${engine.toLowerCase()}-mcp`,
      description: `Install ${engine} dependencies manually before use.`,
    })),
  }))));

  render(<McpClientSection />);
  fireEvent.click(await screen.findByRole('button', { name: /Add server/i }));
  expect(screen.getByText('Game engines & 3D').closest('details')?.open).toBe(true);
  for (const engine of ['Godot', 'Unity', 'Blender']) {
    expect(screen.getByRole('button', { name: new RegExp(`${engine} MCP`) })).toBeTruthy();
  }
});
