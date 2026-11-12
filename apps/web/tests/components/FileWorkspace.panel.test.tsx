// @vitest-environment jsdom

// The game-first panel frame (specs/current/openpixo-game-panel.md §3, slice 1):
// view switcher and its persistence, per-view stacks, where opens land, the ⋯
// menu and starter requests.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PANEL_CHANGES_ROOT } from '../../src/components/panel/panel-nav';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileWorkspace } from '../../src/components/FileWorkspace';
import { createTerminal, killTerminal } from '../../src/state/projects';
import type { OpenTabsState, ProjectFile } from '../../src/types';

vi.mock('../../src/providers/registry', async () => ({
  ...(await vi.importActual<typeof import('../../src/providers/registry')>('../../src/providers/registry')),
  fetchProjectFileText: vi.fn().mockResolvedValue(''),
  fetchProjectFolders: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/state/projects', async () => ({
  ...(await vi.importActual<typeof import('../../src/state/projects')>('../../src/state/projects')),
  createTerminal: vi.fn(async () => ({ id: 'pty-1' })),
  killTerminal: vi.fn(async () => true),
}));
vi.mock('../../src/components/tuning/tuning-api', async () => ({
  ...(await vi.importActual<typeof import('../../src/components/tuning/tuning-api')>('../../src/components/tuning/tuning-api')),
  listGameTuning: vi.fn(async () => ({ parameters: [], warnings: [] })),
}));
vi.mock('../../src/components/FileViewer', () => ({
  FileViewer: ({ file }: { file: ProjectFile }) => <div data-testid="file-viewer">{file.name}</div>,
}));
vi.mock('../../src/components/workspace/TerminalViewer', () => ({
  TerminalViewer: ({ terminalId }: { terminalId: string }) => <div data-testid="terminal-viewer">{terminalId}</div>,
}));
vi.mock('../../src/components/studio/StudioPanel', () => ({
  StudioPanel: ({ referencePaths = [] }: { referencePaths?: string[] }) => (
    <div>Studio recipes<span data-testid="studio-references">{referencePaths.join(',')}</span></div>
  ),
}));
vi.mock('../../src/components/ProjectExtensionsPanel', () => ({ ProjectExtensionsPanel: () => <div>Extensions form</div> }));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function image(name: string): ProjectFile {
  return { name, path: name, type: 'file', size: 10, mtime: 1, kind: 'image', mime: 'image/png' };
}
const FILES = [image('hero.png'), image('enemy.png')];

type Props = ComponentProps<typeof FileWorkspace>;
function Harness(props: Partial<Props> & { onTabs?: (state: OpenTabsState) => void }) {
  const [tabsState, setTabsState] = useState<OpenTabsState>(props.tabsState ?? { tabs: [], active: null });
  return (
    <FileWorkspace
      projectId="game"
      projectKind="prototype"
      files={FILES}
      onRefreshFiles={vi.fn()}
      {...props}
      tabsState={tabsState}
      onTabsStateChange={(next) => { setTabsState(next); props.onTabs?.(next); }}
    />
  );
}

const view = (name: 'Game' | 'Changes' | 'Files') => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const selectedView = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;
const stackLabel = () => (screen.getByTestId('panel-stack-bar').hasAttribute('hidden') ? null : screen.getByTestId('panel-stack-label').textContent);

function openLibraryCard(name: string) {
  const row = screen.getByTestId(`design-file-row-${name}`);
  const open = row.querySelector<HTMLButtonElement>('.df-card-thumb, .df-row-name-btn');
  if (!open) throw new Error(`no open control for ${name}`);
  fireEvent.click(open);
}

