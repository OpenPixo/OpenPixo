// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FileWorkspace } from '../../src/components/FileWorkspace';
import type { OpenTabsState, ProjectFile } from '../../src/types';
// 游戏's tuning disclosure opens a parameter's source at its line.
vi.mock('../../src/components/panel/GameView', () => ({ GameView: ({ hidden, onOpenFileAtLine }: { hidden: boolean; onOpenFileAtLine: (name: string, line: number) => void }) => hidden ? null : <button onClick={() => onOpenFileAtLine('player.gd', 12)}>Open parameter source</button> }));
vi.mock('../../src/components/FileViewer', () => ({ FileViewer: ({ file, sourceLineRequest }: { file: ProjectFile; sourceLineRequest?: { line: number; nonce: number } }) => <div data-testid="source-request">{file.name}:{sourceLineRequest?.line}:{sourceLineRequest?.nonce}</div> }));
vi.mock('../../src/providers/registry', async original => ({ ...(await original<typeof import('../../src/providers/registry')>()), fetchProjectFolders: vi.fn(async () => []) }));
afterEach(() => { cleanup(); window.localStorage.clear(); });
it('carries tuning source requests onto the 游戏 stack to the viewer, including repeat opens', async () => {
  const files = [{ name: 'player.gd', path: 'player.gd', kind: 'code', type: 'file', mime: 'text/plain', size: 30, mtime: 1 }] as ProjectFile[];
  function Workspace() {
    const [tabs, setTabs] = useState<OpenTabsState>({ tabs: [], active: null });
    return <FileWorkspace projectId="game" projectKind="prototype" files={files} tabsState={tabs} onTabsStateChange={setTabs} onRefreshFiles={vi.fn()} />;
  }
  render(<Workspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Open parameter source' }));
  expect((await screen.findByTestId('source-request')).textContent).toBe('player.gd:12:1');
  expect(screen.getByRole('tab', { name: 'Game' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByTestId('panel-stack-label').textContent).toBe('player.gd');
  fireEvent.click(screen.getByTestId('panel-stack-back'));
  fireEvent.click(screen.getByRole('button', { name: 'Open parameter source' }));
  expect((await screen.findByTestId('source-request')).textContent).toBe('player.gd:12:2');
});
