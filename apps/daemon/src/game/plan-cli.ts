import { parseArgs } from 'node:util';
import {
  ART_SPENDING_MODE_DEFAULT,
  ART_SPENDING_MODES,
  PRODUCT_CLI_NAME,
  parseArtApprovalCredits,
  parseArtBudgetCredits,
  parseArtSpendingMode,
  type ApproveArtRequest,
  type ApproveGamePlanResponse,
  type ArtBudgetResponse,
  type ArtSpendingMode,
  type SetArtBudgetRequest,
  type GamePlanResponse,
  type GameScaffoldResponse,
} from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

export const GAME_PLAN_USAGE = `${PRODUCT_CLI_NAME} game plan [approve [--art-budget <credits>]] [--project <id>] [--json]
  Show a new game's plan state, or approve the plan as the user, with the credits the agent may spend on images. An agent cannot approve.
${PRODUCT_CLI_NAME} game plan budget [--credits <n>] [--mode ask|auto] [--project <id>] [--json]
  Show the art budget, or set it as the user: 0 means the agent will not spend credits. With ask, the agent spends only what you approve on an art card; with auto, anything within the budget. An agent can read it but not change it, and changes wait while a run is active.
${PRODUCT_CLI_NAME} game plan approve-art --credits <n> [--project <id>] [--json]
  Approve the agent's art card as the user: its next turn may spend up to <n> credits, within the budget. An agent cannot approve.
${PRODUCT_CLI_NAME} game scaffold --template <id> [--project <id>] [--json]
  Copy a starter (${PRODUCT_CLI_NAME} project game-templates) into this project's empty folder. Waits for an approved plan.`;

function creditsFlag(flag: string, value: string): number {
  const credits = /^\d+$/u.test(value) ? parseArtBudgetCredits(Number(value)) : null;
  if (credits === null) throw Object.assign(new Error(`${flag} must be a whole number of credits.`), { code: 'BAD_REQUEST' });
  return credits;
}

function modeFlag(value: string): ArtSpendingMode {
  const mode = parseArtSpendingMode(value);
  if (mode === null) throw Object.assign(new Error(`--mode must be one of ${ART_SPENDING_MODES.join(', ')}.`), { code: 'BAD_REQUEST' });
  return mode;
}

/** The budget, how it is spent, and the approval waiting for a turn, in plain lines. */
function artBudgetLines(body: ArtBudgetResponse): string {
  const lines = [body.budget ? `Art budget: ${body.budget.usedCredits} of ${body.budget.limitCredits} credits used.` : 'This project has no art budget.'];
  const mode = body.mode ?? ART_SPENDING_MODE_DEFAULT;
  lines.push(mode === 'ask' ? 'Spending: asks before spending (art cards).' : 'Spending: spends within the budget without asking.');
  const approval = body.approval;
  if (approval) {
    lines.push(approval.runId === null
      ? `Approved: ${approval.approvedCredits} credits, waiting for the next turn.`
      : `Approved: ${approval.approvedCredits} credits, ${approval.usedCredits} used by a turn, ${approval.remainingCredits} left for that turn.`);
  }
  return lines.join('\n');
}

async function call<T>(base: string, route: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${base}${route}`, init);
  const body = await response.json() as T & { error?: { message?: string; code?: string } };
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message ?? `Request failed (${response.status})`), { code: body.error?.code });
  }
  return body;
}

/** `pixo game plan` and `pixo game scaffold`, over the same endpoints the web UI uses. */
export async function runGamePlanCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    const command = args[0];
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      project: { type: 'string' }, template: { type: 'string' }, json: { type: 'boolean' },
      'art-budget': { type: 'string' }, credits: { type: 'string' }, mode: { type: 'string' },
      help: { type: 'boolean', short: 'h' }, 'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    if (values.help) { console.log(GAME_PLAN_USAGE); return; }
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error(`Project id required.\n${GAME_PLAN_USAGE}`);
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const project = `/api/projects/${encodeURIComponent(projectId)}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    const agentToken = process.env.PIXO_TOOL_TOKEN;
    if (agentToken) headers.authorization = `Bearer ${agentToken}`;

    let result: GamePlanResponse | ApproveGamePlanResponse | GameScaffoldResponse | ArtBudgetResponse;
    let line: string;
    if (command === 'scaffold') {
      if (!values.template) throw new Error(`--template required.\n${GAME_PLAN_USAGE}`);
      const body = await call<GameScaffoldResponse>(base, `${project}/game/scaffold`, { method: 'POST', headers, body: JSON.stringify({ templateId: values.template }) });
      result = body;
      line = `Scaffolded ${body.templateId} (${body.engine}) into ${body.projectDir}`;
    } else if (positionals[0] === 'approve') {
      // The daemon refuses this token too; failing here says why without a round trip.
      if (agentToken) throw Object.assign(new Error('Only the user can approve the plan. Ask them to press the approve button.'), { code: 'FORBIDDEN' });
      const artBudgetCredits = values['art-budget'] === undefined ? undefined : creditsFlag('--art-budget', values['art-budget']);
      const body = await call<ApproveGamePlanResponse>(base, `${project}/game-plan/approve`, { method: 'POST', headers, body: JSON.stringify(artBudgetCredits === undefined ? {} : { artBudgetCredits }) });
      result = body;
      line = artBudgetCredits === undefined ? 'Plan approved.' : `Plan approved. Art budget: ${artBudgetCredits} credits.`;
    } else if (positionals[0] === 'budget') {
      const change = values.credits !== undefined || values.mode !== undefined;
      if (change && agentToken) {
        // The daemon refuses this token too; failing here says why without a round trip.
        throw Object.assign(new Error('Only the user can set the art budget. Ask them to change it when this turn ends.'), { code: 'FORBIDDEN' });
      }
      const update: SetArtBudgetRequest = {
        ...(values.credits !== undefined ? { credits: creditsFlag('--credits', values.credits) } : {}),
        ...(values.mode !== undefined ? { mode: modeFlag(values.mode) } : {}),
      };
      const body = await call<ArtBudgetResponse>(base, `${project}/art-budget`, change ? { method: 'POST', headers, body: JSON.stringify(update) } : { headers });
      result = body;
      line = artBudgetLines(body);
    } else if (positionals[0] === 'approve-art') {
      if (agentToken) throw Object.assign(new Error('Only the user can approve art. Ask them to press Approve on the art card.'), { code: 'FORBIDDEN' });
      if (values.credits === undefined) throw new Error(`--credits required.\n${GAME_PLAN_USAGE}`);
      const credits = creditsFlag('--credits', values.credits);
      if (parseArtApprovalCredits(credits) === null) throw Object.assign(new Error('--credits must be above 0.'), { code: 'BAD_REQUEST' });
      const approveBody: ApproveArtRequest = { credits };
      const body = await call<ArtBudgetResponse>(base, `${project}/art-budget/approve`, { method: 'POST', headers, body: JSON.stringify(approveBody) });
      result = body;
      line = artBudgetLines(body);
    } else if (positionals.length === 0) {
      const { authorization: _agent, ...local } = headers;
      const body = await call<GamePlanResponse>(base, `${project}/game-plan`, { headers: local });
      result = body;
      line = body.plan ? `Plan: ${body.plan.status}` : 'This project needs no plan.';
    } else {
      throw new Error(GAME_PLAN_USAGE);
    }
    process.stdout.write(`${json ? JSON.stringify(result, null, 2) : line}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code;
    if (json) process.stdout.write(`${JSON.stringify({ error: { message, ...(code ? { code } : {}) } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
