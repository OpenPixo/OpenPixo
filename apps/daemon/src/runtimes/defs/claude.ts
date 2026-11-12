import { agentCapabilities } from '../capabilities.js';
import { DEFAULT_MODEL_OPTION } from './shared.js';
import { loadMmdRouteModels } from '../mmd-routes.js';
import { READ_ONLY_TURN_CLAUDE_DISALLOWED_TOOLS } from '../read-only-turn.js';
import type { RuntimeAgentDef } from '../types.js';

const CLAUDE_FALLBACK_MODELS = [
  DEFAULT_MODEL_OPTION,
  { id: 'sonnet', label: 'Sonnet (alias)' },
  { id: 'opus', label: 'Opus (alias)' },
  { id: 'haiku', label: 'Haiku (alias)' },
  { id: 'fable', label: 'Fable (alias)' },
  { id: 'claude-opus-5', label: 'claude-opus-5' },
  { id: 'claude-sonnet-5', label: 'claude-sonnet-5' },
  { id: 'claude-fable-5', label: 'claude-fable-5' },
  { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
  { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
  { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
];

export const claudeAgentDef = {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    // Drop-in forks that ship a CLI argv-compatible with `claude`. Tried in
    // order if `claude` itself isn't on PATH, so users on a single-binary
    // install (e.g. only OpenClaude — https://github.com/Gitlawb/openclaude
    // — issue #235) get auto-detected without writing wrapper scripts.
    fallbackBins: ['openclaude'],
    versionArgs: ['--version'],
    authProbe: {
      args: ['auth', 'status'],
      timeoutMs: 5000,
    },
    helpArgs: ['-p', '--help'],
    capabilityFlags: {
      // Flag string -> capability key. After probing `--help`, we set
      // `agentCapabilities[id][key] = true` for each substring that matches.
      // `--add-dir` and `--include-partial-messages` live under `claude -p`
      // subcommand, so we probe `claude -p --help` instead of `claude --help`.
      // Fixes issue #430: --add-dir never detected because it wasn't in global help.
      '--include-partial-messages': 'partialMessages',
      '--forward-subagent-text': 'forwardSubagentText',
      '--agents': 'customAgents',
      '--add-dir': 'addDir',
      '--mcp-config': 'mcpConfig',
      '--permission-prompt-tool': 'permissionPromptTool',
      '--effort': 'effort',
    },
    // `--thinking-display` is a real option but it is hidden from both
    // `claude --help` and `claude -p --help`, so the capabilityFlags scan
    // above cannot detect it. Probe it by value-rejection instead.
    hiddenCapabilityFlags: {
      probeArgsPrefix: ['-p'],
      flags: {
        '--thinking-display': 'thinkingDisplay',
      },
    },
    // `claude` has no list-models subcommand. Prefer local mmd/MMS routes
    // when present so proxy-backed Claude-compatible models appear in the
    // picker, then keep the built-in aliases as fallback hints.
    fallbackModels: CLAUDE_FALLBACK_MODELS,
    fetchModels: async (_resolvedBin, env) => loadMmdRouteModels(env, CLAUDE_FALLBACK_MODELS),
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'XHigh' },
      { id: 'max', label: 'Max' },
    ],
    // Prompt delivered via stdin to avoid both Linux `spawn E2BIG`
    // (MAX_ARG_STRLEN caps a single argv entry at ~128 KB) and Windows
    // `spawn ENAMETOOLONG` (CreateProcess caps the full command line at
    // ~32 KB direct, ~8 KB via .cmd shim). `claude -p` with no positional
    // prompt reads the prompt from stdin under `--input-format text` (the
    // default), which has no length cap. Codex and OpenCode use stdin too.
    buildArgs: (_prompt, _imagePaths, extraAllowedDirs = [], options = {}, runtimeContext = {}) => {
      const caps = agentCapabilities.get('claude') || {};
      // `--input-format stream-json` lets the daemon stream multiple JSONL
      // messages into stdin instead of closing it after the initial prompt,
      // keeping the turn open so the daemon can stream further user messages
      // mid-conversation. Paired with `--output-format stream-json` so the
      // adapter parses structured events (see claude-stream.ts).
      const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
      // `--include-partial-messages` lands richer streaming events but only
      // exists in newer Claude Code builds. Older installs reject it with
      // "unknown option" and exit 1, killing the chat. Gate on the probe.
      if (caps.partialMessages) {
        args.push('--include-partial-messages');
      }
      // Extended-thinking text is withheld unless the request carries a
      // thinking `display` mode. Claude Code only resolves one for an
      // interactive TUI (via the `showThinkingSummaries` setting) or when
      // `--thinking-display` is passed explicitly; a headless
      // `-p --output-format stream-json` session resolves it to `undefined`,
      // keeps the `redact-thinking` beta on the API request, and every
      // `thinking_delta` arrives with `thinking: ""`. Asking for `summarized`
      // is what makes the model's reasoning observable at all.
      if (caps.thinkingDisplay) {
        args.push('--thinking-display', 'summarized');
      }
      if (runtimeContext.observeNativeChildBehavior === true && caps.forwardSubagentText) {
        args.push('--forward-subagent-text');
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      // Older and forked builds reject an unknown flag, so only a build that lists it gets it.
      if (caps.effort && options.reasoning && options.reasoning !== 'default') {
        args.push('--effort', options.reasoning);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && d.length > 0,
      );
      // `--add-dir` is older but still gate it for symmetry — old/forked
      // builds may lack it.
      if (dirs.length > 0 && caps.addDir !== false) {
        args.push('--add-dir', ...dirs);
      }
      // Continue Claude's own CLI session across turns so it keeps its
      // working memory (files read, edits made, tool history) instead of
      // re-deriving everything from the rendered transcript each turn.
      // `--resume <id>` continues a stored session; `--session-id <uuid>`
      // starts a new one with an id the daemon controls and persists.
      if (typeof runtimeContext.resumeSessionId === 'string' && runtimeContext.resumeSessionId) {
        args.push('--resume', runtimeContext.resumeSessionId);
      } else if (typeof runtimeContext.newSessionId === 'string' && runtimeContext.newSessionId) {
        args.push('--session-id', runtimeContext.newSessionId);
      }
      // Not `--permission-mode plan`: that mode has its own plan-file and
      // ExitPlanMode flow, and the plan here is written in chat. Without the
      // prompt tool, default mode refuses what it would have had to ask about.
      if (runtimeContext.readOnlyTurn) {
        args.push('--disallowedTools', READ_ONLY_TURN_CLAUDE_DISALLOWED_TOOLS.join(','));
      }
      if (runtimeContext.approvalMode !== 'skip' && caps.permissionPromptTool && caps.mcpConfig) {
        args.push('--permission-mode', 'default', '--permission-prompt-tool', 'mcp__openpixo_approvals__request');
      } else {
        args.push('--permission-mode', runtimeContext.readOnlyTurn ? 'default' : 'bypassPermissions');
      }
      return args;
    },
    promptViaStdin: true,
    promptInputFormat: 'stream-json',
    streamFormat: 'claude-stream-json',
    extensionInjector: 'claude-mcp-config',
    externalMcpInjection: 'claude-mcp-json',
    resumesSessionViaCli: true,
} satisfies RuntimeAgentDef;
