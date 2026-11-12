// @vitest-environment jsdom
// Asset actions of the 资源库 browser (spec §6). Ported from the former
// GameAssetsPanel suites: the actions now sit on the one file browser's
// entries, menu and selection bar instead of a separate asset gallery.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetOpReport, AssetProvenance, ProjectAsset, ProjectFile } from '@openpixo/contracts';
import { FilesPanel } from '../../../src/components/FilesPanel';
import { STAGE_ATTACHMENT_EVENT } from '../../../src/runtime/chat/project-file-reference';

vi.mock('../../../src/providers/registry', async (original) => ({
  ...(await original<typeof import('../../../src/providers/registry')>()),
  projectRawUrl: (id: string, name: string) => `/api/projects/${id}/raw/${name}`,
  fetchHostEditors: vi.fn(async () => ({ platform: 'win32', editors: [{ id: 'explorer', available: true }] })),
  openProjectInEditor: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../../src/components/image-editor/ImageEditorDialog', () => ({
  ImageEditorDialog: ({ asset, onSaved, onClose }: { asset: ProjectAsset; onSaved: (asset: ProjectAsset) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Image editor">
      <span>{asset.relPath}</span>
      <button onClick={() => onSaved({ ...asset, relPath: 'Sprites/hero_crop.png', origin: 'processed' })}>Save edited image</button>
      <button onClick={onClose}>Cancel editor</button>
    </div>
  ),
}));

const hero: ProjectFile = { name: 'Sprites/hero.png', kind: 'image', size: 1024, mtime: 1, mime: 'image/png' };
const step: ProjectFile = { name: 'Audio/step.wav', kind: 'audio', size: 512, mtime: 2, mime: 'audio/wav' };
const script: ProjectFile = { name: 'player.gd', kind: 'text', size: 20, mtime: 3, mime: 'text/plain' };
const baseFiles = [hero, step, script];

const assetFor = (file: ProjectFile): ProjectAsset => ({
  projectId: 'p1', relPath: file.name, kind: file.kind === 'image' ? 'image' : file.kind === 'audio' ? 'audio' : 'other',
  size: file.size, mtime: file.mtime, mime: file.mime, semantics: [], tags: [], indexedAt: 1, origin: 'imported',
  ...(file.kind === 'image' ? { width: 128, height: 64 } : {}),
});

let serverAssets: ProjectAsset[];
let history: AssetProvenance[];
let processingReport: AssetOpReport;
const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  serverAssets = baseFiles.map(assetFor);
  history = [];
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const path = url.searchParams.get('path');
    if (url.pathname.endsWith('/info')) return Response.json(serverAssets.find((asset) => asset.relPath === path));
    if (url.pathname.endsWith('/provenance')) return Response.json({ provenance: history });
    if (url.pathname.endsWith('/waveform')) return Response.json({ peaks: [0.2, 1, 0.4], pointsPerSecond: 50, durationMs: 60 });
    if (url.pathname.endsWith('/tags')) {
      const body = JSON.parse(String(init?.body)) as { paths: string[]; add?: string[]; remove?: string[] };
      serverAssets = serverAssets.map((asset) => body.paths.includes(asset.relPath)
        ? { ...asset, tags: [...new Set([...asset.tags, ...body.add ?? []])].filter((tag) => !body.remove?.includes(tag)) } : asset);
      return Response.json({ assets: serverAssets.filter((asset) => body.paths.includes(asset.relPath)), nextCursor: null });
    }
    if (url.pathname.endsWith('/asset-ops')) return Response.json(processingReport);
    throw new Error(`Unexpected fetch ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function renderLibrary(overrides: Partial<ComponentProps<typeof FilesPanel>> = {}) {
  const props: ComponentProps<typeof FilesPanel> = {
    projectId: 'p1', projectKind: 'prototype', files: baseFiles,
    onRefreshFiles: vi.fn(), onOpenFile: vi.fn(), onRenameFile: vi.fn(), onDeleteFile: vi.fn(),
    onDeleteFiles: vi.fn(), onUpload: vi.fn(), onUploadFiles: vi.fn(), onPaste: vi.fn(), ...overrides,
  };
  const view = render(<FilesPanel {...props} />);
  return { ...view, props };
}

/** The 图片 / 音频 filters list the whole project, like the old gallery. */
const showType = (type: 'image' | 'audio' | 'all') => fireEvent.click(document.getElementById(`library-type-${type}`)!);
const select = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
const openMenu = (name: string) => fireEvent.click(screen.getByTestId(`design-file-menu-${name}`));
const menuItem = (name: string) => within(screen.getByTestId('design-file-menu-popover')).getByRole('menuitem', { name });

describe('资源库 asset actions', () => {
  it('opens 素材详情 from an image row with provenance, tags and grid playback data', async () => {
    serverAssets[0] = { ...serverAssets[0]!, origin: 'generated', modifiedSinceProvenance: true,
      engineMeta: { engine: 'unity', source: 'Sprites/hero.png.meta', guid: 'sprite-guid', pairMissing: true } };
    history = [{ id: 'prov1', projectId: 'p1', relPath: 'Sprites/hero.png', contentHash: 'sha-original', origin: 'generated',
      promptText: 'A walking pixel hero', model: 'pixel-model', provider: 'test-provider', referenceHashes: [], createdAt: 10 }];
    renderLibrary();
    showType('image');
    openMenu('Sprites/hero.png');
    fireEvent.click(menuItem('Asset details'));
    const drawer = within(await screen.findByRole('dialog', { name: 'Asset details' }));
    expect(await drawer.findByText('A walking pixel hero')).toBeInTheDocument();
    expect(drawer.getByText(/Modified since generation/)).toBeInTheDocument();
    expect(drawer.getByRole('alert')).toHaveTextContent('paired engine metadata file is missing');
    fireEvent.change(drawer.getByRole('textbox', { name: 'New tag' }), { target: { value: 'hero' } });
    fireEvent.click(drawer.getByRole('button', { name: 'Add tag' }));
    await drawer.findByRole('button', { name: 'Remove tag hero' });
  });

  it('keeps file-only entries free of asset actions', () => {
    renderLibrary();
    openMenu('player.gd');
    expect(screen.queryByTestId('design-file-menu-details')).toBeNull();
    expect(screen.queryByTestId('design-file-menu-edit-image')).toBeNull();
    expect(screen.queryByTestId('design-file-menu-generate-from')).toBeNull();
  });

  it('generates from selected images only, and from one image through its menu', () => {
    const onGenerateFrom = vi.fn();
    renderLibrary({ onGenerateFrom });
    showType('audio');
    select('Audio/step.wav');
    // Audio alone cannot seed an image recipe.
    expect(screen.queryByTestId('file-list-batch-generate-from')).toBeNull();
    // Selection survives a filter change; only the images become references.
    showType('image');
    select('Sprites/hero.png');
    fireEvent.click(screen.getByTestId('file-list-batch-generate-from'));
    expect(onGenerateFrom).toHaveBeenLastCalledWith(['Sprites/hero.png']);
    openMenu('Sprites/hero.png');
    fireEvent.click(menuItem('Generate from this'));
    expect(onGenerateFrom).toHaveBeenCalledTimes(2);
  });

  it('opens the image editor for exactly one image and reveals the saved derivative selected', async () => {
    let files = baseFiles;
    const view = renderLibrary();
    const refresh = vi.fn(async () => {
      files = [...baseFiles, { ...hero, name: 'Sprites/hero_crop.png' }];
      view.rerender(<FilesPanel {...view.props} files={files} onRefreshFiles={refresh} />);
    });
    view.rerender(<FilesPanel {...view.props} onRefreshFiles={refresh} />);
    showType('image');
    select('Sprites/hero.png');
    fireEvent.click(screen.getByTestId('file-list-batch-edit-image'));
    expect(await screen.findByRole('dialog', { name: 'Image editor' })).toHaveTextContent('Sprites/hero.png');
    fireEvent.click(screen.getByRole('button', { name: 'Save edited image' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId('library-search')).toHaveValue('Sprites/hero_crop.png'));
    expect(screen.getByRole('checkbox', { name: 'Select Sprites/hero_crop.png' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('design-file-row-Sprites/hero.png')).toBeNull();
  });

  it('offers editing only for a single image, and processing only for media selections', () => {
    renderLibrary();
    select('player.gd');
    expect(screen.queryByTestId('file-list-batch-process')).toBeNull();
    select('player.gd');
    showType('image');
    select('Sprites/hero.png');
    expect(screen.getByTestId('file-list-batch-edit-image')).toBeTruthy();
    expect(screen.getByTestId('file-list-batch-process')).toBeTruthy();
    showType('audio');
    select('Audio/step.wav');
    expect(screen.queryByTestId('file-list-batch-edit-image')).toBeNull();
    expect(screen.getByTestId('file-list-batch-process')).toBeTruthy();
  });

  it('runs processing on the selected media and refreshes the files', async () => {
    const refresh = vi.fn(async () => {});
    processingReport = { op: 'audio-normalize', params: { lufs: -16 }, tool: 'ffmpeg', dryRun: false, originalsPreserved: true,
      counts: { succeeded: 1, failed: 0, skipped: 0 }, results: [
        { source: 'Audio/step.wav', sourceSha256: 'original', output: 'derived/audio-normalize/Audio/step.wav', status: 'succeeded' },
      ] };
    renderLibrary({ onRefreshFiles: refresh });
    showType('audio');
    select('Audio/step.wav');
    fireEvent.click(screen.getByTestId('file-list-batch-process'));
    const dialog = within(screen.getByRole('dialog', { name: 'Run processing' }));
    fireEvent.change(dialog.getByRole('combobox', { name: 'Operation' }), { target: { value: 'audio-normalize' } });
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Target loudness (LUFS, required)' }), { target: { value: '-16' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Process files' }));
    expect(await dialog.findByRole('status')).toHaveTextContent('1 succeeded · 0 failed · 0 skipped');
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/asset-ops'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ op: 'audio-normalize', inputs: ['Audio/step.wav'], params: { lufs: -16 } });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it('adds media to the chat from the details drawer', async () => {
    const staged = vi.fn((event: Event) => event.preventDefault());
    window.addEventListener(STAGE_ATTACHMENT_EVENT, staged, { once: true });
    renderLibrary();
    showType('audio');
    openMenu('Audio/step.wav');
    fireEvent.click(menuItem('Asset details'));
    const drawer = within(await screen.findByRole('dialog', { name: 'Asset details' }));
    expect(await drawer.findByRole('img', { name: 'Audio waveform' })).toBeInTheDocument();
    fireEvent.click(await drawer.findByRole('button', { name: /Add to chat/ }));
    expect(staged).toHaveBeenCalledWith(expect.objectContaining({ detail: { attachments: [
      { path: 'Audio/step.wav', name: 'step.wav', kind: 'file', size: 512 },
    ] } }));
  });

  it('keeps a viewer read-only: details open, nothing mutates', async () => {
    const onGenerateFrom = vi.fn();
    renderLibrary({ viewerOnly: true, onGenerateFrom });
    showType('image');
    expect(screen.queryByRole('checkbox', { name: 'Select Sprites/hero.png' })).toBeNull();
    openMenu('Sprites/hero.png');
    for (const id of ['add-to-chat', 'generate-from', 'edit-image']) {
      expect(screen.queryByTestId(`design-file-menu-${id}`)).toBeNull();
    }
    expect(screen.queryByTestId('design-file-delete-Sprites/hero.png')).toBeNull();
    fireEvent.click(menuItem('Asset details'));
    const drawer = within(await screen.findByRole('dialog', { name: 'Asset details' }));
    await drawer.findByText('No generation or processing history recorded.');
    expect(drawer.queryByRole('button', { name: 'Add tag' })).toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    expect(onGenerateFrom).not.toHaveBeenCalled();
  });
});
