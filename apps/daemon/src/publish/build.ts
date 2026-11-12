import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { EngineProfile } from '@openpixo/contracts';
import { prepareGameDependencyInstall, resolveGameCommandDirectory } from '../game/install-deps.js';
import { executeGameProcess, GameCommandTimeout } from '../game/verify-process.js';

const BUILD_TIMEOUT_MS = 300_000;
const OUTPUT_TAIL_BYTES = 4096;

export class PublishBuildError extends Error {}

export interface ProjectBuildInput {
  profile: EngineProfile;
  projectDir: string;
  resolveTool: (id: string) => string | null | Promise<string | null>;
  /** What the user does after fixing a failure; publishing and exporting share this build. */
  retry?: string;
}

/**
 * Runs the project's own build script. A static project without one has nothing to
 * do. The daemon calls this for the creator; the CLI calls it for an agent, so the
 * project's commands stay inside the agent's sandbox.
 */
export async function runProjectBuild({ profile, projectDir, resolveTool, retry = 'publish again' }: ProjectBuildInput): Promise<void> {
  const command = profile.commands.build;
  if (!command?.argv[0]) return;
  const cwd = await resolveGameCommandDirectory(projectDir, command.cwd);
  const plan = await prepareGameDependencyInstall(cwd, resolveTool);
  if (plan.reasonCode || !plan.executable || !plan.packageManager) throw new PublishBuildError(plan.message ?? 'The tools this game builds with are missing.');
  const installed = await stat(path.join(cwd, 'node_modules')).then(value => value.isDirectory(), () => false);
  if (!installed) throw new PublishBuildError(`Project dependencies are missing. Run ${plan.installCommand ?? 'the package install'} in the game folder, then ${retry}.`);
  let tail = Buffer.alloc(0);
  const fail = (reason: string) => {
    const output = tail.toString('utf8').replace(/\x1b\[[0-9;]*m/gu, '').trim();
    return new PublishBuildError(`${reason}${output ? `\n${output}` : ''}`);
  };
  let exitCode: number | null;
  try {
    ({ exitCode } = await executeGameProcess({ projectDir, command: { ...command, timeoutMs: BUILD_TIMEOUT_MS },
      executable: plan.executable, argv: [plan.packageManager, ...command.argv.slice(1)],
      output: chunk => { tail = Buffer.concat([tail, chunk]).subarray(-OUTPUT_TAIL_BYTES); } }));
  } catch (error) {
    throw fail(error instanceof GameCommandTimeout ? 'The build took too long and was stopped.' : 'The build could not start.');
  }
  if (exitCode !== 0) throw fail(`The game failed to build. Fix the errors below, then ${retry}.`);
}
