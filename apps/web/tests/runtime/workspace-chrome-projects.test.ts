// The switcher includes a deep-linked local project before the list loads.

import { describe, expect, it } from 'vitest';

import { projectsForWorkspaceChrome } from '../../src/runtime/workspace-chrome-projects';
import type { Project } from '../../src/types';

function project(overrides: Partial<Project>): Project {
  return {
    id: 'p-1',
    name: 'Local name',
    skillId: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('projectsForWorkspaceChrome', () => {

  it('leaves every row alone without an authority, and returns the same array', () => {
    const projects = [project({ id: 'p-1' })];
    expect(
      projectsForWorkspaceChrome({
        projects,
        activeProject: projects[0]!,
        activeProjectId: 'p-1',
        
      }),
    ).toBe(projects);
    expect(
      projectsForWorkspaceChrome({
        projects,
        activeProject: projects[0]!,
        activeProjectId: 'p-1',
        
      }),
    ).toBe(projects);
  });

  it('appends a deep-linked project the local list has not loaded', () => {
    const deepLinked = project({ id: 'p-deep', name: 'Deep link' });
    const rows = projectsForWorkspaceChrome({
      projects: [project({ id: 'p-1' })],
      activeProject: deepLinked,
      activeProjectId: 'p-deep',
      
    });
    expect(rows.map((row) => [row.id, row.name])).toEqual([
      ['p-1', 'Local name'],
      ['p-deep', 'Deep link'],
    ]);
  });
});
