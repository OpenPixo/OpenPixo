// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RailRecentRow } from '../../src/components/entry-nav-rail/RailRecentRow';
import { I18nProvider } from '../../src/i18n';
import type { Project } from '../../src/types';

const now = Date.UTC(2026, 9, 30, 12);

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'rail-thumbnail', name: 'Jump test', skillId: null,
    createdAt: now, updatedAt: now,
    ...overrides,
  } as Project;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RailRecentRow thumbnail and timestamp', () => {
  it.each([
    [0, 'now'], [9 * 60_000, '9m'], [9 * 3_600_000, '9h'], [5 * 86_400_000, '5d'],
  ])('shows compact time outside the project button (%s ms)', (age, expected) => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(<I18nProvider initial="en"><RailRecentRow project={project({ updatedAt: now - age })} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Jump test' }).textContent).toBe('Jump test');
    expect(screen.getByTestId('entry-nav-recent-time').textContent).toBe(expected);
    expect(screen.getByTestId('entry-nav-recent-time').getAttribute('datetime')).toBe(new Date(now - age).toISOString());
  });

  it('localizes the compact timestamp in Chinese', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(<I18nProvider initial="zh-CN"><RailRecentRow project={project({ updatedAt: now - 9 * 3_600_000 })} /></I18nProvider>);
    expect(screen.getByTestId('entry-nav-recent-time').textContent).toBe('9时');
  });

  it('uses a known image as a decorative thumbnail without probing the project', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<I18nProvider initial="en"><RailRecentRow project={project({
      metadata: { kind: 'image', entryFile: 'cover.png' },
    })} /></I18nProvider>);
    const thumbnail = container.querySelector('img');
    expect(thumbnail?.getAttribute('src')).toContain('cover.png');
    expect(thumbnail?.getAttribute('loading')).toBe('lazy');
    expect(screen.queryByRole('img')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.error(thumbnail!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Jump test' })).toBeTruthy();
  });

  it('keeps a live run status accessible in the thumbnail column', () => {
    render(<I18nProvider initial="en"><RailRecentRow project={project()} runStatus="running" /></I18nProvider>);
    expect(screen.getByRole('img', { name: 'Running' })).toBeTruthy();
  });

  it('keeps the distinctive tail of long names visible with a middle ellipsis', () => {
    const name = '20261031-153012-platformer-boss-fight';
    const { container } = render(<I18nProvider initial="en"><RailRecentRow project={project({ name })} /></I18nProvider>);
    expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(container.querySelector(`[title="${name}"]`)).toBeTruthy();
    expect(container.querySelector('[class*="nameTail"]')?.textContent).toBe('ss-fight');
  });

  it('omits malformed timestamps instead of throwing during render', () => {
    render(<I18nProvider initial="en"><RailRecentRow project={project({ updatedAt: Number.NaN })} /></I18nProvider>);
    expect(screen.queryByTestId('entry-nav-recent-time')).toBeNull();
  });
});
