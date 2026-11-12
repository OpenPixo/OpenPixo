import { SETTINGS_EXECUTION_PATH, type MediaProviderAvailability } from '@openpixo/contracts';
import { agentCliEnvForAgent, readAppConfig } from '../app-config.js';
import { cachedAgent, detectAgent } from '../runtimes/detection.js';
import { codexAgentDef } from '../runtimes/defs/codex.js';
import { spawnEnvForAgentAsync } from '../runtimes/env.js';
import { applyAgentLaunchEnvAsync, resolveAgentLaunchAsync } from '../runtimes/launch.js';

let runtimeDataRoot: string | undefined;

/** The composition root supplies its already-resolved RUNTIME_DATA_DIR once. */
export function configureCodexImageProvider(dataRoot: string): void {
  runtimeDataRoot = dataRoot;
}

export function codexImageDataRoot(explicit?: string): string {
  const root = explicit ?? runtimeDataRoot;
  if (!root) throw new Error('Codex image provider requires the resolved daemon data root');
  return root;
}

export interface CodexImageRuntime {
  status: MediaProviderAvailability;
  executable?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Reuse the certified runtime's executable resolution, auth probe and env.
 *
 * `generating`: the caller is about to make an image, not to report readiness.
 * `codex login status` takes 3.6–3.8 s on an idle Windows machine (codex-cli
 * 0.160.0) and exceeds its 5 s probe while an agent and other image runs are
 * busy, which reads as "unknown". A probe that could not answer is not a
 * sign-out, and the image run itself reports a real one
 * (`CODEX_CLI_AUTH_REQUIRED`), so only a probe that says signed out stops a
 * generation. Before this, one slow probe failed an image mid-batch.
 */
export async function resolveCodexImageRuntime(dataRoot?: string, options: { cached?: boolean; generating?: boolean } = {}): Promise<CodexImageRuntime> {
  const root = dataRoot ?? runtimeDataRoot;
  const configuredEnv = root ? agentCliEnvForAgent((await readAppConfig(root)).agentCliEnv, 'codex') : {};
  const agent = await (options.cached ? cachedAgent : detectAgent)(codexAgentDef, configuredEnv);
  if (!agent.path || (!agent.available && agent.authStatus !== 'missing')) {
    return { status: { available: false, keyless: true, reasonCode: 'CODEX_CLI_NOT_FOUND',
      reason: `Codex CLI is not available. Install it, then detect again in ${SETTINGS_EXECUTION_PATH}.` } };
  }
  const signInUsable = agent.authStatus === 'ok' || (options.generating === true && agent.authStatus === 'unknown');
  if (!signInUsable) {
    return { status: { available: false, keyless: true,
      reasonCode: agent.authStatus === 'missing' ? 'CODEX_CLI_AUTH_REQUIRED' : 'CODEX_CLI_AUTH_UNKNOWN',
      reason: agent.authStatus === 'missing'
        ? 'Codex is not signed in. Run codex login and sign in with ChatGPT, then detect again.'
        : 'Codex sign-in could not be verified. Check Local CLI settings, then detect again.' } };
  }
  const launch = await resolveAgentLaunchAsync({ ...codexAgentDef, bin: agent.path }, configuredEnv);
  const executable = launch.launchPath ?? agent.path;
  const env = await applyAgentLaunchEnvAsync(
    await spawnEnvForAgentAsync('codex', process.env, configuredEnv, undefined, { resolvedBin: executable }), launch,
  );
  return { status: { available: true, keyless: true }, executable, env };
}

export async function codexImageProviderStatus(dataRoot?: string, options: { cached?: boolean } = {}): Promise<MediaProviderAvailability> {
  try {
    return (await resolveCodexImageRuntime(dataRoot, options)).status;
  } catch {
    return { available: false, keyless: true, reasonCode: 'CODEX_CLI_AUTH_UNKNOWN',
      reason: 'Codex readiness could not be checked. Check Local CLI settings, then detect again.' };
  }
}
