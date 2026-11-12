// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useConfirmDialog } from '../../src/hooks/useConfirmDialog';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('waits for a readable confirmation and its exit before continuing file deletion', async () => {
  vi.useFakeTimers();
  const remove = vi.fn();
  function Harness() {
    const { confirm, dialog } = useConfirmDialog();
    const [result, setResult] = useState('');
    return <><button onClick={async () => {
      const accepted = await confirm({ title: 'Delete file', body: 'Remove sprite.png?', confirmLabel: 'Delete', destructive: true });
      if (accepted) remove();
      setResult(accepted ? 'Deleted' : 'Cancelled');
    }}>Remove</button>{dialog}<output>{result}</output></>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(screen.getByRole('alertdialog', { name: 'Delete file' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(139); });
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(remove).toHaveBeenCalledOnce();
  expect(screen.getByText('Deleted')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  await act(async () => { await vi.advanceTimersByTimeAsync(140); });
  expect(remove).toHaveBeenCalledOnce();
  expect(screen.getByText('Cancelled')).toBeTruthy();
});

it('replaces a request during cancellation without cancelling its successor', async () => {
  vi.useFakeTimers();
  let ask: ReturnType<typeof useConfirmDialog>['confirm'];
  function Harness() {
    const state = useConfirmDialog();
    ask = state.confirm;
    return state.dialog;
  }
  render(<Harness />);
  let first: Promise<boolean>;
  act(() => { first = ask({ title: 'First', body: 'A', confirmLabel: 'Accept' }); });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  let second: Promise<boolean>;
  act(() => { second = ask({ title: 'Second', body: 'B', confirmLabel: 'Accept' }); });
  expect(await first!).toBe(false);
  const answered = vi.fn();
  void second!.then(answered);
  await act(async () => { await vi.advanceTimersByTimeAsync(140); });
  expect(answered).not.toHaveBeenCalled();
  expect(screen.getByRole('alertdialog', { name: 'Second' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(140); });
  expect(answered).toHaveBeenCalledWith(true);
});
