import type { ProjectMetadata } from '../types';

/** What the entry surfaces (Home composer, plugin starts) hand App to create a project. */
export interface CreateInput {
  name: string;
  skillId: string | null;
  /** UI-only intent marker; the public project contract still receives only the resolved skill id. */
  skillSelectionProvenance?: 'automatic-default' | 'explicit-user';
  metadata: ProjectMetadata;
  userWorkingDirToken?: string;
}
