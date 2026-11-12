// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EngineProfile } from '@openpixo/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { EngineBadge } from '../../src/components/game/EngineBadge';
import { mergeDaemonConfig, DEFAULT_CONFIG, syncConfigToDaemon } from '../../src/state/config';
import { patchProject } from '../../src/state/projects';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const profile: EngineProfile = {
  engine: 'godot', engineVersion: '4.3', confidence: 'certain', detectorVersion: 1,
  evidence: ['project.godot'], languages: ['GDScript'], assetRoots: ['.'], importMetadata: 'godot-import',
  commands: {}, tools: [{ id: 'godot', resolved: false }], detectedAt: 1,
};

it('opens evidence, re-detects through HTTP and links missing tools to settings', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ profile })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ profile: { ...profile, engineVersion: '4.4' } })));
  vi.stubGlobal('fetch', request);
  const settings = vi.fn();
  render(<EngineBadge projectId="game" onOpenSettings={settings} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Godot 4.3 · Certain' }));
  expect(screen.getByText('project.godot')).toBeTruthy();
  expect(screen.getByText(/Missing/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Re-detect' }));
  expect(await screen.findByRole('button', { name: 'Godot 4.4 · Certain' })).toBeTruthy();
  expect(request.mock.calls[1]).toEqual(['/api/projects/game/engine/refresh', expect.objectContaining({ method: 'POST' })]);
  fireEvent.click(screen.getByRole('button', { name: 'Open game engine settings' }));
  expect(settings).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('round-trips engine settings and omits daemon-owned profiles from metadata writes', async () => {
  const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ project: { id: 'game' } })));
  vi.stubGlobal('fetch', request);
  const config = mergeDaemonConfig(DEFAULT_CONFIG, { gameEnginePaths: { godot: 'custom-godot' } });
  await syncConfigToDaemon(config, { throwOnError: true });
  expect(JSON.parse(request.mock.calls[0]![1]!.body as string).gameEnginePaths).toEqual({ godot: 'custom-godot' });
  await patchProject('game', { metadata: { kind: 'prototype', engineProfile: profile } });
  expect(JSON.parse(request.mock.calls[1]![1]!.body as string).metadata).toEqual({ kind: 'prototype' });
});
