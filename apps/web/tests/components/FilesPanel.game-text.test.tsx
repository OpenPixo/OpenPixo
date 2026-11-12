// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesPanel } from '../../src/components/FilesPanel';
import type { ProjectFile } from '../../src/types';

afterEach(cleanup);

function file(name: string): ProjectFile {
  return { name, kind: 'binary', mime: 'application/octet-stream', size: 128, mtime: 1 };
}

describe('FilesPanel game engine text files', () => {
  it('groups imported Godot scripts and scene/project files as readable source', () => {
    render(
      <FilesPanel
        projectId="game-text"
        projectKind="prototype"
        files={[file('player.gd'), file('main.tscn'), file('project.godot')]}
        onRefreshFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onRenameFile={vi.fn()}
        onDeleteFile={vi.fn()}
        onDeleteFiles={vi.fn()}
        onUpload={vi.fn()}
        onUploadFiles={vi.fn()}
        onPaste={vi.fn()}
      />,
    );

    // Engine text files read as source; the row label and the 资源库 filter
    // agree on where a developer looks for each: .gd under 脚本, .tscn under 场景.
    expect(within(screen.getByTestId('design-file-row-player.gd')).getByText('Script')).toBeTruthy();
    expect(within(screen.getByTestId('design-file-row-main.tscn')).getByText('Scene')).toBeTruthy();
    expect(within(screen.getByTestId('design-file-row-project.godot')).getByText('Text')).toBeTruthy();

    fireEvent.click(document.getElementById('library-type-scene')!);
    expect(screen.getByTestId('design-file-row-main.tscn')).toBeTruthy();
    expect(screen.queryByTestId('design-file-row-player.gd')).toBeNull();
    fireEvent.click(document.getElementById('library-type-script')!);
    expect(screen.getByTestId('design-file-row-player.gd')).toBeTruthy();
    fireEvent.click(document.getElementById('library-type-other')!);
    expect(screen.getByTestId('design-file-row-project.godot')).toBeTruthy();
  });
});
