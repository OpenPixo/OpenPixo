// @vitest-environment jsdom
//
// Acceptance #77 (type filter must speak the card-chip vocabulary) and #75
// (多选 bar must actually offer actions).

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RecentProjectsStrip,
  projectCardCategory,
  projectKindFilterCategory,
} from '../../src/components/RecentProjectsStrip';
import type { Project } from '../../src/types';



// Typed on the argument the component actually passes, so `.mock.calls`
// destructures instead of widening to the empty tuple.
interface MoveCall { projectId: string; visibility: string }

const moveWorkspaceProject = vi.fn(async (input: MoveCall) => null);

vi.mock('../../src/state/projects', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  moveWorkspaceProject: (...args: unknown[]) => moveWorkspaceProject(args[0] as MoveCall),
}));

let shareReadContext: null | null = null;


vi.mock('../../src/providers/registry', () => ({
  fetchProjectFileText: vi.fn(async () => null),
  fetchProjectFiles: vi.fn(async () => []),
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

afterEach(() => {
  cleanup();
  moveWorkspaceProject.mockClear();
  shareReadContext = null;
  vi.restoreAllMocks();
});

function provideVerifiedZeroShareCount() {
  shareReadContext = null;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const match = String(url).match(/^\/api\/projects\/([^/]+)\/share-state$/);
    if (!match) return new Response('', { status: 200 });
    return Response.json({ projectId: decodeURIComponent(match[1]!), bindingExists: false, hasEverShared: false, publications: [] });
  });
}

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

const PROTOTYPE = project({ id: 'p-prototype', name: 'Prototype project', updatedAt: 5 });
const DECK = project({
  id: 'p-deck',
  name: 'Deck project',
  updatedAt: 4,
  metadata: { kind: 'deck' },
});
const LIVE = project({
  id: 'p-live',
  name: 'Live project',
  updatedAt: 3,
  metadata: { kind: 'prototype', intent: 'live-artifact' },
});
// recvpZbvupSr1o: a web-clone project still stores `kind: 'prototype'`
// (home-hero/chips.ts's 'web-clone' chip keeps preview behavior identical to
// a blank prototype) — only `intent: 'web-clone'` marks the scenario.
const WEB_CLONE = project({
  id: 'p-web-clone',
  name: 'Web clone project',
  updatedAt: 2.5,
  metadata: { kind: 'prototype', intent: 'web-clone' },
});
const MEDIA = project({
  id: 'p-media',
  name: 'Media project',
  updatedAt: 2,
  metadata: { kind: 'video' },
});
// OPEND-3107: a Document project is what the Home "Document" chip creates —
// `kind: 'other'` with `intent: 'document'` (home-hero/chips.ts).
const DOCUMENT = project({
  id: 'p-document',
  name: 'Document project',
  updatedAt: 1.8,
  metadata: { kind: 'other', intent: 'document' },
});
// OPEND-3107: an Image project is the media-generation chip's `kind: 'image'`.
const IMAGE = project({
  id: 'p-image',
  name: 'Image project',
  updatedAt: 1.5,
  metadata: { kind: 'image' },
});
const DESIGN_SYSTEM = project({
  id: 'p-ds',
  name: 'Design system project',
  updatedAt: 1,
  metadata: { kind: 'other', importedFrom: 'design-system' },
});
// OPEND-3107 (2026-09-16 定稿): the filter names every creation type on its
// own. A HyperFrames project stores `kind: 'video'` plus `intent:
// 'hyperframes'` (home-hero/chips.ts), so it must file under HyperFrames, not
// Video; WebGL is `kind: 'prototype'` + `intent: 'webgl-experience'`.
const HYPERFRAMES = project({
  id: 'p-hyperframes',
  name: 'HyperFrames project',
  updatedAt: 0.9,
  metadata: { kind: 'video', intent: 'hyperframes' },
});
const WEBGL = project({
  id: 'p-webgl',
  name: 'WebGL project',
  updatedAt: 0.8,
  metadata: { kind: 'prototype', intent: 'webgl-experience' },
});
const AUDIO = project({
  id: 'p-audio',
  name: 'Audio project',
  updatedAt: 0.7,
  metadata: { kind: 'audio' },
});

const ALL_PROJECTS = [
  PROTOTYPE,
  DECK,
  LIVE,
  WEB_CLONE,
  MEDIA,
  DOCUMENT,
  IMAGE,
  DESIGN_SYSTEM,
  HYPERFRAMES,
  WEBGL,
  AUDIO,
];

function renderGrid(props: Partial<React.ComponentProps<typeof RecentProjectsStrip>> = {}) {
  return render(
    <RecentProjectsStrip
      heading="All projects"
      projects={ALL_PROJECTS}
      // The strip caps at 6 cards by default; the fixtures outgrew that, and
      // the page mode this mirrors passes an effectively unbounded limit too.
      limit={ALL_PROJECTS.length}
      onOpen={() => {}}
      {...props}
    />,
  );
}

function openKindMenu(container: HTMLElement): HTMLElement {
  const filters = container.querySelectorAll('.recent-projects__filter');
  // [0] is the owner filter, [1] the type filter.
    fireEvent.click(filters[0]!);
  return container.querySelectorAll('.recent-projects__filter-menu')[0] as HTMLElement;
}

function cardNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.recent-projects__card-name')].map(
    (node) => node.textContent ?? '',
  );
}

