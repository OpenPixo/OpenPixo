import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from '../../src/router';
import {
  WORKSHOP_KINDS,
  isGenerateKind,
  isWorkshopItem,
  mostRecentStoreProject,
  openGenerate,
} from '../../src/state/store';

vi.mock('../../src/router', () => ({ navigate: vi.fn() }));

describe('Workshop catalog boundary', () => {
  it('keeps only the four installable kinds', () => {
    const kinds = [
      'skill',
      'mcp',
      'project-template',
      'asset-pack',
      'style',
      'recipe',
      'character-card',
    ];

    expect(WORKSHOP_KINDS).toEqual(['skill', 'mcp', 'project-template', 'asset-pack']);
    expect(kinds.map((kind) => ({ kind })).filter(isWorkshopItem).map(({ kind }) => kind)).toEqual([
      'skill',
      'mcp',
      'project-template',
      'asset-pack',
    ]);
  });

  it.each(['style', 'recipe', 'character-card'])('moves %s into Generate', (kind) => {
    expect(isGenerateKind(kind)).toBe(true);
    expect(isWorkshopItem({ kind })).toBe(false);
  });

  it.each(['skill', 'mcp', 'project-template', 'asset-pack', 'unknown'])('%s is not a Generate kind', (kind) => {
    expect(isGenerateKind(kind)).toBe(false);
  });
});

describe('Workshop Generate destination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects the project most recently updated rather than relying on list order', () => {
    const projects = [
      { id: 'older', name: 'Older', updatedAt: 100, createdAt: 50 },
      { id: 'latest', name: 'Latest', updatedAt: 300, createdAt: 10 },
      { id: 'middle', name: 'Middle', updatedAt: 200, createdAt: 150 },
    ];

    expect(mostRecentStoreProject(projects)).toBe(projects[1]);
  });

  it('falls back to creation time and preserves list order for equal timestamps', () => {
    const projects = [
      { id: 'first', name: 'First', createdAt: 300 },
      { id: 'second', name: 'Second', updatedAt: 300 },
      { id: 'older', name: 'Older', updatedAt: 100 },
    ];

    expect(mostRecentStoreProject(projects)).toBe(projects[0]);
  });

  it('returns no destination when there are no projects', () => {
    expect(mostRecentStoreProject([])).toBeUndefined();
  });

  it('compares numeric contract timestamps with ISO timestamps', () => {
    const projects = [
      { id: 'older', name: 'Older', updatedAt: '2026-10-29T12:00:00.000Z' },
      { id: 'latest', name: 'Latest', updatedAt: Date.UTC(2026, 9, 30, 12) },
    ];

    expect(mostRecentStoreProject(projects)).toBe(projects[1]);
  });

  it('opens the 生成 page, with a game picked when one is given', () => {
    openGenerate('latest');
    openGenerate(undefined, true);

    expect(navigate).toHaveBeenNthCalledWith(1, { kind: 'home', view: 'generate', generateProjectId: 'latest' }, { replace: false });
    expect(navigate).toHaveBeenNthCalledWith(2, { kind: 'home', view: 'generate' }, { replace: true });
  });
});
