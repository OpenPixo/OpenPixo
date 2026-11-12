// Plan G4 — Phase 2B router contract for the marketplace routes.

import { describe, expect, it } from 'vitest';
import { buildPath, parseRoute, type Route } from '../src/router';

describe('router /marketplace', () => {
  it('parses /marketplace as the catalog grid route', () => {
    expect(parseRoute('/marketplace')).toEqual({ kind: 'marketplace' });
    expect(parseRoute('/marketplace/')).toEqual({ kind: 'marketplace' });
  });

  it('parses /marketplace/<pluginId> as a detail route', () => {
    expect(parseRoute('/marketplace/sample-plugin')).toEqual({
      kind: 'marketplace-detail',
      pluginId: 'sample-plugin',
    });
  });

  it('resolves the retired /plugins browse route to Store', () => {
    expect(parseRoute('/plugins')).toEqual({ kind: 'home', view: 'store' });
    expect(parseRoute('/plugins/')).toEqual({ kind: 'home', view: 'store' });
    expect(buildPath({ kind: 'home', view: 'plugins' })).toBe('/store');
  });

  it('parses /plugins/<pluginId> as the same detail route (alias)', () => {
    expect(parseRoute('/plugins/sample-plugin')).toEqual({
      kind: 'marketplace-detail',
      pluginId: 'sample-plugin',
    });
  });

  it('round-trips through buildPath', () => {
    for (const route of [
      { kind: 'marketplace' } as Route,
      { kind: 'marketplace-detail', pluginId: 'sample-plugin' } as Route,
    ]) {
      expect(parseRoute(buildPath(route))).toEqual(route);
    }
  });

  it('does not break the home / project routes', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home', view: 'home' });
    expect(parseRoute('/projects/abc')).toEqual({
      kind: 'project',
      projectId: 'abc',
      conversationId: null,
      fileName: null,
    });
  });
});

describe('router entry sub-views', () => {
  it('parses /projects (no id) as the projects entry view', () => {
    expect(parseRoute('/projects')).toEqual({ kind: 'home', view: 'projects' });
    expect(parseRoute('/projects/')).toEqual({ kind: 'home', view: 'projects' });
  });

  it('falls back to home for the retired library route', () => {
    expect(parseRoute('/library')).toEqual({ kind: 'home', view: 'home' });
  });

  it('falls back to home for saved Community URLs and destinations', () => {
    expect(parseRoute('/community')).toEqual({ kind: 'home', view: 'home' });
    expect(parseRoute('/community/template')).toEqual({ kind: 'home', view: 'home' });
    expect(buildPath({ kind: 'home', view: 'community' })).toBe('/');
  });

  it('still parses /projects/<id> as a project detail route', () => {
    expect(parseRoute('/projects/abc')).toEqual({
      kind: 'project',
      projectId: 'abc',
      conversationId: null,
      fileName: null,
    });
  });

  it('parses /onboarding as the global onboarding panel', () => {
    expect(parseRoute('/onboarding')).toEqual({ kind: 'home', view: 'onboarding' });
    expect(buildPath({ kind: 'home', view: 'onboarding' })).toBe('/onboarding');
  });
});
