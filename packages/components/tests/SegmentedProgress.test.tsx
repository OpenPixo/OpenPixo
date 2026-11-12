// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SegmentedProgress } from '../src/segmented-progress';

afterEach(cleanup);

describe('SegmentedProgress', () => {
  it('announces completed steps and highlights only the first unfinished step', () => {
    render(<SegmentedProgress total={5} done={2} label="主线任务" />);
    const progress = screen.getByRole('progressbar', { name: '主线任务' });

    expect(progress.getAttribute('aria-valuemin')).toBe('0');
    expect(progress.getAttribute('aria-valuemax')).toBe('5');
    expect(progress.getAttribute('aria-valuenow')).toBe('2');
    expect(Array.from(progress.children).map((segment) => segment.getAttribute('data-state')))
      .toEqual(['done', 'done', 'current', 'pending', 'pending']);
    expect(Array.from(progress.children).every((segment) => segment.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('bounds fractional or invalid values and has no current step once complete', () => {
    const { rerender } = render(<SegmentedProgress total={3.9} done={8} />);
    const progress = screen.getByRole('progressbar', { name: '3 / 3' });
    expect(progress.children).toHaveLength(3);
    expect(progress.querySelector('[data-state="current"]')).toBeNull();

    rerender(<SegmentedProgress total={-1} done={Number.NaN} />);
    expect(progress.getAttribute('aria-valuenow')).toBe('0');
    expect(progress.getAttribute('aria-valuemax')).toBe('0');
    expect(progress.children).toHaveLength(0);

    rerender(<SegmentedProgress total={Number.POSITIVE_INFINITY} done={2} />);
    expect(progress.children).toHaveLength(0);

    rerender(<SegmentedProgress total={3} done={-2} />);
    expect(progress.getAttribute('aria-valuenow')).toBe('0');
    expect(progress.querySelectorAll('[data-state="current"]')).toHaveLength(1);
  });

  it('accepts a visible external label without replacing it with a numeric name', () => {
    render(<><span id="quest-title">Prototype checklist</span><SegmentedProgress total={5} done={2} aria-labelledby="quest-title" /></>);
    expect(screen.getByRole('progressbar', { name: 'Prototype checklist' }).hasAttribute('aria-label')).toBe(false);
  });
});