describe('panel view switcher', () => {
  it('opens on 游戏 by default, with one header row and no file tabs', () => {
    render(<Harness />);
    expect(selectedView()).toBe('Game');
    expect(screen.getAllByTestId('panel-header')).toHaveLength(1);
    expect(screen.queryByTestId('file-list-tab')).toBeNull();
    expect(screen.queryByTestId('workspace-add-tab')).toBeNull();
    expect(screen.getByTestId('panel-game-stage').textContent).toContain('Press Run');
  });

  it('remembers the view per project and replaces the old section key', () => {
    window.localStorage.setItem('pixo:project-workspace-tab:game', 'assets');
    const first = render(<Harness />);
    fireEvent.click(view('Files'));
    expect(window.localStorage.getItem('pixo:project-panel-view:game')).toBe('library');
    expect(window.localStorage.getItem('pixo:project-workspace-tab:game')).toBeNull();
    first.unmount();

    const other = render(<Harness projectId="other" />);
    expect(selectedView()).toBe('Game');
    other.unmount();

    render(<Harness />);
    expect(selectedView()).toBe('Files');
  });

  it('ignores unknown saved views and still switches when storage is blocked', () => {
    window.localStorage.setItem('pixo:project-panel-view:game', 'tuning');
    const first = render(<Harness />);
    expect(selectedView()).toBe('Game');
    first.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<Harness />);
    fireEvent.click(view('Changes'));
    expect(selectedView()).toBe('Changes');
  });

  it('shows the 改动 badge only for a positive count', () => {
    const { rerender } = render(<FileWorkspace projectId="game" projectKind="prototype" files={[]} onRefreshFiles={vi.fn()}
      tabsState={{ tabs: [], active: null }} onTabsStateChange={vi.fn()} />);
    expect(screen.queryByTestId('panel-changes-badge')).toBeNull();
    rerender(<FileWorkspace projectId="game" projectKind="prototype" files={[]} onRefreshFiles={vi.fn()}
      tabsState={{ tabs: [], active: null }} onTabsStateChange={vi.fn()} changesBadge={3} />);
    expect(within(view('Changes')).getByTestId('panel-changes-badge').textContent).toBe('3');
  });
});

describe('per-view stacks', () => {
  it('pushes an open in place with ← back, pops with ← and Esc, and keeps each view stack across switches', async () => {
    const onTabs = vi.fn();
    render(<Harness onTabs={onTabs} />);
    fireEvent.click(view('Files'));
    openLibraryCard('hero.png');
    expect(await screen.findByTestId('file-viewer')).toHaveTextContent('hero.png');
    expect(stackLabel()).toBe('hero.png');
    expect(onTabs).toHaveBeenLastCalledWith({ tabs: ['hero.png'], active: 'hero.png' });
    // ← takes focus after an in-panel open so Esc reaches the panel.
    expect(document.activeElement).toBe(screen.getByTestId('panel-stack-back'));

    // 游戏 has its own (empty) stack; 资源库 keeps the file.
    fireEvent.click(view('Game'));
    expect(stackLabel()).toBeNull();
    expect(onTabs).toHaveBeenLastCalledWith({ tabs: ['hero.png'], active: null });
    fireEvent.click(view('Files'));
    expect(stackLabel()).toBe('hero.png');

    fireEvent.click(screen.getByTestId('panel-stack-back'));
    expect(stackLabel()).toBeNull();
    expect(screen.getByTestId(`design-file-row-hero.png`)).toBeTruthy();

    openLibraryCard('enemy.png');
    expect(stackLabel()).toBe('enemy.png');
    fireEvent.keyDown(screen.getByTestId('panel-stack-back'), { key: 'Escape' });
    expect(stackLabel()).toBeNull();
    expect(onTabs).toHaveBeenLastCalledWith({ tabs: [], active: null });
  });

  it('does not pop on Esc from a text field', async () => {
    render(<Harness tabsState={{ tabs: ['hero.png'], active: 'hero.png' }} />);
    fireEvent.click(view('Files'));
    expect(stackLabel()).toBe('hero.png');
    const field = document.createElement('input');
    screen.getByTestId('file-workspace').appendChild(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(stackLabel()).toBe('hero.png');
  });

  it('opens a terminal from ⋯ on the current view and keeps its session across view switches', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('panel-more-menu'));
    fireEvent.click(screen.getByTestId('panel-menu-new-terminal'));
    expect(await screen.findByTestId('terminal-viewer')).toHaveTextContent('pty-1');
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(selectedView()).toBe('Game');

    fireEvent.click(view('Files'));
    expect(screen.queryByTestId('terminal-viewer')).toBeNull();
    fireEvent.click(view('Game'));
    expect(screen.getByTestId('terminal-viewer')).toHaveTextContent('pty-1');
    expect(killTerminal).not.toHaveBeenCalled();

    // Leaving the stack is the explicit close: the PTY goes with it.
    fireEvent.click(screen.getByTestId('panel-stack-back'));
    expect(screen.queryByTestId('terminal-viewer')).toBeNull();
    expect(killTerminal).toHaveBeenCalledWith('game', 'pty-1', { keepalive: true });
  });

  it('opens 项目扩展 from ⋯ as a sheet over the panel', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('panel-more-menu'));
    fireEvent.click(screen.getByTestId('panel-menu-extensions'));
    const sheet = screen.getByTestId('panel-extensions-sheet');
    expect(sheet).toHaveAttribute('data-open');
    expect(within(sheet).getByText('Extensions form')).toBeTruthy();
    fireEvent.keyDown(within(sheet).getByRole('button', { name: 'Close' }), { key: 'Escape' });
    expect(sheet).not.toHaveAttribute('data-open');
  });

  it('offers engine settings in ⋯', () => {
    const onOpenEngineSettings = vi.fn();
    render(<Harness onOpenEngineSettings={onOpenEngineSettings} />);
    fireEvent.click(screen.getByTestId('panel-more-menu'));
    fireEvent.click(screen.getByTestId('panel-menu-engine-settings'));
    expect(onOpenEngineSettings).toHaveBeenCalledTimes(1);
  });
});

