// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clampMenuPosition,
  tidyContextMenuEntries,
  useContextMenu,
  type ContextMenuEntry,
} from '../../src/components/context-menu/ContextMenu';

vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function Surface({ entries }: { entries: ContextMenuEntry[] }) {
  const menu = useContextMenu();
  return (
    <>
      <button type="button" onContextMenu={(event) => menu.openAt(event, 'hero.png', entries)}>hero.png</button>
      {menu.menu}
    </>
  );
}

describe('tidyContextMenuEntries', () => {
  it('drops leading, trailing and doubled separators and empty submenus', () => {
    const run = () => {};
    const tidy = tidyContextMenuEntries([
      { kind: 'separator', id: 's0' },
      { id: 'a', label: 'A', onSelect: run },
      { kind: 'separator', id: 's1' },
      { kind: 'submenu', id: 'empty', label: 'Empty', items: [] },
      { kind: 'separator', id: 's2' },
      { id: 'b', label: 'B', onSelect: run },
      { kind: 'separator', id: 's3' },
    ]);
    expect(tidy.map((entry) => entry.id)).toEqual(['a', 's1', 'b']);
  });
});

describe('clampMenuPosition', () => {
  it('opens at the pointer when it fits, and flips inside the window when it does not', () => {
    const viewport = { width: 800, height: 600 };
    expect(clampMenuPosition(100, 100, 200, 150, viewport)).toEqual({ left: 100, top: 100 });
    expect(clampMenuPosition(700, 550, 200, 150, viewport)).toEqual({ left: 592, top: 442 });
  });
});

describe('useContextMenu', () => {
  const copyImage = vi.fn();
  const copyPath = vi.fn();
  const remove = vi.fn();
  const entries: ContextMenuEntry[] = [
    { id: 'copy-image', label: 'Copy image', onSelect: copyImage },
    { kind: 'submenu', id: 'copy', label: 'Copy', items: [{ id: 'copy-path', label: 'Relative path', onSelect: copyPath }] },
    { kind: 'separator', id: 'sep' },
    { id: 'delete', label: 'Delete', shortcut: 'D', danger: true, onSelect: remove },
  ];

  it('opens on right-click with the first item focused, and runs an item on click', async () => {
    render(<Surface entries={entries} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'hero.png' }), { clientX: 30, clientY: 40 });
    const menu = await screen.findByRole('menu', { name: 'hero.png' });
    expect(document.activeElement?.textContent).toBe('Copy image');
    expect(menu.querySelectorAll('[role="separator"]').length).toBe(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy image' }));
    expect(copyImage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves with the arrow keys and opens the submenu with ArrowRight', async () => {
    render(<Surface entries={entries} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'hero.png' }), { clientX: 30, clientY: 40 });
    const menu = await screen.findByRole('menu', { name: 'hero.png' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-submenu')).toBe('copy');
    await act(async () => { fireEvent.keyDown(menu, { key: 'ArrowRight' }); });
    const sub = await screen.findByRole('menu', { name: 'Copy' });
    expect(document.activeElement?.textContent).toBe('Relative path');
    fireEvent.keyDown(sub, { key: 'ArrowLeft' });
    expect(screen.queryByRole('menu', { name: 'Copy' })).toBeNull();
    expect(document.activeElement?.getAttribute('data-submenu')).toBe('copy');
  });

  it('runs an item from its letter', async () => {
    render(<Surface entries={entries} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'hero.png' }), { clientX: 30, clientY: 40 });
    const menu = await screen.findByRole('menu', { name: 'hero.png' });
    fireEvent.keyDown(menu, { key: 'd' });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('closes on a press outside without running anything', async () => {
    render(<Surface entries={entries} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'hero.png' }), { clientX: 30, clientY: 40 });
    await screen.findByRole('menu', { name: 'hero.png' });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(copyImage).not.toHaveBeenCalled();
  });

  it('opens from the keyboard menu key at the element, not the window corner', async () => {
    render(<Surface entries={entries} />);
    const button = screen.getByRole('button', { name: 'hero.png' });
    button.getBoundingClientRect = () => ({ left: 200, top: 300, width: 80, height: 20, right: 280, bottom: 320, x: 200, y: 300, toJSON: () => ({}) });
    fireEvent.contextMenu(button, { clientX: 0, clientY: 0 });
    const menu = await screen.findByRole('menu', { name: 'hero.png' });
    expect(menu.style.left).toBe('224px');
    expect(menu.style.top).toBe('310px');
  });
});
