// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from '../../src/components/AppErrorBoundary';

const report = vi.hoisted(() => vi.fn());
vi.mock('../../src/analytics/error-tracking', () => ({ reportHandledException: report }));

function Bomb(): never {
  throw new Error('render exploded');
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    report.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders children untouched when nothing fails', () => {
    render(<AppErrorBoundary><p>game panel</p></AppErrorBoundary>);
    expect(screen.getByText('game panel')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces a crashed tree with a reload screen and reports the error', () => {
    render(<AppErrorBoundary><Bomb /></AppErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('OpenPixo hit a problem');
    expect(report).toHaveBeenCalledOnce();
    expect((report.mock.calls[0]?.[0] as Error).message).toBe('render exploded');
  });

  it('reloads the app from the fallback', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(<AppErrorBoundary><Bomb /></AppErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Reload OpenPixo' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('catches a lazy chunk that fails to load', async () => {
    const { lazy, Suspense } = await import('react');
    const Broken = lazy(() => Promise.reject(new Error('ChunkLoadError')));
    render(
      <AppErrorBoundary>
        <Suspense fallback={null}><Broken /></Suspense>
      </AppErrorBoundary>,
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((report.mock.calls[0]?.[0] as Error).message).toBe('ChunkLoadError');
  });
});
