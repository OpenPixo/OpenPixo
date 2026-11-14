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

  it('opens 生成 as its own page, for no game or for one', () => {
    expect(parseRoute('/generate')).toEqual({ kind: 'home', view: 'generate' });
    expect(parseRoute('/generate/my-game')).toEqual({ kind: 'home', view: 'generate', generateProjectId: 'my-game' });
    expect(buildPath({ kind: 'home', view: 'generate' })).toBe('/generate');
    expect(buildPath({ kind: 'home', view: 'generate', generateProjectId: 'my game' })).toBe('/generate/my%20game');
  });

  it('sends the old per-game Generate tab to the page with that game picked', () => {
    expect(parseRoute('/projects/my-game/generate')).toEqual({ kind: 'home', view: 'generate', generateProjectId: 'my-game' });
    const route: Route = { kind: 'project', projectId: 'my-game', conversationId: null, fileName: null };
    expect(buildPath(route)).toBe('/projects/my-game');
  });
});
