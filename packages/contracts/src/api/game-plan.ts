// OpenPixo new-game plan: every new project is planned in chat (gameplay, art,
// engine, written plan) and the user approves the plan before work starts; it is
// then built one stage per turn. The state lives on `metadata.gamePlan`, is
// daemon-owned, and is absent on projects that never needed planning (an
// imported game, a project from before the rule).
import type { GameEngineId } from './game-project.js';
import type { Project, ProjectMetadata } from './projects.js';

export const GAME_PLAN_STATUSES = ['planning', 'approved'] as const;
export type GamePlanStatus = (typeof GAME_PLAN_STATUSES)[number];

/** Concept images an agent may generate per project before the plan is approved. */
export const GAME_PLAN_CONCEPT_IMAGE_LIMIT = 6;

/** The longest approved plan the daemon records; a plan is meant to be short. */
export const GAME_PLAN_RECORD_MAX_CHARS = 8000;

/** The complete sample game: it is already a game, so it has nothing to plan. */
export const GAME_SAMPLE_TEMPLATE_ID = 'phaser3-sample-platformer';

/** Project kinds that can be a game; a deck, brand or media project skips planning. */
export const GAME_PLAN_PROJECT_KINDS = ['other', 'prototype'] as const;

/** Wording of the approve button, in the prompt so the agent can point at it. */
export const GAME_PLAN_APPROVE_LABELS = {
  en: 'Approve plan and start building',
  'zh-CN': '批准计划，开始制作',
} as const;

export interface GamePlanState {
  status: GamePlanStatus;
  startedAt: number;
  approvedAt?: number;
  /** Concept images the agent has generated while planning. */
  conceptImages?: number;
  /**
   * The agent's last message before the user approved, recorded by the daemon at
   * approval so every build turn sees the plan, whatever the transcript keeps.
   */
  approvedPlan?: string;
}

/** Whether work on this project must wait for the user to approve its plan. */
export function gamePlanIsPending(metadata: Pick<ProjectMetadata, 'gamePlan'> | null | undefined): boolean {
  return metadata?.gamePlan?.status === 'planning';
}

/** GET /api/projects/:id/game-plan. `plan` is null when the project needs no plan. */
export interface GamePlanResponse {
  plan: GamePlanState | null;
}

/** POST /api/projects/:id/game-plan/approve. */
export interface ApproveGamePlanRequest {
  /** The art budget the user approves together with the plan. Omitted, no budget changes. */
  artBudgetCredits?: number;
}

export interface ApproveGamePlanResponse {
  plan: GamePlanState;
  project: Project;
}

/** POST /api/projects/:id/game/scaffold: copies a starter into the project's own folder. */
export interface GameScaffoldRequest {
  templateId: string;
}

export interface GameScaffoldResponse {
  templateId: string;
  engine: GameEngineId;
  projectDir: string;
  /** Top-level entries the starter added. */
  files: string[];
}

/** One engine the agent may offer, with what this machine has for it. */
export interface GameEngineOption {
  engine: GameEngineId;
  name: string;
  /** Starter templates in `pixo game scaffold`; empty when the engine has none. */
  templates: Array<{ id: string; name: string }>;
  /** False when a tool the engine needs was not found on this machine. */
  available: boolean;
  /** Tools the host could not find. */
  missingTools: string[];
}

/** What the game prompt needs about the plan; the daemon fills it per run. */
export interface GamePlanPromptInput {
  status: GamePlanStatus;
  engineOptions?: ReadonlyArray<GameEngineOption> | undefined;
  /** Installed art styles to offer while planning. */
  artStyles?: ReadonlyArray<{ id: string; title: string }> | undefined;
  /** `GamePlanState.approvedPlan`, once approved. */
  approvedPlan?: string | undefined;
}
