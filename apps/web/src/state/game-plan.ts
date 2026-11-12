import type { ApproveGamePlanRequest, ApproveGamePlanResponse } from '@openpixo/contracts';
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
