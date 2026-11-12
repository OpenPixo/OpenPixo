import { PRODUCT_CLI_NAME, type GameVerifyContext, type PublishJob, type PublishRequest, type PublishStartResponse, type PublishStatusResponse } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { resolveDaemonUrl } from '../daemon-url.js';
import { gameToolResolver } from '../game/verify.js';
import { runProjectBuild } from './build.js';
import { extraGamePrice } from './extra-game.js';
import { isWebProject } from './web-project.js';

const USAGE = `${PRODUCT_CLI_NAME} publish [--project <id>] [--title <text>] [--accept-terms] [--pay-extra-game] [--no-build] [--json]
    Put this web game on a public link, or update the link it already has. Waits and prints the link.
    --accept-terms is your agreement to the sharing rules, needed once per account.
    --pay-extra-game agrees to the one-time credit charge for a game beyond your plan's game count.
      Updates to that game stay free. Only the creator can give it, never an agent.
${PRODUCT_CLI_NAME} publish status [--project <id>] [--json]
${PRODUCT_CLI_NAME} publish remove [--project <id>] [--json]`;

export interface PublishCliOptions {
  /** Test seam for the wait between status polls. */
  pollMs?: number;
}

export class CliApiError extends Error {
  constructor(message: string, readonly payload?: unknown) { super(message); }
}

/** Calls a project route on the local daemon. Shared with `pixo rooms`. */
export async function projectApi(flagUrl: string | undefined, projectId: string) {
  const base = (await resolveDaemonUrl({ flagUrl: flagUrl ?? null })).replace(/\/$/u, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
  if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
  return async <T>(suffix: string, method = 'GET', body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}${suffix}`, { method, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new CliApiError('OpenPixo could not be reached. Open the app and try again.'); }
    const data = await response.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
    if (!response.ok) throw new CliApiError(data?.error?.message ?? 'Something went wrong. Try again.', data);
    return data as T;
  };
}

export function printCliFailure(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) console.log(JSON.stringify(error instanceof CliApiError && error.payload ? error.payload : { error: { message } }));
  else console.error(message);
  process.exitCode = 1;
}

const PHASE_TEXT: Record<PublishJob['phase'], string> = {
  building: 'Building the game...', checking: 'Checking the build...', uploading: 'Uploading...', activating: 'Putting the new version live...', done: '', failed: '',
};

/** The one-time price the daemon puts beside PUBLISH_EXTRA_GAME_REQUIRED. */
function extraGameCredits(job: PublishJob): number | null {
  const credits = (job.error as { credits?: unknown } | undefined)?.credits;
  return typeof credits === 'number' && Number.isSafeInteger(credits) && credits > 0 ? credits : null;
}

function printExtraGameHint(job: PublishJob): void {
  const credits = extraGameCredits(job);
  const price = credits === null ? 'the one-time credit charge' : `${credits} credits, charged once`;
  console.error(process.env.PIXO_TOOL_TOKEN
    ? `This spends the creator's credits. Ask the creator to confirm it in the Share dialog, or to run ${PRODUCT_CLI_NAME} publish --pay-extra-game themselves.`
    : `To publish it for ${price}, run ${PRODUCT_CLI_NAME} publish --pay-extra-game. Or see the plans: ${PRODUCT_CLI_NAME} credits catalog`);
}

function printFailedJob(job: PublishJob): void {
  console.error(job.error?.message ?? 'Publishing failed.');
  if (job.error?.code === 'PUBLISH_EXTRA_GAME_REQUIRED') printExtraGameHint(job);
  if (job.error?.code === 'INSUFFICIENT_CREDITS') console.error(`See your balance with ${PRODUCT_CLI_NAME} credits balance, and buy credits with ${PRODUCT_CLI_NAME} credits catalog and ${PRODUCT_CLI_NAME} credits buy <sku>. Then publish again.`);
  if (job.refusedFiles?.length) console.error(['Refused files:', ...job.refusedFiles.map(file => `  ${file}`)].join('\n'));
  if (job.error?.code === 'SHARE_TERMS_REQUIRED') console.error(`Read the sharing rules, then run ${PRODUCT_CLI_NAME} publish --accept-terms yourself, or tick the box in the Share dialog.`);
}

