import { composeOpenPixoGamePrompt, type EngineProfile, type GameProjectPromptInput, type MediaExecutionPolicy, type ByokMediaDefaults, type ProjectMetadata } from '@openpixo/contracts';
import { renderGameMediaGenerationContract } from './media-contract.js';
import { detectEngineProfile, withCurrentToolStatus, type EngineDetectOptions } from './engine-detect.js';
import { planToolNoteForRuntime } from '../runtimes/plan-tool-note.js';

/** The shared game composer plus daemon-owned model and runtime facts. */
export function composeGameSystemPrompt(input: GameProjectPromptInput & {
  agentId?: string | null | undefined;
  mediaExecution?: MediaExecutionPolicy | undefined;
  byokMediaDefaults?: ByokMediaDefaults | undefined;
  /** The app config's `agentImageModel`, for every run whatever the agent. */
  agentImageModel?: string | null | undefined;
}): string {
  return composeOpenPixoGamePrompt({
    ...input,
    planToolNote: input.planToolNote ?? planToolNoteForRuntime(input.agentId, input.streamFormat),
    mediaContractBlock: renderGameMediaGenerationContract(input.mediaExecution, input.byokMediaDefaults, input.engineProfile, input.agentImageModel),
  });
}

/**
 * The engine facts one run's prompt states. A new game is detected from its
 * folder, because the first asset or scan may not have recorded it yet. A
 * stored profile keeps its detection but resolves its tools again, so the
 * agent hears about an engine the user installed, located or lost since then
 * instead of building for one that cannot run here.
 */
export function promptEngineProfile(
  metadata: Pick<ProjectMetadata, 'engineProfile' | 'gamePlan'> | null | undefined,
  cwd: string | null | undefined,
  opts: EngineDetectOptions = {},
): EngineProfile | undefined {
  const stored = metadata?.engineProfile;
  if (metadata?.gamePlan && (!stored || stored.engine === 'unknown') && cwd) return detectEngineProfile(cwd, opts);
  return stored ? withCurrentToolStatus(stored, opts) : undefined;
}

/** Project facts the game prompt reads from `metadata`, shared by the chat run and its tests. */
export function gamePromptProjectInputs(metadata: ProjectMetadata | null | undefined): Pick<GameProjectPromptInput, 'engineProfile' | 'gameSetup' | 'gamePlan'> {
  return {
    engineProfile: metadata?.engineProfile,
    gameSetup: metadata?.gameSetup ?? null,
    gamePlan: metadata?.gamePlan ? {
      status: metadata.gamePlan.status,
      ...(metadata.gamePlan.status === 'approved' && metadata.gamePlan.approvedPlan ? { approvedPlan: metadata.gamePlan.approvedPlan } : {}),
    } : null,
  };
}
