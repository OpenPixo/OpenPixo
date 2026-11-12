// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntryMenu, type EntryMenuActions } from '../../src/components/library/EntryMenu';
import { en } from '../../src/i18n/locales/en';

afterEach(cleanup);

const t = ((key: keyof typeof en) => en[key]) as never;

function renderMenu(overrides: Partial<EntryMenuActions> = {}, onClose = vi.fn()) {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  const view = render(
    <EntryMenu
      projectId="p1"
      position={{ name: 'hero.png', top: 0, left: 0 }}
      actions={{ open: vi.fn(), copyRelativePath: vi.fn(), delete: vi.fn(), ...overrides }}
      t={t}
      onClose={onClose}
    />,
  );
  return { ...view, opener, onClose };
}

describe('EntryMenu keyboard', () => {
  it('is a menu whose first item takes focus', () => {
    renderMenu();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
  });

  it('arrows wrap, Home and End jump, and the disabled item is skipped', () => {
    renderMenu();
    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem') as HTMLButtonElement[];
    const enabled = items.filter(item => !item.disabled);
    expect(items.length).toBeGreaterThan(enabled.length);

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(enabled.at(-1));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(enabled[0]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(enabled.at(-1));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(enabled[0]);
  });

  it('has no anchor around a button, and Esc returns focus to the opener', () => {
    const { container, opener, onClose } = renderMenu();
    expect(container.querySelector('a button')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
