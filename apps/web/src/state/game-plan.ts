import type { ApproveGamePlanRequest, ApproveGamePlanResponse, StartNextStageConversationRequest, StartNextStageConversationResponse } from '@openpixo/contracts';
import type { Project } from '../types';

/** The user approves a new game's plan; same endpoint as `pixo game plan approve`. */
export async function approveGamePlan(projectId: string, artBudgetCredits?: number): Promise<Project> {
  const request: ApproveGamePlanRequest = artBudgetCredits === undefined ? {} : { artBudgetCredits };
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/game-plan/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json() as ApproveGamePlanResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Approving the plan failed (${response.status})`);
  return body.project as Project;
}

/**
 * The next build stage in a fresh conversation of this project; same endpoint as
 * `pixo game plan next-stage`. The response's `firstMessage` is sent there as the first turn.
 */
export async function startNextStageConversation(projectId: string, fromConversationId: string, locale?: string): Promise<StartNextStageConversationResponse> {
  const request: StartNextStageConversationRequest = { fromConversationId, ...(locale ? { locale } : {}) };
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/game-plan/next-stage-conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json() as StartNextStageConversationResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Starting the next stage failed (${response.status})`);
  return body;
}
