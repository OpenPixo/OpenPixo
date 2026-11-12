import type { GameEngineId } from './game-project.js';

export type ProjectNextStepId = 'environment' | 'run-game' | 'agent-task' | 'media-assets' | 'verify';
export type ProjectNextStepStatus = 'done' | 'todo' | 'blocked';

export type ProjectNextStepAction =
  | { kind: 'open-settings'; value: 'environment' }
  | { kind: 'run-game' | 'verify'; value: string }
  | { kind: 'prefill-chat'; value: string }
  | { kind: 'open-tab'; value: 'assets' | 'generate' };

export interface ProjectNextStep {
  id: ProjectNextStepId;
  status: ProjectNextStepStatus;
  action: ProjectNextStepAction;
}

/** GET /api/projects/:id/next-steps and POST /api/projects/:id/next-steps/dismiss. */
export interface ProjectNextStepsResponse {
  projectId: string;
  engine: GameEngineId;
  dismissed: boolean;
  /** Ordered, derived facts. Only dismissal is persisted as a preference. */
  steps: ProjectNextStep[];
}
