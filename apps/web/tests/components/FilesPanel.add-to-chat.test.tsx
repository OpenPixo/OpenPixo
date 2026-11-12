// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesPanel } from '../../src/components/FilesPanel';
import { ViewerAddToChat } from '../../src/components/files/ViewerAddToChat';
import { STAGE_ATTACHMENT_EVENT, type StageAttachmentEventDetail } from '../../src/runtime/chat/project-file-reference';
import type { ProjectFile } from '../../src/types';

const hero: ProjectFile = { name: 'art/hero.png', path: 'art/hero.png', kind: 'image', mime: 'image/png', size: 2048, mtime: 1 };
const tiles: ProjectFile = { name: 'art/tiles.png', path: 'art/tiles.png', kind: 'image', mime: 'image/png', size: 4096, mtime: 2 };
const script: ProjectFile = { name: 'src/player.ts', path: 'src/player.ts', kind: 'code', mime: 'text/plain', size: 64, mtime: 3 };

function renderPanel(overrides: Partial<ComponentProps<typeof FilesPanel>> = {}) {
  const props: ComponentProps<typeof FilesPanel> = {
    projectId: 'game', projectKind: 'prototype', files: [hero, tiles, script],
    onRefreshFiles: vi.fn(), onOpenFile: vi.fn(), onRenameFile: vi.fn(),
    onDeleteFile: vi.fn(), onDeleteFiles: vi.fn(), onUpload: vi.fn(),
    onUploadFiles: vi.fn(), onPaste: vi.fn(), onDuplicateProject: vi.fn(), ...overrides,
  };
  const result = render(<FilesPanel {...props} />);
  return { ...result, props };
}

function showTab(id: 'image' | 'script') {
  fireEvent.click(document.getElementById(`library-type-${id}`)!);
}

/** Stands in for the open chat composer: records and acknowledges staged files. */
function listenAsComposer() {
  const staged: StageAttachmentEventDetail[] = [];
  const listener = (event: Event) => {
    event.preventDefault();
    staged.push((event as CustomEvent<StageAttachmentEventDetail>).detail);
  };
  window.addEventListener(STAGE_ATTACHMENT_EVENT, listener);
  return { staged, stop: () => window.removeEventListener(STAGE_ATTACHMENT_EVENT, listener) };
}

let composer: ReturnType<typeof listenAsComposer> | null = null;
beforeEach(() => { localStorage.clear(); });
afterEach(() => { composer?.stop(); composer = null; cleanup(); vi.clearAllMocks(); });

