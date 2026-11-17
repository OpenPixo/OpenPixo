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
 *
 * The bundled runtimes also turn off OpenCode's file snapshots. OpenCode records the
 * whole working tree in a private git repository before and after every model step
 * (`git add` + `write-tree`), only so that its own undo and revert can restore files.
 * OpenPixo never calls either, and it finds a turn's changed files itself. In a game
 * folder with art in it each snapshot took about 1.2 s on Windows, two per step: 2.5 s
 * of a 4 to 5 s step with DeepSeek Flash, a minute or two of every request (owner
 * report, 2026-11-16).
 *
 * And they cap what one tool call puts into the conversation (`tool_output`). OpenCode's
 * own cap is 2,000 lines or 50 KB, about 15k tokens, and whatever goes in is sent again
 * with every later request. A walk-animation turn on Flash listed whole folders, printed
 * a 47 KB manifest and a 51 KB `git status`, grew from 26k to 197k tokens in three minutes
 * and spent 29 credits without generating anything (owner report, 2026-11-16). Past the
 * cap OpenCode keeps the full output in a file and tells the agent its path to search.
 */
export const OPENCODE_TOOL_OUTPUT_LIMITS = { max_lines: 400, max_bytes: 16 * 1024 } as const;

export function openCodeRunExtraConfig(
  agentId: string,
  providerConfig: Record<string, unknown> | null | undefined,
  readOnlyTurn: boolean,
  /** The project notes staged for this run (`stageOpenCodeProjectNotes`). */
  projectInstructions: readonly string[] = [],
): Record<string, unknown> | null {
  let config = usesBundledOpenCode(agentId)
    ? { ...withOpenCodeSkillsDenied(providerConfig ?? {}), snapshot: false, tool_output: { ...OPENCODE_TOOL_OUTPUT_LIMITS } }
    : providerConfig ?? null;
  if (projectInstructions.length > 0) config = withOpenCodeInstructions(config ?? {}, projectInstructions);
  return readOnlyTurn ? readOnlyTurnOpenCodeConfig(config ?? {}) : config;
}

function withOpenCodeInstructions(config: Record<string, unknown>, files: readonly string[]): Record<string, unknown> {
  const existing = Array.isArray(config.instructions) ? config.instructions : [];
  return { ...config, instructions: [...new Set([...existing, ...files])] };
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
