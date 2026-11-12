// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { buildPath, parseRoute, type Route } from '../src/router';

describe('Workshop routes', () => {
  it('keeps item names that match object prototype properties', () => {
    expect(parseRoute('/store/constructor')).toEqual({
      kind: 'home',
      view: 'store',
      storeItemName: 'constructor',
    });
  });

  it.each([
    ['/store/styles', 'style'],
    ['/store/recipes', 'recipe'],
    ['/store/character-cards', 'character-card'],
  ] as const)('preserves the moved-kind deep link %s for Generate redirection', (path, kind) => {
    expect(parseRoute(path)).toEqual({
      kind: 'home',
      view: 'store',
      storeTab: kind,
    });
  });

  it('parses the project Generate tab', () => {
    expect(parseRoute('/projects/my-game/generate')).toEqual({
      kind: 'project',
      projectId: 'my-game',
      workspaceTab: 'generate',
      conversationId: null,
      fileName: null,
    });
  });

  it('builds the project Generate tab URL', () => {
    const route: Route = {
      kind: 'project',
      projectId: 'my-game',
      workspaceTab: 'generate',
      conversationId: null,
      fileName: null,
    };

    expect(buildPath(route)).toBe('/projects/my-game/generate');
  });
});
