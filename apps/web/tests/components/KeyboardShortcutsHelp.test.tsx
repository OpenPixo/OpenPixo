// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { KeyboardShortcutsHelp, openKeyboardShortcuts } from '../../src/components/KeyboardShortcutsHelp';
import { isMacPlatform } from '../../src/utils/platform';

vi.mock('../../src/utils/platform', () => ({ isMacPlatform: vi.fn(() => false) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.mocked(isMacPlatform).mockReturnValue(false);
});

function mount() {
  return render(<I18nProvider initial="en"><KeyboardShortcutsHelp /></I18nProvider>);
}

describe('keyboard shortcuts help', () => {
  it('opens with ? and Ctrl+/, traps focus, and restores focus after Escape', () => {
    vi.useFakeTimers();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    mount();
    fireEvent.keyDown(trigger, { key: '?', shiftKey: true });
    const close = screen.getByRole('button', { name: 'Close' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(140));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: '/', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    trigger.remove();
  });

  it('does not steal punctuation or composing keys from inputs, or open over another dialog', () => {
    mount();
    const input = document.createElement('textarea');
    document.body.append(input);
    fireEvent.keyDown(input, { key: '?' });
    fireEvent.keyDown(input, { key: '/', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(input, { key: '/', ctrlKey: true, altKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    const otherDialog = document.createElement('div');
    otherDialog.setAttribute('role', 'dialog');
    document.body.append(otherDialog);
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    act(() => openKeyboardShortcuts());
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    otherDialog.remove();
    fireEvent.keyDown(input, { key: '/', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    input.remove();
  });

  it('opens from the shell help action and uses Mac key labels', () => {
    vi.useFakeTimers();
    vi.mocked(isMacPlatform).mockReturnValue(true);
    mount();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openKeyboardShortcuts());
    expect(screen.getByText('⌘+K')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(140));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: '/', metaKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
