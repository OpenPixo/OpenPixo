// @vitest-environment jsdom
/**
 * 2026-11-10 beginner audit: the game's 「导出」 menu offered 「导出为 PDF / 导出为图片 /
 * 导出为独立 HTML」 from the design tool, and nothing that runs outside OpenPixo. On a
 * web game's own page the menu now offers the playable export instead.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

const seam = vi.hoisted(() => ({ exportPlayable: vi.fn(), status: vi.fn() }));
vi.mock('../../src/runtime/exports', async () => ({
  ...await vi.importActual('../../src/runtime/exports'),
  exportPlayableGame: seam.exportPlayable,
  fetchGameExportStatus: seam.status,
}));

const page = (name: string): ProjectFile => ({
  name, path: name, type: 'file', size: 100, mtime: 1, kind: 'html', mime: 'text/html',
  artifactManifest: { version: 1, kind: 'html', title: 'Page', entry: name, renderer: 'html', exports: ['html'] },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ deployments: [] }), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openMenu(file: ProjectFile) {
  render(<FileViewer projectId="game" projectKind="prototype" file={file} liveHtml="<html><body><canvas></canvas></body></html>" />);
  await waitFor(() => expect(seam.status).toHaveBeenCalledWith('game', expect.anything()));
  fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
}

describe('the export menu on a web game', () => {
  it('offers the playable game instead of PDF, image and standalone HTML', async () => {
    seam.status.mockResolvedValue({ available: true, entry: 'index.html' });
    seam.exportPlayable.mockResolvedValue('download');
    await openMenu(page('index.html'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export playable game' }));
    await waitFor(() => expect(seam.exportPlayable).toHaveBeenCalledWith({ projectId: 'game', fallbackTitle: expect.any(String) }));
    fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
    expect(screen.queryByRole('menuitem', { name: /Export as PDF/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Export as standalone HTML/i })).toBeNull();
  });

  it('keeps the document exports for other pages, and for projects that are not web games', async () => {
    seam.status.mockResolvedValue({ available: true, entry: 'index.html' });
    await openMenu(page('docs/design.html'));
    expect(await screen.findByRole('menuitem', { name: /Export as standalone HTML/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Export playable game' })).toBeNull();
    cleanup();
    seam.status.mockResolvedValue({ available: false, message: 'Godot games cannot be exported' });
    await openMenu(page('index.html'));
    expect(await screen.findByRole('menuitem', { name: /Export as standalone HTML/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Export playable game' })).toBeNull();
  });
});
