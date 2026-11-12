import { usesBundledOpenCode } from './byok-opencode.js';
import { agentCapabilities } from './capabilities.js';
import { readOnlyTurnOpenCodeConfig } from './read-only-turn.js';
import type { RuntimeAgentDef } from './types.js';

export const OPENCODE_SKIP_PERMISSIONS_FLAG = '--dangerously-skip-permissions';
export const OPENCODE_WORKSPACE_DIR_FLAG = '--dir';

export const OPENCODE_PERMISSION_CAPABILITY = {
  helpArgs: ['run', '--help'],
  capabilityFlags: {
    '--auto': 'autoApprove',
    [OPENCODE_SKIP_PERMISSIONS_FLAG]: 'skipPermissions',
  },
} satisfies Pick<RuntimeAgentDef, 'helpArgs' | 'capabilityFlags'>;

/**
 * The extra OpenCode config for one run.
 *
 * The bundled runtimes never offer OpenCode's own skills. Left alone, OpenCode
 * lists every skill it finds in the user's home folders (`.claude`, `.agents`,
 * its global config folder) in the system prompt of every model request, so
 * someone with skills installed for other tools pays credits for them and the
 * agent can follow them in a game project. OpenPixo's enabled skills do not use
 * this path: they arrive in the composed prompt and are staged in `.pixo-skills/`.
 *
 * The permission, not `OPENCODE_DISABLE_EXTERNAL_SKILLS`, because that flag still
 * leaves OpenCode's global skills folder. Someone's own OpenCode CLI keeps theirs.
 */
export function openCodeRunExtraConfig(
  agentId: string,
  providerConfig: Record<string, unknown> | null | undefined,
  readOnlyTurn: boolean,
): Record<string, unknown> | null {
  const config = usesBundledOpenCode(agentId)
    ? withOpenCodeSkillsDenied(providerConfig ?? {})
    : providerConfig ?? null;
  return readOnlyTurn ? readOnlyTurnOpenCodeConfig(config ?? {}) : config;
}

function withOpenCodeSkillsDenied(config: Record<string, unknown>): Record<string, unknown> {
  const permission = config.permission && typeof config.permission === 'object' && !Array.isArray(config.permission)
    ? config.permission as Record<string, unknown>
    : {};
  return { ...config, permission: { ...permission, skill: 'deny' } };
}

export function appendOpenCodePermissionBypass(args: string[], agentId: string): void {
  const capabilities = agentCapabilities.get(agentId);
  // OpenCode 1.18.34 advertises --auto; its legacy bypass flag is hidden from --help.
  if (capabilities?.autoApprove) {
    args.push('--auto');
  } else if (capabilities?.skipPermissions) {
    args.push(OPENCODE_SKIP_PERMISSIONS_FLAG);
  }
}

/**
 * Pin OpenCode's workspace to the resolved project directory.
 *
 * OpenCode does not treat its process cwd as the project: it walks up to the
 * nearest enclosing git root and adopts THAT as the worktree (verified with
 * `opencode debug scrap`, whose every registered project is a git root). A
 * managed project directory is not a git repository, and a development install
 * keeps the daemon data directory under the repository root — so OpenCode walks
 * past the project and adopts the whole OpenPixo checkout.
 *
 * The consequences are all silent: the agent names the repository root as its
 * workspace and writes the deliverable there, the project directory stays
 * empty, `snapshotProjectArtifactsAsync(cwd)` sees nothing, and the Run reports
 * `no_artifact`. `permission.external_directory` cannot catch it either — once
 * the repository is the worktree, writing inside it is an in-project write.
 *
 * Sent unconditionally, matching the BYOK OpenCode definition that already
 * carried this workaround. Gating it on the `--help` capability probe would
 * turn a missing flag back into the silent data-loss bug; an OpenCode build
 * without `--dir` should fail loudly at spawn instead.
 */
export function appendOpenCodeWorkspaceDir(
  args: string[],
  cwd: string | null | undefined,
): void {
  if (typeof cwd !== 'string' || cwd.length === 0) return;
  args.push(OPENCODE_WORKSPACE_DIR_FLAG, cwd);
}
