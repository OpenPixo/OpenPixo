// @vitest-environment jsdom
//
// Local project browsing has no ownership collections or creator metadata.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { Project } from '../../src/types';

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFileText: vi.fn(async () => null),
  fetchProjectFiles: vi.fn(async () => []),
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));


afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function project(overrides: Partial<Project>): Project {
  return {
    id: 'project-1',
    name: 'Project',
    skillId: null,
    createdAt: 1,
    updatedAt: 2,
    status: { value: 'not_started' },
    ...overrides,
  };
}

const PROJECTS = [
  project({ id: 'p-newest', name: 'Newest game', updatedAt: 3 }),
  project({ id: 'p-middle', name: 'Middle game', updatedAt: 2 }),
  project({ id: 'p-older', name: 'Older game', updatedAt: 1 }),
];


function renderPage(props: Partial<React.ComponentProps<typeof RecentProjectsStrip>> = {}) {
  return render(
    <RecentProjectsStrip
      heading="All projects"
      space="drafts"
      projects={PROJECTS}
      limit={PROJECTS.length}
      
      onOpen={() => {}}
      {...props}
    />,
  );
}

function tabs(container: HTMLElement): HTMLElement {
  const group = container.querySelector<HTMLElement>('.recent-projects__collection-switch');
  if (!group) throw new Error('collection tabs are missing');
  return group;
}

describe('local project collections', () => {
  it('offers recently viewed without personal or team collections', () => {
    const { container } = renderPage();
    const group = tabs(container);
    expect(within(group).getAllByRole('radio').map((tab) => tab.textContent)).toEqual([
      'Recently viewed',
    ]);
    expect(screen.queryByTestId('recent-projects-collection-personalProjects')).toBeNull();
    expect(screen.queryByTestId('recent-projects-collection-teamProjects')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(PROJECTS.length);
  });

  it('keeps the controlled recently viewed collection usable', () => {
    const onCollectionChange = vi.fn();
    renderPage({ collection: 'recent', onCollectionChange });
    const recent = screen.getByRole('radio', { name: 'Recently viewed' });
    expect(recent.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(recent);
    expect(onCollectionChange).toHaveBeenCalledWith('recent');
  });

  it.each(['recent', 'drafts'] as const)('shows update times and kinds without creator badges in %s', space => {
    const { container } = renderPage({ space, heading: space === 'recent' ? undefined : 'All projects' });
    const cards = [...container.querySelectorAll('.recent-projects__card')];
    expect(cards).toHaveLength(PROJECTS.length);
    for (const card of cards) {
      const time = card.querySelector('.recent-projects__card-time');
      expect(time?.querySelector('.recent-projects__card-when')?.textContent?.trim()).toBeTruthy();
      expect(time?.querySelector('.recent-projects__card-owner')).toBeNull();
      expect(time?.querySelector('.recent-projects__card-creator')).toBeNull();
      expect(time?.querySelector('.recent-projects__card-sep')).toBeNull();
      expect(card.querySelector('.design-card-tag')?.textContent).toBe('Game');
    }
    expect(screen.queryByText('Created by Me')).toBeNull();
  });
});
