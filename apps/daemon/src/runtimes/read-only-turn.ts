import type { ClaudeApprovalInput, ClaudeApprovalResult } from '@openpixo/contracts';

/**
 * A read-only turn (Plan mode, and every turn of a new game before its plan is
 * approved) must not change the project, whatever the model decides. Each
 * runtime gets the strongest thing it offers: Codex a read-only sandbox, Claude
 * Code no edit tools plus a host decision on each shell command, OpenCode
 * deny rules in its permission config. The one thing still allowed is the host
 * CLI, which reaches the daemon; the daemon applies its own gate to that.
 */

export const READ_ONLY_TURN_MESSAGE = 'OpenPixo keeps this project read-only until the user approves the plan. Do not try another way to make this change. Finish the conversation or the plan, and ask the user to approve it.';

export const READ_ONLY_TURN_CLAUDE_DISALLOWED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const;

/** What an agent's tool token may do on a read-only turn: read, and make concept art. */
export const READ_ONLY_TURN_TOOL_OPERATIONS = [
  'approvals:request', 'project:next-steps:read', 'game:tuning:read', 'checkpoint:read',
  'style:read', 'style:write', 'asset:read', 'media:generate', 'deliverable-syntax:check',
] as const;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
// The host CLI subcommands that read or make concept art. Nothing that scaffolds.
const HOST_CLI = /^(?:"?\$\{?PIXO_NODE_BIN\}?"?\s+"?\$\{?PIXO_BIN\}?"?|&\s*\$env:PIXO_NODE_BIN\s+\$env:PIXO_BIN|pixo)\s+(?:media\s+generate|media\s+wait|style\s+(?:list|info|set|get|reference)|recipe\s+(?:list|show)|project\s+game-setup)\b/;
// Outside quotes these would chain a second command or write a file.
const SHELL_CONTROL = /[;&|<>`\n]|\$\(/;

function withoutQuotedText(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

function isHostCliCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!HOST_CLI.test(trimmed)) return false;
  // The leading form may itself contain `&`; judge only what follows it.
  const rest = withoutQuotedText(trimmed.replace(/^&\s*/, ''));
  return !SHELL_CONTROL.test(rest);
}

/**
 * What the host answers Claude Code's permission tool during a read-only turn,
 * or null when the request goes on to the user as usual. Claude Code itself
 * allows read-only commands without asking, so a shell command that reaches
 * this point is one it could not call safe.
 */
export function readOnlyTurnClaudeDecision(payload: ClaudeApprovalInput): ClaudeApprovalResult | null {
  const tool = payload.tool_name;
  if ((READ_ONLY_TURN_CLAUDE_DISALLOWED_TOOLS as readonly string[]).includes(tool)) {
    return { behavior: 'deny', message: READ_ONLY_TURN_MESSAGE };
  }
  if (!SHELL_TOOLS.has(tool)) return null;
  const command = typeof payload.input.command === 'string' ? payload.input.command : '';
  return isHostCliCommand(command)
    ? { behavior: 'allow', updatedInput: payload.input }
    : { behavior: 'deny', message: READ_ONLY_TURN_MESSAGE };
}

/**
 * OpenCode config for a read-only turn, merged over the run's provider config.
 * Later rules win in OpenCode's wildcard table, so the catch-all deny comes first.
 */
export function readOnlyTurnOpenCodeConfig(extraConfig: Record<string, unknown> = {}): Record<string, unknown> {
  const existing = extraConfig.permission && typeof extraConfig.permission === 'object' && !Array.isArray(extraConfig.permission)
    ? extraConfig.permission as Record<string, unknown>
    : {};
  return {
    ...extraConfig,
    permission: {
      ...existing,
      edit: 'deny',
      bash: {
        '*': 'deny',
        '*PIXO_BIN*': 'allow',
        'pixo *': 'allow',
        'ls*': 'allow',
        'dir*': 'allow',
        'cat *': 'allow',
        'type *': 'allow',
        'git status*': 'allow',
        'git log*': 'allow',
      },
    },
  };
}
