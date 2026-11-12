// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectDeleteConfirmDialog } from '../../../src/components/project-actions/ProjectDeleteConfirmDialog';
afterEach(cleanup);
it('uses the shared confirmation and leaves failed deletions available for retry', () => {
 const onConfirm = vi.fn();
 render(<ProjectDeleteConfirmDialog projectName="My game" pending={false} failed onCancel={() => {}} onConfirm={onConfirm} />);
 expect(screen.getByRole('alertdialog')).toBeTruthy(); expect(screen.getByText(/My game/)).toBeTruthy(); expect(screen.getByRole('alert').textContent).toContain('try again');
 fireEvent.click(screen.getByRole('button', { name: /Delete/i })); expect(onConfirm).toHaveBeenCalledOnce();
});
