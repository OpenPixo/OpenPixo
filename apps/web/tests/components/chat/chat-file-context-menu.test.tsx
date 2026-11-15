// @vitest-environment jsdom
/**
 * Right-click on what a turn made: the images in the message and the files it
 * changed open the shared file menu (copy image, save, attach, copy path).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetGallery } from '../../../src/components/chat/AssetGallery';
import { TurnChanges } from '../../../src/components/chat/TurnChanges';
import { STAGE_ATTACHMENT_EVENT } from '../../../src/runtime/chat/project-file-reference';
import type { TurnChangeRow } from '../../../src/runtime/chat/turn-changes';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function itemIds(menu: HTMLElement): string[] {
  return within(menu).getAllByRole('menuitem').map((item) => item.getAttribute('data-testid') ?? '');
}

describe('right-click on a turn image', () => {
  it('offers the image actions and hands the image to the chat', async () => {
    const onOpenFile = vi.fn();
    render(
      <AssetGallery
        assets={[{ path: 'assets/hero.png', source: 'media', kind: 'image' }]}
        projectId="p1"
        imageSrc={(path) => `/raw/${path}`}
        onOpenFile={onOpenFile}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('chat-asset-assets/hero.png'), { clientX: 20, clientY: 20 });
    const menu = await screen.findByRole('menu', { name: 'hero.png' });
    expect(itemIds(menu)).toEqual([
      'context-menu-open', 'context-menu-copy-image', 'context-menu-save', 'context-menu-attach', 'context-menu-copy',
    ]);

    const staged: unknown[] = [];
    const take = (event: Event) => { event.preventDefault(); staged.push((event as CustomEvent).detail); };
    window.addEventListener(STAGE_ATTACHMENT_EVENT, take);
    try {
      fireEvent.click(within(menu).getByTestId('context-menu-attach'));
    } finally {
      window.removeEventListener(STAGE_ATTACHMENT_EVENT, take);
    }
    expect(staged).toEqual([{ attachments: [{ path: 'assets/hero.png', name: 'hero.png', kind: 'image' }] }]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('leaves the browser menu alone outside the items', () => {
    render(<AssetGallery assets={[{ path: 'assets/hero.png', source: 'media', kind: 'image' }]} projectId="p1" imageSrc={(path) => path} />);
    const event = fireEvent.contextMenu(screen.getByTestId('chat-asset-gallery'));
    expect(event).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('right-click on a changed file', () => {
  const row = (path: string, overrides: Partial<TurnChangeRow> = {}): TurnChangeRow => ({
    path, status: 'modified', added: 1, removed: 0, checkpointId: 'cp', ...overrides,
  });

  it('opens the file menu when the message gives one', async () => {
    render(<TurnChanges rows={[row('src/main.gd')]} onOpenRow={vi.fn()}
      fileMenu={{ projectId: 'p1', fileUrl: (path) => `/raw/${path}`, onOpenFile: vi.fn() }} />);
    fireEvent.contextMenu(screen.getByTestId('chat-turn-change-src/main.gd'), { clientX: 20, clientY: 20 });
    const menu = await screen.findByRole('menu', { name: 'main.gd' });
    expect(itemIds(menu)).toEqual(['context-menu-open', 'context-menu-save', 'context-menu-attach', 'context-menu-copy']);
  });

  it('gives a deleted file only Copy', async () => {
    render(<TurnChanges rows={[row('old.txt', { status: 'deleted', checkpointId: null })]}
      fileMenu={{ projectId: 'p1', fileUrl: (path) => path }} />);
    fireEvent.contextMenu(screen.getByTestId('chat-turn-change-old.txt'), { clientX: 20, clientY: 20 });
    const menu = await screen.findByRole('menu', { name: 'old.txt' });
    expect(itemIds(menu)).toEqual(['context-menu-copy']);
  });
});
