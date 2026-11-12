import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import type { GameVerifyContext, GameVerifyRegisterRequest, GameVerifyResult, GameVerifyStepName, GameWebCaptureResult } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';
import { gameToolResolver, verifyGame } from './verify.js';
import { GAME_RUN_USAGE, runGameRunCli } from './run-cli.js';
import { GAME_PLAYTEST_USAGE, runGamePlaytestCli } from './playtest-cli.js';
import { GAME_PLAN_USAGE, runGamePlanCli } from './plan-cli.js';

const USAGE = `${PRODUCT_CLI_NAME} game verify [--project <id>] [--steps check,build,run] [--screenshot] [--json]\n${GAME_RUN_USAGE}`;

/** Verification runs in the agent's CLI child; game lifecycle stays daemon-owned. */
export async function runGameCli(args: string[]): Promise<void> {
  if (args[0] === 'playtest') { await runGamePlaytestCli(args); return; }
  if (args[0] === 'export') { await (await import('./export-cli.js')).runGameExportCli(args); return; }
  if (args[0] === 'plan' || args[0] === 'scaffold') { await runGamePlanCli(args); return; }
  if (['run', 'run-status', 'stop'].includes(args[0] ?? '')) { await runGameRunCli(args); return; }
  let json = args.includes('--json');
  try {
    if (args.includes('--help') || args.includes('-h') || args.length === 0) { console.log(USAGE + '\n' + GAME_PLAYTEST_USAGE + '\n' + GAME_PLAN_USAGE + '\n' + (await import('./export-cli.js')).GAME_EXPORT_USAGE); return; }
    if (args[0] !== 'verify') throw new Error(`Usage: ${USAGE}`);
    const { values } = parseArgs({ args: args.slice(1), options: {
      project: { type: 'string' }, steps: { type: 'string' }, screenshot: { type: 'boolean' }, json: { type: 'boolean' },
      'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error(`Project id required. Usage: ${USAGE}`);
    const steps = values.steps?.split(',') as GameVerifyStepName[] | undefined;
    if (steps?.some(step => !['check', 'build', 'run'].includes(step))) throw new Error('--steps must contain check, build, or run');
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const prefix = `${base}/api/projects/${encodeURIComponent(projectId)}/game/verify`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const api = async <T>(suffix: string, body?: unknown): Promise<T> => {
      const response = await fetch(`${prefix}${suffix}`, { headers, method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json() as T & { error?: { message?: string } };
      if (!response.ok) throw new Error(data?.error?.message ?? `Verification request failed (${response.status})`);
      return data as T;
    };
    const prepared = await api<GameVerifyContext>('/context');
    const runId = prepared.runId ?? process.env.PIXO_RUN_ID;
    const result = await verifyGame({ ...prepared, request: { ...(steps ? { steps } : {}),
      ...(values.screenshot !== undefined ? { screenshot: values.screenshot } : {}), ...(runId ? { runId } : {}) },
      resolveTool: gameToolResolver(prepared.toolPaths),
      ...(prepared.webCaptureAvailable ? { captureWeb: input => api<GameWebCaptureResult>('/capture', input) } : {}),
    });
    const registration: GameVerifyRegisterRequest = { result, ...(runId ? { runId } : {}) };
    const registered = await api<GameVerifyResult>('/register', registration);
    if (json) process.stdout.write(`${JSON.stringify(registered, null, 2)}\n`);
    else {
      console.log(`Verification: ${registered.status}`);
      for (const step of registered.steps) {
        console.log(`${step.name}: ${step.status ?? (step.exitCode === 0 ? 'passed' : 'failed')} (exit ${step.exitCode}, ${step.durationMs} ms${step.timedOut ? ', timed out' : ''})`);
        if (step.message) console.log(step.message);
      }
      if (registered.missingTools.length) console.log(`Missing tools: ${registered.missingTools.join(', ')}`);
      for (const guidance of registered.missingToolGuidance ?? []) {
        console.log(guidance.hint);
        if (guidance.installUrl) console.log(`Download ${guidance.name}: ${guidance.installUrl}`);
      }
      for (const shot of registered.screenshots) console.log(`Screenshot: ${shot.path}`);
    }
    if (registered.status === 'failed') process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
