import type { Project } from '../types';

/** Include a deep-linked project in the tab names before the local list loads. */
export function projectsForWorkspaceChrome(input: {
  projects: Project[];
  activeProject: Project | null;
  activeProjectId: string | null;
}): Project[] {
  const { projects, activeProject } = input;
  const rows =
    activeProject && !projects.some((project) => project.id === activeProject.id)
      ? [...projects, activeProject]
      : projects;
  return rows;
}