function printStatus(status: PublishStatusResponse): void {
  if (status.game) {
    console.log(`Link: ${status.game.url}`);
    console.log(`Title: ${status.game.title}\nVersion: ${status.game.version}\nState: ${status.game.state.replace('_', ' ')}\nPlays this month: ${status.game.playsThisMonth}`);
    if (status.game.removedReason) console.log(`Removed because: ${status.game.removedReason}`);
    if (status.game.extraPaid) console.log('Extra game: paid once, not counted against your plan.');
  } else console.log('Not published.');
  const reasons = { no_cloud: 'This build has no OpenPixo cloud.', signed_out: `Sign in first: ${PRODUCT_CLI_NAME} account login`,
    paused: 'Public links are not open yet.', engine_unsupported: 'Only web games can be published.' };
  if (status.unavailableReason) console.log(reasons[status.unavailableReason]);
  if (status.publishPlan?.planRequired) console.log(`Publishing a link needs a subscription. See the plans: ${PRODUCT_CLI_NAME} credits catalog`);
  else if (status.publishPlan) {
    const megabytes = Math.floor(status.publishPlan.maxGameBytes / 1_048_576);
    console.log(`Live games: ${status.publishPlan.liveGames} of ${status.publishPlan.maxLiveGames}\nMost per game: ${megabytes} MB`);
    if (status.publishPlan.extraGames) console.log(`Extra games (paid once, not counted): ${status.publishPlan.extraGames}`);
    const price = extraGamePrice(status.publishPlan, status.game);
    if (price !== null) console.log(`All of your plan's games are in use. Publish this one for ${price} credits, charged once: ${PRODUCT_CLI_NAME} publish --pay-extra-game`);
  }
  if (!status.termsAccepted && status.termsUrl) console.log(`Sharing rules: ${status.termsUrl}`);
}

/** Builds in this process for an agent: its token may not make the daemon run project commands. */
async function buildInsideAgentSandbox(api: Awaited<ReturnType<typeof projectApi>>): Promise<void> {
  const prepared = await api<GameVerifyContext>('/game/verify/context');
  if (!isWebProject(prepared.profile, prepared.projectDir)) return; // The publish request answers with the plain refusal.
  await runProjectBuild({ profile: prepared.profile, projectDir: prepared.projectDir, resolveTool: gameToolResolver({ ...prepared.toolPaths }) });
}

export async function runPublishCli(args: string[], options: PublishCliOptions = {}): Promise<void> {
  let json = args.includes('--json');
  try {
    if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      json: { type: 'boolean' }, project: { type: 'string' }, title: { type: 'string' }, 'accept-terms': { type: 'boolean' },
      'pay-extra-game': { type: 'boolean' }, 'no-build': { type: 'boolean' }, 'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    const command = positionals[0] ?? 'publish';
    if (positionals.length > 1 || !['publish', 'status', 'remove'].includes(command)) throw new Error(`Usage: ${USAGE}`);
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error(`Project id required: pass --project <id>.\n${USAGE}`);
    const api = await projectApi(values['daemon-url'], projectId);

    if (command === 'status') {
      const status = await api<PublishStatusResponse>('/publish');
      if (json) console.log(JSON.stringify(status, null, 2)); else printStatus(status);
      return;
    }
    if (command === 'remove') {
      const result = await api<{ ok: true }>('/publish', 'DELETE');
      if (json) console.log(JSON.stringify(result)); else console.log('Removed the public link. It stops working within a minute.');
      return;
    }

    const request: PublishRequest = { ...(values.title !== undefined ? { title: values.title } : {}),
      ...(values['accept-terms'] ? { acceptTerms: true } : {}), ...(values['pay-extra-game'] ? { payExtraGame: true } : {}),
      ...(values['no-build'] ? { skipBuild: true } : {}) };
    if (process.env.PIXO_TOOL_TOKEN && !request.skipBuild) {
      if (!json) console.error(PHASE_TEXT.building);
      await buildInsideAgentSandbox(api);
      request.skipBuild = true;
    }
    const { job: started } = await api<PublishStartResponse>('/publish', 'POST', request);
    let phase: PublishJob['phase'] | null = null;
    let done = 0;
    let job = started;
    for (;;) {
      if (!json && job.phase !== phase && PHASE_TEXT[job.phase]) console.error(PHASE_TEXT[job.phase]);
      if (!json && job.phase === 'uploading' && job.filesDone !== done && job.filesTotal) console.error(`  ${job.filesDone} of ${job.filesTotal} files`);
      phase = job.phase; done = job.filesDone;
      if (job.phase === 'done' || job.phase === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 1000));
      const status = await api<PublishStatusResponse>('/publish');
      if (!status.job || status.job.id !== started.id) throw new Error('The publish stopped because OpenPixo restarted. Your link still shows the previous version. Publish again.');
      job = status.job;
    }
    if (job.phase === 'failed') {
      if (json) console.log(JSON.stringify({ job, error: job.error, ...(job.refusedFiles ? { refusedFiles: job.refusedFiles } : {}) }, null, 2));
      else printFailedJob(job);
      process.exitCode = 1;
      return;
    }
    const final = await api<PublishStatusResponse>('/publish');
    if (json) console.log(JSON.stringify(final, null, 2));
    else console.log(final.game ? `Published: ${final.game.url}` : 'Published. Run pixo publish status for the link.');
  } catch (error) {
    printCliFailure(error, json);
  }
}
