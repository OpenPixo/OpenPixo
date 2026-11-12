// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssetDialog } from '../../../src/components/assets/AssetDialog';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('retains the sheet during exit and restores focus', () => {
  vi.useFakeTimers();
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? <AssetDialog title="Asset" drawer onClose={() => setOpen(false)}><input aria-label="Name" /></AssetDialog> : null;
  }
  render(<Harness />);
  const close = screen.getByRole('button', { name: /Close/ });
  expect(screen.getByRole('dialog', { name: 'Asset' }).getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('textbox'));
  fireEvent.click(close);
  act(() => vi.advanceTimersByTime(139));
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it('keeps busy editing open on Escape and backdrop clicks', () => {
  vi.useFakeTimers();
  const close = vi.fn();
  render(<AssetDialog title="Edit" busy onClose={close}>Content</AssetDialog>);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('presentation'));
  act(() => vi.advanceTimersByTime(140));
  expect(close).not.toHaveBeenCalled();
});
