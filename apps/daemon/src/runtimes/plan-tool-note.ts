import { usesBundledOpenCode } from './byok-opencode.js';

const CLAUDE_PLAN_TOOL_NOTE = `Your plan tool is \`TodoWrite\`, or \`TaskCreate\` plus \`TaskUpdate\` on builds that ship those instead — use whichever your session actually exposes for the plan step above; the host renders either as the same live Todos card. Mark each item \`in_progress\` when started and \`completed\` as it lands.`;

const CODEX_PLAN_TOOL_NOTE = `Your plan tool is \`update_plan\` — use it for the plan step above; the host renders it as a live Todos card. Mark each item \`in_progress\` when started and \`completed\` as it lands.`;

const OPENCODE_PLAN_TOOL_NOTE = `Your plan tool is \`todowrite\` — use it for the plan step above; the host renders it as a live Todos card. Mark each item \`in_progress\` when started and \`completed\` as it lands.`;

export function planToolNoteForRuntime(
  agentId: string | null | undefined,
  streamFormat: string | undefined,
): string | null {
  // Claude Code exposes the stream-json plan tools.
  if (streamFormat === 'claude-stream-json') return CLAUDE_PLAN_TOOL_NOTE;
  if (agentId === 'codex') return CODEX_PLAN_TOOL_NOTE;
  if (agentId === 'opencode' || usesBundledOpenCode(agentId)) {
    return OPENCODE_PLAN_TOOL_NOTE;
  }
  return null;
}
