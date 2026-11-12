// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectDeleteConfirmDialog } from '../../src/components/project-actions/ProjectDeleteConfirmDialog';

afterEach(cleanup);

function renderDialog(keepsFolder?: boolean) {
  render(
    <ProjectDeleteConfirmDialog
      projectName="Moss Runner"
      {...(keepsFolder === undefined ? {} : { keepsFolder })}
      pending={false}
      failed={false}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}

describe('ProjectDeleteConfirmDialog', () => {
  it('asks to delete a project OpenPixo owns', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Permanently delete "Moss Runner" and all its files?');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('says a folder-backed game stays on disk', () => {
    renderDialog(true);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Your game folder and its files stay on disk');
    expect(dialog.textContent).not.toContain('Delete');
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('explains a held folder in words, and hides raw error text from everything else', () => {
    const { rerender } = render(
      <ProjectDeleteConfirmDialog projectName="Moss Runner" pending={false} failed errorCode="PROJECT_FILES_IN_USE"
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole('alert').textContent).toContain('open in another program');
    rerender(
      <ProjectDeleteConfirmDialog projectName="Moss Runner" pending={false} failed errorCode={null}
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Please try again.');
  });
});
