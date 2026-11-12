// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RailResizeHandle } from '../../../src/components/entry-nav-rail/RailResizeHandle';
import {
  clampRailWidth,
  getRailWidth,
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  RAIL_WIDTH_STORAGE_KEY,
  resetRailWidthForTests,
  setRailWidth,
} from '../../../src/components/entry-nav-rail/rail-width';

function renderInHost() {
  render(<div data-rail-host data-testid="host"><RailResizeHandle /></div>);
  return { handle: screen.getByRole('separator'), host: screen.getByTestId('host') };
}

// jsdom has no PointerEvent, so fireEvent's init would lose clientX and pointerId.
function pointer(target: Element, type: string, init: { clientX?: number; button?: number; pointerId?: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, clientX: init.clientX ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  fireEvent(target, event);
}

beforeEach(() => {
  window.localStorage.clear();
  resetRailWidthForTests();
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => { run(0); return 1; });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('rail width', () => {
  it('stays between its limits and falls back on nonsense', () => {
    expect(clampRailWidth(10)).toBe(RAIL_WIDTH_MIN);
    expect(clampRailWidth(9000)).toBe(RAIL_WIDTH_MAX);
    expect(clampRailWidth(Number.NaN)).toBe(RAIL_WIDTH_DEFAULT);
  });

  it('survives a restart, and a stored value outside the limits is pulled back', () => {
    setRailWidth(300);
    resetRailWidthForTests();
    expect(getRailWidth()).toBe(300);
    window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, '5000');
    resetRailWidthForTests();
    expect(getRailWidth()).toBe(RAIL_WIDTH_MAX);
  });
});

describe('RailResizeHandle', () => {
  it('is a labelled separator reporting its width', () => {
    const { handle } = renderInHost();
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toBeTruthy();
    expect(handle.getAttribute('aria-valuenow')).toBe(String(RAIL_WIDTH_DEFAULT));
    expect(handle.tabIndex).toBe(0);
  });

  it('drags: repaints the shell live, and saves only when released', () => {
    const { handle, host } = renderInHost();
    pointer(handle, 'pointerdown', { clientX: 244 });
    expect(host.style.transition).toBe('none');
    pointer(handle, 'pointermove', { clientX: 300 });
    expect(host.style.getPropertyValue('--entry-rail-width')).toBe('300px');
    expect(host.style.getPropertyValue('--shell-sidebar-width')).toBe('300px');
    expect(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBeNull();
    pointer(handle, 'pointerup', { clientX: 320 });
    expect(getRailWidth()).toBe(320);
    expect(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe('320');
    expect(host.style.transition).toBe('');
  });

  it('holds the limits while dragging', () => {
    const { handle } = renderInHost();
    pointer(handle, 'pointerdown', { clientX: 244 });
    pointer(handle, 'pointerup', { clientX: 5000 });
    expect(getRailWidth()).toBe(RAIL_WIDTH_MAX);
  });

  it('ignores the other mouse buttons', () => {
    const { handle } = renderInHost();
    pointer(handle, 'pointerdown', { clientX: 244, button: 2 });
    pointer(handle, 'pointermove', { clientX: 300 });
    pointer(handle, 'pointerup', { clientX: 300 });
    expect(getRailWidth()).toBe(RAIL_WIDTH_DEFAULT);
  });

  it('Escape puts a drag back where it started', () => {
    const { handle, host } = renderInHost();
    pointer(handle, 'pointerdown', { clientX: 244 });
    pointer(handle, 'pointermove', { clientX: 330 });
    fireEvent.keyDown(handle, { key: 'Escape' });
    expect(host.style.getPropertyValue('--entry-rail-width')).toBe(`${RAIL_WIDTH_DEFAULT}px`);
    expect(getRailWidth()).toBe(RAIL_WIDTH_DEFAULT);
  });

  it('keyboard: arrows step, Home and End jump, Enter resets', () => {
    const { handle } = renderInHost();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(getRailWidth()).toBe(RAIL_WIDTH_DEFAULT + 16);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(getRailWidth()).toBe(RAIL_WIDTH_DEFAULT - 16);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(getRailWidth()).toBe(RAIL_WIDTH_MIN);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(getRailWidth()).toBe(RAIL_WIDTH_MAX);
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(getRailWidth()).toBe(RAIL_WIDTH_DEFAULT);
  });

  it('double-click restores the default and forgets the saved width', () => {
    setRailWidth(360);
    const { handle } = renderInHost();
    fireEvent.doubleClick(handle);
    expect(getRailWidth()).toBe(RAIL_WIDTH_DEFAULT);
    expect(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBeNull();
  });
});
