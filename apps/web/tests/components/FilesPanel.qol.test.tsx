// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesPanel } from '../../src/components/FilesPanel';
import { copyToClipboard } from '../../src/lib/copy-to-clipboard';
import type { ProjectFile } from '../../src/types';

vi.mock('../../src/lib/copy-to-clipboard', () => ({ copyToClipboard: vi.fn() }));

function file(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return { name: 'scripts/player.ts', path: 'scripts/player.ts', kind: 'code', mime: 'text/plain', size: 1024, mtime: 1, ...overrides };
}

function panelProps(overrides: Partial<ComponentProps<typeof FilesPanel>> = {}): ComponentProps<typeof FilesPanel> {
  return {
    projectId: 'qol-project', projectKind: 'prototype', files: [file()],
    onRefreshFiles: vi.fn(), onOpenFile: vi.fn(), onRenameFile: vi.fn(),
    onDeleteFile: vi.fn(), onDeleteFiles: vi.fn(), onUpload: vi.fn(),
    onUploadFiles: vi.fn(), onPaste: vi.fn(), ...overrides,
  };
}

/** Browse into `scripts/` when the fixture lives there (root files need nothing). */
function showScripts() {
  const dir = screen.queryByTestId('library-dir-scripts');
  if (dir) fireEvent.click(dir.querySelector('.df-row-name-btn')!);
}

function renderPanel(overrides: Partial<ComponentProps<typeof FilesPanel>> = {}) {
  const result = render(<FilesPanel {...panelProps(overrides)} />);
  showScripts();
  return result;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(copyToClipboard).mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Files path copy actions', () => {
  it('copies the project-relative path even without a local absolute path', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('design-file-menu-scripts/player.ts'));
    expect(screen.getByRole('menuitem', { name: 'Copy absolute path' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy relative path' }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('scripts/player.ts'));
    expect(screen.getByRole('status').textContent).toContain('Path copied');
  });

  it.each([
    ['C:\\Games\\Quest\\', 'C:\\Games\\Quest\\scripts\\player.ts'],
    ['/games/quest/', '/games/quest/scripts/player.ts'],
  ])('copies the resolved absolute path for project root %s', async (resolvedDir, expected) => {
    renderPanel({ resolvedDir });
    fireEvent.click(screen.getByTestId('design-file-menu-scripts/player.ts'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy absolute path' }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(expected));
  });

  it('uses the daemon-provided exact local path when available', async () => {
    renderPanel({ resolvedDir: 'C:\\Games\\Quest', files: [file({ localPath: 'D:\\Shared\\player.ts' })] });
    fireEvent.click(screen.getByTestId('design-file-menu-scripts/player.ts'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy absolute path' }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('D:\\Shared\\player.ts'));
  });

  it('announces a clipboard failure instead of showing success', async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(false);
    renderPanel();
    fireEvent.click(screen.getByTestId('design-file-menu-scripts/player.ts'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy relative path' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not copy the path. Try again.');
  });
});

describe('Files loading state', () => {
  it('announces the pending list without offering empty-project actions, then shows returned files', () => {
    const props = panelProps({ files: [], filesAuthoritative: false });
    const { rerender } = render(<FilesPanel {...props} />);
    const pending = screen.getByTestId('file-list-loading');
    expect(pending.getAttribute('role')).toBe('status');
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect(pending.textContent).toContain('Loading');
    expect(screen.queryByTestId('file-list-empty-new-document')).toBeNull();
    rerender(<FilesPanel {...props} files={[file()]} filesAuthoritative />);
    showScripts();
    expect(screen.queryByTestId('file-list-loading')).toBeNull();
    expect(screen.getByTestId('design-file-row-scripts/player.ts')).toBeTruthy();
  });

});

describe('Files drag to chat payload', () => {
  it.each([
    file(),
    file({ name: 'sprite.png', kind: 'image', mime: 'image/png' }),
    file({ name: 'index.html', kind: 'html', mime: 'text/html', size: 1024 * 1024 }),
  ])('offers a copy reference for $name', (entry) => {
    renderPanel({ files: [entry] });
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() };
    const row = screen.getByTestId(`design-file-row-${entry.name}`);
    expect(row.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(row, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-openpixo-project-file', JSON.stringify({ projectId: 'qol-project', path: entry.name, paths: [entry.name] }));
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', entry.name);
  });

  it('does not show the upload overlay while dragging an existing project file', () => {
    renderPanel();
    fireEvent.dragEnter(screen.getByTestId('design-file-row-scripts/player.ts'), {
      dataTransfer: { types: ['application/x-openpixo-project-file', 'text/plain'], files: [] },
    });
    expect(screen.queryByTestId('file-list-drop-overlay')).toBeNull();
  });
});
