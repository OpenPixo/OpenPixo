import type { Project } from '../types';
export interface ProjectDisplaySnapshot { projects: Project[]; dirty: boolean; }
let snapshot: ProjectDisplaySnapshot | null = null;
export function readProjectDisplaySnapshot(): ProjectDisplaySnapshot | null { return snapshot ? { ...snapshot } : null; }
export function writeProjectDisplaySnapshot(projects: Project[]): void { snapshot = { projects, dirty: false }; }
export function resetProjectDisplaySnapshots(): void { snapshot = null; }
