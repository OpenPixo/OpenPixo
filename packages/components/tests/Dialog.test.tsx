// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../src/dialog';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Dialog', () => {
  it('wires labelled dialogs consistently', () => {
    render(
      <Dialog ariaLabelledBy="dialog-title">
        <h2 id="dialog-title">Rename design</h2>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Rename design' })).toBeTruthy();
  });

  // The overlay is portaled onto <body> (so its scrim out-ranks app chrome in
  // the root stacking context), which is why every query below goes through
  // `baseElement` rather than the render container.
  it('mounts the backdrop on <body>, outside the render container', () => {
    const { container, baseElement } = render(
      <Dialog>
        <h2>Portaled</h2>
      </Dialog>,
    );
    expect(container.querySelector('.modal-backdrop')).toBeNull();
    expect(baseElement.querySelector('.modal-backdrop')?.parentElement).toBe(document.body);
  });

  it('closes on backdrop click when enabled', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { baseElement } = render(
      <Dialog onClose={onClose}>
        <h2>Backdrop close</h2>
      </Dialog>,
    );

    fireEvent.click(baseElement.querySelector('.modal-backdrop') as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(139));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape when enabled', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose} closeOnEscape>
        <h2>Escape close</h2>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(139));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets custom panels opt out of the shared modal chrome class', () => {
    const { baseElement } = render(
      <Dialog className="plugin-details-modal" includeChromeClassName={false}>
        <h2>Plugin details</h2>
      </Dialog>,
    );

    const panel = baseElement.querySelector('.plugin-details-modal');

    expect(panel).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(panel);
    expect(panel?.classList.contains('modal')).toBe(false);
  });

  it('keeps caller variant sizing overrides ahead of shared dialog defaults', () => {
    const variantStyles = document.createElement('style');
    variantStyles.textContent = '.modal-rename { width: 420px; gap: 14px; }';
    document.head.insertBefore(variantStyles, document.head.firstChild);

    try {
      const { baseElement } = render(
        <Dialog className="modal-rename">
          <h2>Rename design</h2>
        </Dialog>,
      );

      const panel = baseElement.querySelector('.modal-rename') as HTMLElement;
      const panelStyles = getComputedStyle(panel);

      expect(panelStyles.width).toBe('420px');
      expect(panelStyles.gap).toBe('14px');
    } finally {
      variantStyles.remove();
    }
  });

  it('supports sectioned layouts with shared header/body/footer primitives', () => {
    const { baseElement } = render(
      <Dialog layout="sectioned" ariaLabelledBy="dialog-title">
        <DialogHeader>
          <DialogTitle id="dialog-title">Sketch text</DialogTitle>
          <DialogDescription>Add a note to the canvas.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label>
            <span>Text</span>
            <input type="text" />
          </label>
        </DialogBody>
        <DialogFooter>
          <button type="button">Cancel</button>
          <button type="button">Save</button>
        </DialogFooter>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Sketch text' })).toBeTruthy();
    expect(baseElement.querySelector('[class*="dialogSectioned"]')).toBeTruthy();
    expect(baseElement.querySelector('[class*="header"]')).toBeTruthy();
    expect(baseElement.querySelector('[class*="body"]')).toBeTruthy();
    expect(baseElement.querySelector('[class*="footer"]')).toBeTruthy();
  });
});


describe('Dialog accessibility and lifecycle', () => {
  it('traps both Tab directions, excludes disabled/negative/hidden controls and returns focus', () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const view = render(<Dialog ariaLabel="Editor"><button>First</button><button disabled tabIndex={0}>Disabled</button><input type="hidden" /><button tabIndex={-1}>Roving</button><button>Last</button></Dialog>);
    expect(document.activeElement).toBe(screen.getByText('First'));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last'));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('First'));
    view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
  });
  it('returns to the trigger when a descendant requests autofocus', () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const view = render(<Dialog ariaLabel="Find"><input autoFocus aria-label="Search" /></Dialog>);
    view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
  });
  it('retains controlled content through exit and cancels exit when reopened', () => {
    vi.useFakeTimers(); const after = vi.fn();
    const view = render(<Dialog open ariaLabel="Retained" onAfterClose={after}>Content</Dialog>);
    view.rerender(<Dialog open={false} ariaLabel="Retained" onAfterClose={after}>Content</Dialog>);
    act(() => vi.advanceTimersByTime(139)); expect(screen.getByRole('dialog')).toBeTruthy();
    view.rerender(<Dialog open ariaLabel="Retained" onAfterClose={after}>Content</Dialog>);
    act(() => vi.advanceTimersByTime(1)); expect(after).not.toHaveBeenCalled();
    view.rerender(<Dialog open={false} ariaLabel="Retained" onAfterClose={after}>Content</Dialog>);
    act(() => vi.advanceTimersByTime(140)); expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Content').isConnected).toBe(true); expect(after).toHaveBeenCalledOnce();
  });
  it('keeps Escape/backdrop configurable and ignores child clicks', () => {
    vi.useFakeTimers(); const close = vi.fn();
    render(<Dialog onClose={close} closeOnEscape={false} closeOnBackdrop={false}><button>Inside</button></Dialog>);
    fireEvent.click(screen.getByText('Inside')); fireEvent.click(screen.getByRole('presentation')); fireEvent.keyDown(document, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(140)); expect(close).not.toHaveBeenCalled();
  });
  it('only dismisses the top nested dialog and retains the body lock', () => {
    vi.useFakeTimers(); const outer = vi.fn(); const inner = vi.fn();
    render(<Dialog ariaLabel="Outer" onClose={outer}><button>Outer control</button><Dialog ariaLabel="Inner" onClose={inner}><button>Inner control</button></Dialog></Dialog>);
    expect(document.activeElement).toBe(screen.getByText('Inner control'));
    fireEvent.keyDown(document, { key: 'Escape' }); act(() => vi.advanceTimersByTime(140));
    expect(inner).toHaveBeenCalledOnce(); expect(outer).not.toHaveBeenCalled(); expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' }); act(() => vi.advanceTimersByTime(140)); expect(outer).toHaveBeenCalledOnce();
  });
  it('skips the exit delay for reduced motion', () => {
    vi.useFakeTimers(); const close = vi.fn();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<Dialog onClose={close}>Reduced</Dialog>); fireEvent.keyDown(document, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(0)); expect(close).toHaveBeenCalledOnce(); vi.unstubAllGlobals();
  });
});
