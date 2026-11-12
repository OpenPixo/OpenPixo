import { createContext, useContext, type ReactNode } from 'react';

export type ProjectResourceAuthority = 'pending' | 'denied' | 'local';

export interface ProjectPreviewContextValue {
  projectResourceAuthority: ProjectResourceAuthority;
}

const ProjectPreviewContext = createContext<ProjectPreviewContextValue>({
  projectResourceAuthority: 'local',
});

export function ProjectPreviewProvider({ value, children }: {
  value: ProjectPreviewContextValue;
  children: ReactNode;
}) {
  return <ProjectPreviewContext.Provider value={value}>{children}</ProjectPreviewContext.Provider>;
}

export function useProjectPreviewContext(): ProjectPreviewContextValue {
  return useContext(ProjectPreviewContext);
}