describe('File Browser → chat references', () => {
  it('adds an image from its card as an image reference and confirms it', () => {
    composer = listenAsComposer();
    renderPanel();
    showTab('image');
    fireEvent.click(screen.getByRole('button', { name: 'Add hero.png to chat' }));
    expect(composer.staged).toEqual([{ attachments: [{ path: 'art/hero.png', name: 'hero.png', kind: 'image', size: 2048 }] }]);
    expect(screen.getByRole('status')).toHaveTextContent('Added 1 to the chat as references.');
  });

  it('adds a list row from its hover button as a file reference', () => {
    composer = listenAsComposer();
    renderPanel();
    showTab('script');
    fireEvent.click(screen.getByRole('button', { name: 'Add player.ts to chat' }));
    expect(composer.staged[0]?.attachments).toEqual([{ path: 'src/player.ts', name: 'player.ts', kind: 'file', size: 64 }]);
  });

  it('says a chat must be open when no composer takes the files', () => {
    renderPanel();
    showTab('image');
    fireEvent.click(screen.getByRole('button', { name: 'Add hero.png to chat' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Open a chat first, then add files to it.');
  });

  it('offers Add to chat first in the row menu and on right-click', () => {
    composer = listenAsComposer();
    renderPanel();
    showTab('image');
    fireEvent.contextMenu(screen.getByTestId('design-file-row-art/tiles.png'), { clientX: 40, clientY: 60 });
    const menu = screen.getByTestId('design-file-menu-popover');
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveTextContent('Add to chat');
    fireEvent.click(within(menu).getByTestId('design-file-menu-add-to-chat'));
    expect(composer.staged[0]?.attachments.map(item => item.path)).toEqual(['art/tiles.png']);
    expect(screen.queryByTestId('design-file-menu-popover')).toBeNull();
  });

  it('adds a multi-selection from the batch bar and from the menu of a selected file', () => {
    composer = listenAsComposer();
    renderPanel();
    showTab('image');
    for (const name of [hero.name, tiles.name]) {
      fireEvent.click(within(screen.getByTestId(`design-file-row-${name}`)).getByRole('checkbox'));
    }
    fireEvent.click(screen.getByTestId('design-file-menu-art/tiles.png'));
    expect(screen.getByTestId('design-file-menu-add-to-chat')).toHaveTextContent('Add 2 to chat');
    fireEvent.click(screen.getByTestId('design-file-menu-add-to-chat'));
    expect(composer.staged[0]?.attachments.map(item => item.path)).toEqual(['art/tiles.png', 'art/hero.png']);

    for (const name of [hero.name, tiles.name]) {
      fireEvent.click(within(screen.getByTestId(`design-file-row-${name}`)).getByRole('checkbox'));
    }
    fireEvent.click(screen.getByTestId('file-list-batch-add-to-chat'));
    expect(composer.staged[1]?.attachments.map(item => item.path)).toEqual(['art/hero.png', 'art/tiles.png']);
    // A successful multi-add clears the selection.
    expect(screen.queryByTestId('file-list-batch-bar')).toBeNull();
  });

  it('drags the whole selection when a selected file is dragged', () => {
    renderPanel();
    showTab('image');
    fireEvent.click(within(screen.getByTestId('design-file-row-art/hero.png')).getByRole('checkbox'));
    fireEvent.click(within(screen.getByTestId('design-file-row-art/tiles.png')).getByRole('checkbox'));
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() };
    fireEvent.dragStart(screen.getByTestId('design-file-row-art/tiles.png'), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-openpixo-project-file',
      JSON.stringify({ projectId: 'game', path: 'art/tiles.png', paths: ['art/tiles.png', 'art/hero.png'] }));
  });

  it('hides chat actions from read-only viewers', () => {
    renderPanel({ viewerOnly: true });
    showTab('image');
    expect(screen.queryByRole('button', { name: /to chat$/ })).toBeNull();
  });
});

describe('File Browser fixes', () => {
  it('opens an inline rename field on image cards from the menu', () => {
    renderPanel();
    showTab('image');
    fireEvent.click(screen.getByTestId('design-file-menu-art/hero.png'));
    fireEvent.click(within(screen.getByTestId('design-file-menu-popover')).getByRole('menuitem', { name: 'Rename' }));
    expect(within(screen.getByTestId('design-file-row-art/hero.png')).getByRole('textbox', { name: 'Rename' })).toHaveValue('art/hero.png');
  });

  it('keeps Upload and New document reachable once the project has files', () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    fireEvent.click(screen.getByTestId('file-list-menu-upload'));
    expect(props.onUpload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    fireEvent.click(screen.getByTestId('file-list-menu-new-document'));
    expect(props.onPaste).toHaveBeenCalledOnce();
  });

  it('labels the batch bar with the selection count', () => {
    renderPanel();
    showTab('image');
    fireEvent.click(within(screen.getByTestId('design-file-row-art/hero.png')).getByRole('checkbox'));
    expect(screen.getByTestId('file-list-batch-bar')).toHaveTextContent('1 selected');
  });
});

describe('Viewer → chat', () => {
  it('adds the open file and reports the outcome on the button', async () => {
    composer = listenAsComposer();
    render(<ViewerAddToChat file={hero} />);
    fireEvent.click(screen.getByTestId('viewer-add-to-chat'));
    expect(composer.staged[0]?.attachments).toEqual([{ path: 'art/hero.png', name: 'hero.png', kind: 'image', size: 2048 }]);
    expect(screen.getByTestId('viewer-add-to-chat')).toHaveTextContent('Added to chat');
    composer.stop(); composer = null;
    cleanup();
    render(<ViewerAddToChat file={hero} />);
    fireEvent.click(screen.getByTestId('viewer-add-to-chat'));
    expect(screen.getByTestId('viewer-add-to-chat')).toHaveTextContent('Open a chat first');
  });
});
