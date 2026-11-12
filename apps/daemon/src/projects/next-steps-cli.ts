import { parseArgs } from 'node:util';
import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import type { ProjectNextStep, ProjectNextStepsResponse } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

const USAGE = `Usage: ${PRODUCT_CLI_NAME} project next-steps <projectId> [--json] [--dismiss] [--daemon-url <url>]

Show the game's starter checklist, or hide it with --dismiss.
`;

const STEP_LABELS: Record<ProjectNextStep['id'], string> = {
  environment: 'Environment ready',
  'run-game': 'Run the game',
  'agent-task': 'Complete an agent task',
  'media-assets': 'Add a media asset',
  verify: 'Verify the game',
};

/** Describe the daemon's facts without inventing local checklist progress. */
export function formatProjectNextSteps(result: ProjectNextStepsResponse): string {
  const done = result.steps.filter((step) => step.status === 'done').length;
  const heading = `Get started with this game: ${done} / ${result.steps.length}${result.dismissed ? ' (hidden)' : ''}`;
  return [heading, ...result.steps.map((step) => {
    const action = step.status === 'done' ? '' : `\t${step.action.kind}: ${step.action.value.replace(/[\r\n\t]/gu, ' ')}`;
    return `${step.status}\t${STEP_LABELS[step.id]}${action}`;
  })].join('\n');
}

/** The CLI and empty conversation card consume the same checklist endpoints. */
export async function runProjectNextStepsCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      json: { type: 'boolean' },
      dismiss: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    if (values.help) {
      process.stdout.write(USAGE);
      return;
    }
    const projectId = positionals[0];
    if (!projectId?.trim() || positionals.length !== 1) throw new Error(USAGE.trim());
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/+$/u, '');
    const headers: Record<string, string> = { Accept: 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.Authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const endpoint = `${base}/api/projects/${encodeURIComponent(projectId)}/next-steps${values.dismiss ? '/dismiss' : ''}`;
    const response = await fetch(endpoint, {
      method: values.dismiss ? 'POST' : 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as ProjectNextStepsResponse & { error?: string | { message?: string } };
    if (!response.ok) {
      const message = typeof result.error === 'string' ? result.error : result.error?.message;
      throw new Error(message ?? `Starter checklist request failed (${response.status})`);
    }
    process.stdout.write(`${json ? JSON.stringify(result, null, 2) : formatProjectNextSteps(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
