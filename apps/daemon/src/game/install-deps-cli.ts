import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { PRODUCT_CLI_NAME, type GameVerifyContext, type GameInstallDepsResult } from '@openpixo/contracts';
import { installGameDependencies, resolveGameCommandDirectory } from './install-deps.js';
import { gameToolResolver } from './verify.js';
import { resolveDaemonUrl } from '../daemon-url.js';

const USAGE = `${PRODUCT_CLI_NAME} game install-deps [projectId] [--json] (defaults to PIXO_PROJECT_ID)`;

/** The game group registration stays here so verification keeps its independent owner. */
export async function runGameCli(args: string[]): Promise<void> {
  if (args[0] !== 'install-deps') {
    if (!args.length || args.includes('--help') || args.includes('-h')) console.log(USAGE);
    return (await import('./verify-cli.js')).runGameCli(args);
  }
  let json = args.includes('--json');
  try {
    if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true,
      options: { json: { type: 'boolean' }, 'daemon-url': { type: 'string' } } });
    json = values.json === true;
    const id = positionals[0] ?? process.env.PIXO_PROJECT_ID;
    if (!id || positionals.length > 1) throw new Error(`Project id required. Usage: ${USAGE}`);
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const endpoint = `${base}/api/projects/${encodeURIComponent(id)}/game/install-deps`;
    const request = async (method: string): Promise<GameInstallDepsResult> => {
      const response = await fetch(endpoint, { method, headers });
      const result = await response.json() as GameInstallDepsResult & { error?: { message?: string; code?: string } };
      if (!response.ok) throw Object.assign(new Error(result.error?.message ?? `Installation request failed (${response.status})`), { code: result.error?.code });
      return result;
    };
    let result: GameInstallDepsResult;
    if (process.env.PIXO_TOOL_TOKEN?.startsWith('pixott_')) {
      // Match verification/playtest: project commands inherit the agent CLI sandbox.
      const response = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/game/verify/context`, { method: 'GET', headers });
      const context = await response.json() as GameVerifyContext & { error?: { code?: string; message?: string } };
      if (!response.ok) throw Object.assign(new Error(context.error?.message ?? `Installation context failed (${response.status})`), { code: context.error?.code });
      if (!['phaser', 'threejs', 'web-generic'].includes(context.profile.engine)) result = { status: 'failed', reasonCode: 'UNSUPPORTED_ENGINE' };
      else {
        const command = context.profile.commands.run ?? context.profile.commands.build ?? context.profile.commands.check;
        const cwd = await resolveGameCommandDirectory(context.projectDir, command?.cwd ?? '.');
        const runtimeDataDir = context.runtimeDataDir ?? process.env.PIXO_DATA_DIR;
        if (!runtimeDataDir) throw new Error('The daemon runtime data root is unavailable');
        result = await installGameDependencies(cwd, runtimeDataDir, gameToolResolver(context.toolPaths));
      }
    } else {
      result = await request('POST');
      while (result.status === 'installing') { await setTimeout(750); result = await request('GET'); }
    }
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      console.log(`Dependencies: ${result.status}`);
      if (result.installCommand) console.log(result.installCommand);
      if (result.fallback) console.log(`${result.requestedPackageManager} is unavailable; using npm.`);
      if (result.message) console.log(result.message);
      if (result.logTail) console.log(result.logTail);
      if (result.logRef) console.log(`Log: ${result.logRef}`);
    }
    if (result.status === 'failed') process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message, code: (error as { code?: string }).code } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
