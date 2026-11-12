// Every new game starts in the setup dialog. These rules decide how a given
// start reaches it: before the project exists, or as soon as it opens.
import { GAME_PLAN_PROJECT_KINDS, GAME_SETUP_LIMITS, gameSetupMissingSteps, type ProjectMetadata } from '@openpixo/contracts';
import { canBecomeReference } from './wizard-state';

export interface HomeSetupInput {
  pluginId?: string | null;
  appliedPluginSnapshotId?: string | null;
  skillId?: string | null;
  projectKind?: string | null;
  projectMetadata?: Pick<ProjectMetadata, 'kind' | 'skipDiscoveryBrief'> | null;
  workingDir?: string | null;
  linkedDirs?: readonly string[] | null;
  contextPlugins?: readonly unknown[] | null;
  contextMcpServers?: readonly unknown[] | null;
  initialRunContext?: unknown;
  attachments?: readonly File[];
}

/**
 * Whether a Home composer send can open the new-game dialog in place of making
 * a project. Image, video and audio projects are not games. A plugin, skill,
 * folder or other attached context binds to a project the dialog cannot make,
 * so those are created as before and meet the setup when the project opens.
 */
export function homeSubmitOpensSetup(input: HomeSetupInput): boolean {
  const kind = input.projectKind ?? input.projectMetadata?.kind ?? 'other';
  if (!(GAME_PLAN_PROJECT_KINDS as readonly string[]).includes(kind)) return false;
  if (input.projectMetadata?.skipDiscoveryBrief) return false;
  if (input.pluginId || input.appliedPluginSnapshotId || input.skillId) return false;
  if (input.workingDir || input.linkedDirs?.length || input.initialRunContext) return false;
  if (input.contextPlugins?.length || input.contextMcpServers?.length) return false;
  const files = input.attachments ?? [];
  return files.length <= GAME_SETUP_LIMITS.references && files.every(canBecomeReference);
}

/** A project that is about to be planned and was never set up, like one made from an empty folder. */
export function newGameNeedsSetup(metadata: Pick<ProjectMetadata, 'gamePlan' | 'gameSetup'> | null | undefined): boolean {
  return metadata?.gamePlan?.status === 'planning' && gameSetupMissingSteps(metadata.gameSetup).length > 0;
}

const closedKey = (projectId: string) => `pixo:game-setup-closed:${projectId}`;

/** Closing the dialog is an answer for this session: planning goes on in chat without it. */
export function setupGateClosed(projectId: string): boolean {
  try { return window.sessionStorage.getItem(closedKey(projectId)) === '1'; } catch { return false; }
}

export function closeSetupGate(projectId: string): void {
  try { window.sessionStorage.setItem(closedKey(projectId), '1'); } catch { /* it asks again next time */ }
}