describe('projectCardCategory', () => {
  // The chip a card wears IS the filter vocabulary; if these drift, the
  // dropdown starts offering types no card can display (acceptance #77).
  it('maps each project to the chip its card renders', () => {
    expect(projectCardCategory(PROTOTYPE)).toBe('prototype');
    expect(projectCardCategory(DECK)).toBe('prototype');
    expect(projectCardCategory(LIVE)).toBe('prototype');
    expect(projectCardCategory(WEB_CLONE)).toBe('prototype');
    expect(projectCardCategory(MEDIA)).toBe('media');
  });

  it('uses the generic Game category for retired saved project metadata', () => {
    for (const saved of [DECK, LIVE, WEB_CLONE, DOCUMENT, DESIGN_SYSTEM, project({ metadata: { kind: 'brand' } })]) {
      expect(projectCardCategory(saved)).toBe('prototype');
      expect(projectKindFilterCategory(saved)).toBe('prototype');
    }
  });


});

describe('projectKindFilterCategory (OPEND-3107)', () => {
  // The dropdown offers eleven creation types; every project resolves to
  // exactly one of them, bucketed by its creation metadata.
  it('maps each project to the filter bucket the dropdown offers', () => {
    expect(projectKindFilterCategory(PROTOTYPE)).toBe('prototype');
    expect(projectKindFilterCategory(DECK)).toBe('prototype');
    expect(projectKindFilterCategory(DOCUMENT)).toBe('prototype');
    expect(projectKindFilterCategory(IMAGE)).toBe('image');
    expect(projectKindFilterCategory(HYPERFRAMES)).toBe('hyperframes');
    expect(projectKindFilterCategory(WEB_CLONE)).toBe('prototype');
    expect(projectKindFilterCategory(MEDIA)).toBe('video');
    expect(projectKindFilterCategory(AUDIO)).toBe('audio');
    expect(projectKindFilterCategory(LIVE)).toBe('prototype');
    expect(projectKindFilterCategory(WEBGL)).toBe('webgl');
  });


  it('lets the creation intent outrank the storage kind', () => {
    // HyperFrames is stored as a video project and WebGL as a prototype; the
    // intent is what the user picked on Home, so it names the bucket.
    expect(projectCardCategory(HYPERFRAMES)).toBe('media');
    expect(projectKindFilterCategory(HYPERFRAMES)).toBe('hyperframes');
    expect(projectCardCategory(WEBGL)).toBe('prototype');
    expect(projectKindFilterCategory(WEBGL)).toBe('webgl');
  });


});

