// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '@openpixo/contracts';
import { gettingStartedSteps, GETTING_STARTED_DISMISSED_KEY } from '../../../src/components/home/getting-started';
import { HomeGettingStarted } from '../../../src/components/home/HomeGettingStarted';
import { ProjectsNoMatch } from '../../../src/components/ProjectsEmptyState';
import { I18nProvider } from '../../../src/i18n';

const sample: Project = { id: 'sample', name: 'Sample', createdAt: 1, updatedAt: 1, skillId: null,
  metadata: { kind: 'prototype', templateId: 'phaser3-sample-platformer' } as Project['metadata'] };
const done = { status: 'done', step: 'make', projectId: 'sample' } as const;
const own: Project = { id: 'own', name: 'Own game', createdAt: 2, updatedAt: 2, skillId: null };

afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals(); });

describe('getting-started steps', () => {
  it('reads each step from a real fact and leaves out the ones it cannot see', () => {
    expect(gettingStartedSteps({ projects: [], guide: null, agentReady: 'unknown', imageReady: 'unknown' })?.map(step => step.id))
      .toEqual(['guide', 'first-game', 'run']);
    // The sample game is not the user's first game, however it came to be there.
    const steps = gettingStartedSteps({ projects: [sample], guide: done, agentReady: true, imageReady: false })!;
    expect(steps.map(step => [step.id, step.done])).toEqual([
      ['guide', true], ['ai', true], ['image', false], ['first-game', false], ['run', false],
    ]);
    for (const guide of [null, undefined, { ...done, status: 'active' }, { ...done, status: 'skipped' }] as const) {
      expect(gettingStartedSteps({ projects: [], guide, agentReady: 'unknown', imageReady: 'unknown' })![0]).toEqual({ id: 'guide', done: false });
    }
    const ran = { ...own, metadata: { kind: 'prototype', gameRunSucceededAt: 5 } as Project['metadata'] };
    expect(gettingStartedSteps({ projects: [ran], guide: null, agentReady: 'unknown', imageReady: 'unknown' })!
      .find(step => step.id === 'run')?.done).toBe(true);
  });

  it('draws nothing while a fact is still loading', () => {
    expect(gettingStartedSteps({ projects: [], guide: null, agentReady: 'loading', imageReady: true })).toBeNull();
  });
});

describe('HomeGettingStarted', () => {
  function renderList(projects: Project[], props: Partial<React.ComponentProps<typeof HomeGettingStarted>> = {}) {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
    return render(<I18nProvider initial="en"><HomeGettingStarted projects={projects} guide={null} onStartGame={vi.fn()}
      onOpenProject={vi.fn()} {...props} /></I18nProvider>);
  }

  it('shows progress, strikes done rows and offers one action per open step', () => {
    const onStartGuide = vi.fn();
    const view = renderList([own], { onStartGuide });
    expect(screen.getByRole('heading', { name: 'Start making games' })).toBeTruthy();
    expect(screen.getByText('1 / 3 done')).toBeTruthy();
    const madeGame = document.querySelector('[data-step="first-game"]')!;
    expect(madeGame.getAttribute('data-done')).toBe('true');
    expect(madeGame.querySelector('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStartGuide).toHaveBeenCalledOnce();
    // One that was begun goes on from where it stopped.
    view.unmount();
    renderList([own], { onStartGuide, guide: { status: 'skipped', step: 'tune', projectId: 'sample' } });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('stays hidden once dismissed, and once every step is done', () => {
    renderList([own]);
    fireEvent.click(screen.getByTestId('home-getting-started-dismiss'));
    expect(screen.queryByTestId('home-getting-started')).toBeNull();
    expect(window.localStorage.getItem(GETTING_STARTED_DISMISSED_KEY)).toBe('1');
    cleanup();
    window.localStorage.clear();
    const ran = { ...own, metadata: { kind: 'prototype', gameRunSucceededAt: 5 } as Project['metadata'] };
    renderList([sample, ran], { guide: done });
    expect(screen.queryByTestId('home-getting-started')).toBeNull();
  });
});

describe('My Games search with no results', () => {
  it('offers to clear the search', () => {
    const onClear = vi.fn();
    render(<I18nProvider initial="en"><ProjectsNoMatch query="dragon" onClear={onClear} /></I18nProvider>);
    expect(screen.getByText('No projects match your search.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