describe('where opens land', () => {
  it('puts a conversation open on 资源库 and switches there', async () => {
    const { rerender } = render(<Harness />);
    expect(selectedView()).toBe('Game');
    rerender(<Harness openRequest={{ name: 'enemy.png', nonce: 1, origin: 'conversation' }} />);
    await waitFor(() => expect(selectedView()).toBe('Files'));
    expect(stackLabel()).toBe('enemy.png');
    // A conversation open does not steal focus from the composer.
    expect(document.activeElement).not.toBe(screen.getByTestId('panel-stack-back'));
  });

  it('queues a host-driven open (auto-open batch, agent focus) on 资源库 without switching the view', async () => {
    const onTabs = vi.fn();
    const { rerender } = render(<Harness onTabs={onTabs} />);
    rerender(<Harness onTabs={onTabs} openRequest={{ name: 'hero.png', nonce: 1, openBatch: ['enemy.png', 'hero.png'] }} />);
    await act(async () => {});
    expect(selectedView()).toBe('Game');
    expect(stackLabel()).toBeNull();
    // Only the turn's main artifact: the others are listed in the chat, not piled up here.
    expect(onTabs).toHaveBeenLastCalledWith({ tabs: ['hero.png'], active: null });

    fireEvent.click(view('Files'));
    expect(stackLabel()).toBe('hero.png');
    // Pressing the current view again returns to its list.
    fireEvent.click(view('Files'));
    expect(stackLabel()).toBeNull();
  });

  it('goes to the list of changes when the conversation asks, past whatever 改动 had open', async () => {
    const { rerender } = render(<Harness />);
    rerender(<Harness openRequest={{ name: 'diff:abc123defg:src/game.js', nonce: 1, origin: 'conversation' }} />);
    await waitFor(() => expect(selectedView()).toBe('Changes'));
    expect(stackLabel()).toBe('game.js');
    fireEvent.click(view('Game'));
    rerender(<Harness openRequest={{ name: PANEL_CHANGES_ROOT, nonce: 2, origin: 'conversation' }} />);
    await waitFor(() => expect(selectedView()).toBe('Changes'));
    expect(stackLabel()).toBeNull();
  });

  it('leaves an item the user opened in another view where it is', async () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByTestId('panel-more-menu'));
    fireEvent.click(screen.getByTestId('panel-menu-new-terminal'));
    expect(await screen.findByTestId('terminal-viewer')).toBeTruthy();
    rerender(<Harness openRequest={{ name: 'terminal:pty-1', nonce: 1 }} />);
    await act(async () => {});
    expect(selectedView()).toBe('Game');
    expect(screen.getByTestId('terminal-viewer')).toHaveTextContent('pty-1');
  });

  it('switches to 游戏 for a starter Verify / Run request and starts it inline', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => Response.json(
      init?.method === 'POST' ? { status: 'starting' } : { status: 'idle' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      window.localStorage.setItem('pixo:project-panel-view:game', 'library');
      const idle = { verifyAvailable: false, startRequest: null };
      const { rerender } = render(<Harness gameControls={idle} />);
      expect(selectedView()).toBe('Files');
      rerender(<Harness gameControls={{ verifyAvailable: false, startRequest: { kind: 'run-game', nonce: 1 } }} gameViewRequest={1} />);
      expect(selectedView()).toBe('Game');
      const gameView = screen.getByTestId('panel-game-view');
      expect(within(gameView).getByRole('toolbar').contains(within(gameView).getByRole('button', { name: 'Stop' }))).toBe(true);
      await act(async () => {});
      expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/game/run') && init?.method === 'POST')).toHaveLength(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('routes checklist requests: assets to 资源库 showing 图片, generate to the generator sheet', () => {
    const { rerender } = render(<Harness files={[...FILES, { ...image('notes.md'), kind: 'text', mime: 'text/markdown' }]} />);
    rerender(<Harness files={[...FILES, { ...image('notes.md'), kind: 'text', mime: 'text/markdown' }]} gameTabRequest={{ tab: 'assets', nonce: 1 }} />);
    expect(selectedView()).toBe('Files');
    expect(document.getElementById('library-type-image')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('design-file-row-notes.md')).toBeNull();
    expect(screen.queryByTestId('panel-studio-sheet')).toBeNull();
    rerender(<Harness gameTabRequest={{ tab: 'generate', nonce: 2 }} />);
    expect(screen.getByTestId('panel-studio-sheet')).toHaveAttribute('data-open');
    expect(screen.getByText('Studio recipes')).toBeTruthy();
  });

  it('opens the generator sheet from 生成素材… and from an image with it as the reference', () => {
    render(<Harness />);
    fireEvent.click(view('Files'));
    fireEvent.click(screen.getByTestId('panel-library-generate'));
    expect(screen.getByTestId('panel-studio-sheet')).toHaveAttribute('data-open');
    expect(screen.getByTestId('studio-references').textContent).toBe('');
    fireEvent.click(within(screen.getByTestId('panel-studio-sheet')).getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('panel-studio-sheet')).not.toHaveAttribute('data-open');

    fireEvent.click(screen.getByTestId('design-file-menu-hero.png'));
    fireEvent.click(screen.getByTestId('design-file-menu-generate-from'));
    expect(screen.getByTestId('panel-studio-sheet')).toHaveAttribute('data-open');
    expect(screen.getByTestId('studio-references').textContent).toBe('hero.png');

    // A plain 生成素材… afterwards starts without the earlier references.
    fireEvent.click(within(screen.getByTestId('panel-studio-sheet')).getByRole('button', { name: 'Close' }));
    for (const name of ['hero.png', 'enemy.png']) {
      fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
    }
    fireEvent.click(screen.getByTestId('file-list-batch-generate-from'));
    expect(screen.getByTestId('studio-references').textContent).toBe('hero.png,enemy.png');
    fireEvent.click(within(screen.getByTestId('panel-studio-sheet')).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByTestId('panel-library-generate'));
    expect(screen.getByTestId('studio-references').textContent).toBe('');
  });

  it('opens the generator for the /generate deep link and a queued recipe', () => {
    const first = render(<Harness routedGenerate />);
    expect(selectedView()).toBe('Files');
    expect(screen.getByTestId('panel-studio-sheet')).toHaveAttribute('data-open');
    first.unmount();

    window.sessionStorage.setItem('openpixo:studio-entry:game', 'recipe-1');
    render(<Harness />);
    expect(selectedView()).toBe('Files');
    expect(screen.getByTestId('panel-studio-sheet')).toHaveAttribute('data-open');
    expect(window.sessionStorage.getItem('openpixo:studio-entry:game')).toBeNull();
  });
});