describe('RecentProjectsStrip type filter (#77)', () => {
  it('omits the redundant owner filter from the drafts space', () => {
    const { container } = renderGrid({ heading: 'Drafts', space: 'drafts' });

    const filters = [...container.querySelectorAll('.recent-projects__filter')].map(
      (node) => node.textContent?.trim(),
    );

    expect(filters).toEqual(['Any type']);
  });

  it('offers only current game and media creation types', () => {
    const { container } = renderGrid();

    const menu = openKindMenu(container);
    const options = [...menu.querySelectorAll('button')].map((node) => node.textContent);

    expect(options).toEqual([
      'Any type',
      'Game',
      'Image',
      'HyperFrames',
      'Video',
      'Audio',
      'WebGL',
    ]);
    // Media (the merged video / audio bucket) and Other stay gone.
    expect(options).not.toContain('Media');
    expect(options).not.toContain('Other');
  });

  it('filters the grid down to the projects in the picked bucket', () => {
    const { container } = renderGrid();

    const kindTrigger = () => container.querySelectorAll('.recent-projects__filter')[0]!;

    fireEvent.click(within(openKindMenu(container)).getByText('Image'));
    expect(cardNames(container)).toEqual(['Image project']);
    expect(kindTrigger().textContent?.trim()).toBe('Image');

    fireEvent.click(within(openKindMenu(container)).getByText('HyperFrames'));
    expect(cardNames(container)).toEqual(['HyperFrames project']);

    // Video no longer swallows the HyperFrames project that shares its kind.
    fireEvent.click(within(openKindMenu(container)).getByText('Video'));
    expect(cardNames(container)).toEqual(['Media project']);

    fireEvent.click(within(openKindMenu(container)).getByText('Audio'));
    expect(cardNames(container)).toEqual(['Audio project']);


    fireEvent.click(within(openKindMenu(container)).getByText('WebGL'));
    expect(cardNames(container)).toEqual(['WebGL project']);


    // Retired saved kinds stay browseable under the generic Game label.
    fireEvent.click(within(openKindMenu(container)).getByText('Game'));
    expect(cardNames(container)).toEqual(['Prototype project', 'Deck project', 'Live project', 'Web clone project', 'Document project', 'Design system project']);

    fireEvent.click(within(openKindMenu(container)).getByText('Any type'));
    expect(cardNames(container)).toHaveLength(ALL_PROJECTS.length);
  });
});

describe('RecentProjectsStrip bulk selection bar (#75)', () => {
  function enterSelectionMode(container: HTMLElement, names: string[]) {
    fireEvent.click(screen.getByRole('button', { name: 'Multi-select' }));
    for (const name of names) {
      fireEvent.click(
        container.querySelector(`.recent-projects__select-check[aria-label="${name}"]`)!,
      );
    }
    return container.querySelector('.recent-projects__bulkbar') as HTMLElement;
  }

  it('renders the batch actions next to the selected count', () => {
    const { container } = renderGrid({


      onDelete: () => true,
    });

    const bar = enterSelectionMode(container, ['Deck project']);

    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(within(bar).getByText('1 selected')).toBeTruthy();
    // The defect was an empty right-hand side: count, no actions.
    const actions = [...bar.querySelectorAll('.recent-projects__bulkbar-actions button')].map(
      (node) => node.textContent?.trim(),
    );
    expect(actions).toEqual([
      'Delete selected',
      'Cancel',
    ]);
  });

  it('only offers batch actions backed by a real capability', () => {
    // No delete handler and no collaboration: the bar keeps its exit affordance
    // rather than showing buttons that would do nothing.
    const { container } = renderGrid({


    });

    const bar = enterSelectionMode(container, ['Deck project']);
    const actions = [...bar.querySelectorAll('.recent-projects__bulkbar-actions button')].map(
      (node) => node.textContent?.trim(),
    );
    expect(actions).toEqual(['Cancel']);
  });

  it('preserves the main no-share batch dialog DOM and cancel does not delete', async () => {
    provideVerifiedZeroShareCount();
    // Production markup/copy verified byte-identical to main 8e372744dda5
    // before recording; do not regenerate this baseline for share warnings.
    const onDelete = vi.fn();
    const { container } = renderGrid({


      onDelete,
    });
    const bar = enterSelectionMode(container, ['Deck project', 'Media project']);
    fireEvent.click(within(bar).getByText('Delete selected'));
    const dialog = screen.getByRole('alertdialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Delete selected' })).toBeEnabled());
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('button', { name: /Delete/ })).toBeEnabled();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('confirms before deleting the whole selection', async () => {
    provideVerifiedZeroShareCount();
    const onDelete = vi.fn((_id: string) => true);
    const { container } = renderGrid({


      onDelete,
    });

    const bar = enterSelectionMode(container, ['Deck project', 'Media project']);
    fireEvent.click(within(bar).getByText('Delete selected'));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Delete 2 project(s)?')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Delete selected' })).toBeEnabled());

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete selected' }));

    await waitFor(() => {
      expect(onDelete.mock.calls.map(([id]) => id)).toEqual(['p-deck', 'p-media']);
    });
  });



  it('cancel leaves selection mode without touching anything', () => {
    const onDelete = vi.fn((_id: string) => true);
    const { container } = renderGrid({


      onDelete,
    });

    const bar = enterSelectionMode(container, ['Deck project']);
    fireEvent.click(within(bar).getByText('Cancel'));

    expect(container.querySelector('.recent-projects__bulkbar')).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    expect(moveWorkspaceProject).not.toHaveBeenCalled();
  });
});
