import { PRODUCT_CLI_NAME, type GameRunStatus } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { resolveDaemonUrl } from '../daemon-url.js';

export const GAME_RUN_USAGE = `${PRODUCT_CLI_NAME} game run <projectId> [--json]
${PRODUCT_CLI_NAME} game run-status <projectId> [--json]
${PRODUCT_CLI_NAME} game stop <projectId> [--json]`;

/** Game processes belong to the daemon; the CLI only invokes its lifecycle API. */
export async function runGameRunCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (args.includes('--help') || args.includes('-h')) { console.log(GAME_RUN_USAGE); return; }
    const action = args[0];
    if (action !== 'run' && action !== 'run-status' && action !== 'stop') throw new Error(`Usage: ${GAME_RUN_USAGE}`);
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, 'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    if (positionals.length !== 1 || !positionals[0]) throw new Error(`Project id required. Usage: ${GAME_RUN_USAGE}`);
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const response = await fetch(`${base}/api/projects/${encodeURIComponent(positionals[0])}/game/run`, {
      headers, method: action === 'run' ? 'POST' : action === 'stop' ? 'DELETE' : 'GET',
    });
    const result = await response.json() as GameRunStatus & { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `Game run request failed (${response.status})`);
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      console.log(`Game: ${result.status}`);
      if (result.url) console.log(`Preview: ${result.url}`);
      if (result.message) console.log(result.message);
      if (result.installCommand) console.log(`Install dependencies: ${result.installCommand}`);
      if (result.fallback) console.log(`${result.requestedPackageManager} is unavailable; using npm.`);
      for (const guidance of result.missingToolGuidance ?? []) {
        console.log(guidance.hint);
        if (guidance.installUrl) console.log(`Download ${guidance.name}: ${guidance.installUrl}`);
      }
      if (result.logRef) console.log(`Log: ${result.logRef}`);
    }
    if (result.status === 'failed') process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
