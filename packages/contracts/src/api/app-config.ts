

export interface AgentModelPrefs {
  model?: string;
  reasoning?: string;
  serviceTier?: string;
  /** Effort last chosen for each model, restored when the user switches back to it. */
  reasoningByModel?: Record<string, string>;
}

export type AgentCliEnvPrefs = Record<string, Record<string, string>>;
export type AgentCliEnvIntentPrefs = Record<string, { apiKeyOverride?: boolean }>;
export type AgentApprovalMode = 'in-app' | 'skip';
export type AgentApprovalModes = Record<string, AgentApprovalMode>;

export interface TelemetryPrefs {
  metrics?: boolean;
}



export interface ProjectLocationPrefs {
  id: string;
  name: string;
  path: string;
}

export interface GameEnginePaths {
  godot?: string;
  unity?: string;
  cocosCreator?: string;
}

/**
 * Whether the user has made a game before: asked once, on their first new
 * game, and changeable in Settings. A first-timer (`first`) is offered only 2D
 * perspectives and the Phaser and Godot starters.
 */
export const GAME_EXPERIENCE_LEVELS = ['first', 'some', 'experienced'] as const;
export type GameExperience = (typeof GAME_EXPERIENCE_LEVELS)[number];

export function isGameExperience(value: unknown): value is GameExperience {
  return typeof value === 'string' && (GAME_EXPERIENCE_LEVELS as readonly string[]).includes(value);
}

export interface AppConfigPrefs {
  /** Optional executable paths; empty entries use PATH discovery. */
  gameEnginePaths?: GameEnginePaths;
  onboardingCompleted?: boolean;
  /** Asked on the first new game. Absent or null: not asked yet. */
  gameExperience?: GameExperience | null;
  agentId?: string | null;
  agentModels?: Record<string, AgentModelPrefs>;
  /**
   * The image model the agent makes art with, whichever agent runs. Absent means
   * automatic. A pick that cannot run in a run falls back to automatic, and the
   * agent is told so it can say it. Ids come from `GET /api/media/agent-image-models`.
   */
  agentImageModel?: string;
  /** Unconfigured Claude runs use in-app approval. */
  agentApprovalModes?: AgentApprovalModes;
  agentCliEnv?: AgentCliEnvPrefs;
  agentCliEnvIntent?: AgentCliEnvIntentPrefs;
  skillId?: string | null;
  disabledSkills?: string[];
  installationId?: string | null;
  telemetry?: TelemetryPrefs;
  /**
   * Unix-millis timestamp of when the user resolved the first-run privacy
   * consent surface (Share or Decline). Set on first decision and on
   * subsequent toggles in Settings → Privacy. Independent of
   * installationId so that "Delete my data" can rotate the id without
   * re-popping the consent banner.
   */
  privacyDecisionAt?: number | null;
  allowSilentUpdates?: boolean;

  customInstructions?: string | null;
  /** External project library roots. The daemon adds its built-in .pixo/projects location at read time. */
  projectLocations?: ProjectLocationPrefs[];
  /** Project location id used for new projects when the create request does not choose one explicitly. */
  defaultProjectLocationId?: string | null;
  /**
   * Most-recently-used local working directories the user granted the agent
   * read access to (via the Home composer's working-directory picker). These
   * become a new project's `metadata.linkedDirs` — the agent perceives them
   * through `--add-dir`; they are NOT imported into Design Files. Stored
   * most-recent-first and capped by the daemon.
   */
  recentLinkedDirs?: string[];
}

export interface AppConfigResponse {
  config: AppConfigPrefs;
}

export type UpdateAppConfigRequest = Partial<AppConfigPrefs>;

/** Response body for `GET /api/recent-dirs` — recent working directories
 *  pruned to those that still exist on disk, most-recent-first. */
export interface RecentLinkedDirsResponse {
  dirs: string[];
}
