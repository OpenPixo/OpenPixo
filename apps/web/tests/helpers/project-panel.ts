// Drives the project side panel (specs/current/openpixo-game-panel.md §3)
// from integration tests through its real controls: the view switcher, the
// ← bar of a view's stack and the 资源库 file browser. Synchronous on
// purpose, so callers may hold fake timers.
import { fireEvent, screen, within } from '@testing-library/react';

export type PanelViewName = 'Game' | 'Changes' | 'Files';

export function showPanelView(name: PanelViewName): void {
  const switcher = screen.getByTestId('panel-view-switcher');
  fireEvent.click(within(switcher).getByRole('tab', { name: new RegExp(`^${name}`) }));
}

/** The item the current view shows over its root, or null at the root. */
export function panelShownItem(): string | null {
  const bar = screen.getByTestId('panel-stack-bar');
  if (bar.hasAttribute('hidden')) return null;
  return within(bar).getByTestId('panel-stack-label').textContent;
}

/** ← until the current view shows `name` (an item lower in its stack). */
export function panelBackTo(name: string): void {
  for (let guard = 0; guard < 50 && panelShownItem() !== name; guard += 1) {
    if (panelShownItem() === null) throw new Error(`${name} is not on this view's stack`);
    panelBack();
  }
}

/** ← once: the current view returns to what was under its top item. */
export function panelBack(): void {
  fireEvent.click(screen.getByTestId('panel-stack-back'));
}

/** Show 资源库's file browser, going back past anything stacked over it. */
export function showLibraryFiles(): void {
  showPanelView('Files');
  for (let guard = 0; guard < 50 && panelShownItem() !== null; guard += 1) panelBack();
}

/** "New document" from 资源库's file browser (empty state or its project menu). */
export async function createDocumentInLibrary(): Promise<void> {
  showLibraryFiles();
  const empty = screen.queryByTestId('file-list-empty-new-document');
  if (empty) {
    fireEvent.click(empty);
    return;
  }
  fireEvent.click(screen.getByRole('button', { name: /^Project actions$/ }));
  fireEvent.click(await screen.findByTestId('file-list-menu-new-document'));
}

/**
 * Open an existing file from 资源库's browser so it sits on top of the stack.
 * The browser lists one folder level at a time, so a nested file is found
 * through the path search. Call outside `act()`: each step must render.
 */
export function openFromLibrary(name: string): void {
  showLibraryFiles();
  let row = screen.queryByTestId(`design-file-row-${name}`);
  const search = screen.queryByTestId('library-search');
  if (!row && search) {
    fireEvent.change(search, { target: { value: name } });
    row = screen.queryByTestId(`design-file-row-${name}`);
  }
  if (!row) throw new Error(`no 资源库 row for ${name}`);
  const target = within(row).queryByRole('button', { name: `Open ${name}` })
    ?? row.querySelector<HTMLElement>('.df-card-thumb, .df-row-name-btn');
  if (!target) throw new Error(`no open control for ${name}`);
  fireEvent.click(target);
}
