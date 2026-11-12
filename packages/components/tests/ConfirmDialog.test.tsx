// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/dialog';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('labels and describes an alert dialog and focuses the safe action', () => {
 const confirm = vi.fn(); const cancel = vi.fn();
 render(<ConfirmDialog open title="Delete file" confirmLabel="Delete" cancelLabel="Cancel" destructive onConfirm={confirm} onCancel={cancel}>This removes the file.</ConfirmDialog>);
 const dialog = screen.getByRole('alertdialog', { name: 'Delete file' });
 expect(dialog.getAttribute('aria-modal')).toBe('true');
 expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('This removes the file.');
 expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
 fireEvent.click(screen.getByRole('button', { name: 'Delete' })); expect(confirm).toHaveBeenCalledOnce();
});
it('retains cancel exit and disables dismissal/actions while busy', () => {
 vi.useFakeTimers(); const cancel = vi.fn(); const confirm = vi.fn();
 const view = render(<ConfirmDialog open title="Delete" confirmLabel="Remove" cancelLabel="Cancel" busy onConfirm={confirm} onCancel={cancel}>Body</ConfirmDialog>);
 fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
 act(() => vi.advanceTimersByTime(140)); expect(cancel).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
 view.rerender(<ConfirmDialog open title="Delete" confirmLabel="Remove" cancelLabel="Cancel" onConfirm={confirm} onCancel={cancel}>Body</ConfirmDialog>);
 fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); act(() => vi.advanceTimersByTime(139)); expect(screen.getByRole('alertdialog')).toBeTruthy();
 act(() => vi.advanceTimersByTime(1)); expect(cancel).toHaveBeenCalledOnce();
});
