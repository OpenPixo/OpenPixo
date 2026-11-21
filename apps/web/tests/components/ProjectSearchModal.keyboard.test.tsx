// @vitest-environment jsdom

// The ⌘K palette is reached and driven from the keyboard, so ↑/↓ must move the
// highlight and Enter must open the highlighted project — all without moving
// focus off the search input, which would stall typing.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildProjectSearchCatalog,
  ProjectSearchModal,
} from '../../src/components/ProjectSearchModal';
import { I18nProvider } from '../../src/i18n';
import type { Project } from '../../src/types';


afterEach(() => cleanup());

function project(id: string, name: string, updatedAt: number): Project {
  return {
    id,
    name,
    createdAt: updatedAt,
    updatedAt,
    metadata: {},
  } as unknown as Project;
}

// Deliberately unsorted: the palette ranks by recency, so the rendered order
// (and therefore what ↑/↓ walk through) is newest-first, not input order.
const PROJECTS = [
  project('older', 'Older deck', 1_000),
  project('newest', 'Newest deck', 3_000),
  project('middle', 'Middle deck', 2_000),
];



function renderPalette(
  onOpenProject = vi.fn(),
  onClose = vi.fn(),
  projects = PROJECTS,
  workspaceContext: null | null = null,
) {
  render(
    <I18nProvider>
      <ProjectSearchModal
        projects={projects}
        
        onOpenProject={onOpenProject}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return { onOpenProject, onClose };
}

function activeName(): string | undefined {
  const active = document.querySelector('.project-search-results .project-search-item.is-active');
  return active?.querySelector('.project-search-item-name')?.textContent?.trim();
}

describe('ProjectSearchModal keyboard navigation', () => {
  it('searches personal drafts together with shared workspace projects', () => {
    const personalProject = project('personal-white-shoes', '白色慢跑鞋棚拍商品图', 4_000);
    const sharedProject = project('shared-blue-shoes', '共享蓝色跑鞋', 3_000);
    const projects = buildProjectSearchCatalog([personalProject], [sharedProject]);

    renderPalette(vi.fn(), vi.fn(), projects);
    fireEvent.change(screen.getByTestId('project-search-input'), {
      target: { value: '白色' },
    });

    expect(screen.getByTestId('project-search-item-personal-white-shoes')).toBeTruthy();
  });

  it('uses the shared catalog card when the same project appears twice', () => {
    const localCard = project('shared-project', 'Stale local title', 1_000);
    const sharedCard = project('shared-project', 'Current shared title', 2_000);

    expect(buildProjectSearchCatalog([localCard], [sharedCard])).toEqual([sharedCard]);
  });

  it('highlights the top match first and walks the list with the arrow keys', () => {
    renderPalette();
    const input = screen.getByTestId('project-search-input');

    expect(activeName()).toBe('Newest deck');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeName()).toBe('Middle deck');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeName()).toBe('Older deck');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeName()).toBe('Middle deck');
  });

  it('wraps around at both ends', () => {
    renderPalette();
    const input = screen.getByTestId('project-search-input');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeName()).toBe('Older deck');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeName()).toBe('Newest deck');
  });

  it('opens the highlighted project on Enter and closes the palette', () => {
    const onOpenProject = vi.fn();
    const onClose = vi.fn();
    renderPalette(onOpenProject, onClose);
    const input = screen.getByTestId('project-search-input');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onOpenProject).toHaveBeenCalledWith('middle');
    expect(onClose).toHaveBeenCalled();
  });

  it('restarts the highlight at the top match when the query re-ranks the list', () => {
    renderPalette();
    const input = screen.getByTestId('project-search-input');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeName()).toBe('Older deck');

    fireEvent.change(input, { target: { value: 'Middle' } });

    // The stale index would have pointed past the end of the filtered list.
    expect(activeName()).toBe('Middle deck');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('project-search-item-middle')).toBeTruthy();
  });

  it('ignores the arrow keys when nothing matches', () => {
    renderPalette();
    const input = screen.getByTestId('project-search-input');

    fireEvent.change(input, { target: { value: 'no-such-project' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(activeName()).toBeUndefined();
  });
});

describe('ProjectSearchModal groups and no-results state', () => {
  it('offers the app actions when there are no games yet', () => {
    renderPalette(vi.fn(), vi.fn(), []);

    expect(screen.getByTestId('project-search-action-new-game')).toBeTruthy();
    expect(screen.queryByTestId('project-search-empty')).toBeNull();
  });

  it('hands the typed text to the agent from the no-results state', () => {
    const onAskAgent = vi.fn();
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <ProjectSearchModal
          projects={PROJECTS}
          onOpenProject={vi.fn()}
          onClose={onClose}
          onAskAgent={onAskAgent}
        />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByTestId('project-search-input'), {
      target: { value: '  a cozy fishing game  ' },
    });

    expect(screen.getByTestId('project-search-empty').textContent).toContain('a cozy fishing game');
    expect(screen.getByTestId('project-search-suggestion-new-game')).toBeTruthy();
    fireEvent.click(screen.getByTestId('project-search-ask-agent'));

    expect(onAskAgent).toHaveBeenCalledWith('a cozy fishing game');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows no agent button without an onAskAgent handler', () => {
    renderPalette();
    fireEvent.change(screen.getByTestId('project-search-input'), {
      target: { value: 'no-such-project' },
    });

    expect(screen.getByTestId('project-search-empty')).toBeTruthy();
    expect(screen.queryByTestId('project-search-ask-agent')).toBeNull();
  });
});
