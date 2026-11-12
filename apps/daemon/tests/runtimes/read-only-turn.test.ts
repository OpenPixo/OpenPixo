import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../src/runtimes/capabilities.js';
import { claudeAgentDef } from '../../src/runtimes/defs/claude.js';
import { codexAgentDef, codexResolvedSandboxMode } from '../../src/runtimes/defs/codex.js';
import { CHAT_TOOL_OPERATIONS } from '../../src/tool-tokens.js';
import {
  READ_ONLY_TURN_CLAUDE_DISALLOWED_TOOLS,
  READ_ONLY_TURN_TOOL_OPERATIONS,
  readOnlyTurnClaudeDecision,
  readOnlyTurnOpenCodeConfig,
} from '../../src/runtimes/read-only-turn.js';
import { buildOpenCodeMcpConfigContent } from '../../src/mcp-config.js';

const originalClaude = agentCapabilities.get('claude');
const originalSandbox = process.env.PIXO_CODEX_SANDBOX;
afterEach(() => {
  if (originalClaude) agentCapabilities.set('claude', originalClaude);
  else agentCapabilities.delete('claude');
  if (originalSandbox === undefined) delete process.env.PIXO_CODEX_SANDBOX;
  else process.env.PIXO_CODEX_SANDBOX = originalSandbox;
});

describe('Codex on a read-only turn', () => {
  it('asks for the read-only sandbox on a new thread', () => {
    const args = codexAgentDef.buildArgs('', [], [], {}, { readOnlyTurn: true });
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args.join(' ')).not.toContain('workspace-write');
  });

  it('asks for it on a resumed thread, where --sandbox is rejected', () => {
    const args = codexAgentDef.buildArgs('', [], [], {}, { readOnlyTurn: true, resumeSessionId: 'thread-1' });
    expect(args).not.toContain('--sandbox');
    expect(args).toContain('sandbox_mode="read-only"');
  });

  it('keeps workspace-write on an ordinary turn', () => {
    const args = codexAgentDef.buildArgs('', [], [], {}, {});
    expect(args[args.indexOf('--sandbox') + 1]).toBe('workspace-write');
  });

  it('resolves the app-server sandbox the same way, and an operator override still wins', () => {
    delete process.env.PIXO_CODEX_SANDBOX;
    expect(codexResolvedSandboxMode({ readOnlyTurn: true })).toBe('read-only');
    expect(codexResolvedSandboxMode()).toBe('workspace-write');
    process.env.PIXO_CODEX_SANDBOX = 'danger-full-access';
    expect(codexResolvedSandboxMode({ readOnlyTurn: true })).toBe('danger-full-access');
  });
});

describe('Claude Code on a read-only turn', () => {
  it('removes the edit tools and keeps the host deciding through the approval tool', () => {
    agentCapabilities.set('claude', { mcpConfig: true, permissionPromptTool: true });
    const args = claudeAgentDef.buildArgs('', [], [], {}, { approvalMode: 'in-app', readOnlyTurn: true });
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe(READ_ONLY_TURN_CLAUDE_DISALLOWED_TOOLS.join(','));
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) expect(READ_ONLY_TURN_CLAUDE_DISALLOWED_TOOLS).toContain(tool);
    expect(args).toContain('--permission-prompt-tool');
    expect(args).not.toContain('bypassPermissions');
  });

  it('never bypasses permissions, even when approvals are skipped or unsupported', () => {
    agentCapabilities.set('claude', {});
    const args = claudeAgentDef.buildArgs('', [], [], {}, { approvalMode: 'skip', readOnlyTurn: true });
    expect(args.slice(-2)).toEqual(['--permission-mode', 'default']);
  });

  it('leaves an ordinary turn alone', () => {
    agentCapabilities.set('claude', {});
    const args = claudeAgentDef.buildArgs('', [], [], {}, { approvalMode: 'skip' });
    expect(args).not.toContain('--disallowedTools');
    expect(args.slice(-2)).toEqual(['--permission-mode', 'bypassPermissions']);
  });

  const decide = (tool_name: string, input: Record<string, unknown>) => readOnlyTurnClaudeDecision({ tool_name, input });

  it('denies edit tools and shell commands with a reason the model can act on', () => {
    for (const [tool, input] of [
      ['Write', { file_path: 'a.js', content: '' }],
      ['Bash', { command: 'npm create vite@latest' }],
      ['Bash', { command: 'mkdir src' }],
      ['PowerShell', { command: 'New-Item a.txt' }],
    ] as const) {
      const decision = decide(tool, input as Record<string, unknown>);
      expect(decision?.behavior, tool).toBe('deny');
      expect(decision && 'message' in decision ? decision.message : '').toMatch(/plan/i);
    }
  });

  it('allows the host CLI, and nothing chained onto it', () => {
    for (const command of [
      '"$PIXO_NODE_BIN" "$PIXO_BIN" media generate --surface image --prompt fox',
      '& $env:PIXO_NODE_BIN $env:PIXO_BIN style list --json',
      'pixo media generate --style pixel-16-bit --prompt "fox, side view"',
    ]) {
      expect(decide('Bash', { command }), command).toMatchObject({ behavior: 'allow', updatedInput: { command } });
    }
    for (const command of [
      '"$PIXO_NODE_BIN" "$PIXO_BIN" media generate --prompt x; rm -rf .',
      'pixo style list && mkdir src',
      'pixo style list > styles.txt',
      'pixo game scaffold --template phaser3-vite',
    ]) {
      expect(decide('Bash', { command })?.behavior, command).toBe('deny');
    }
  });

  it('leaves other tools to the normal approval the user sees', () => {
    expect(decide('WebSearch', { query: 'x' })).toBeNull();
    expect(decide('mcp__server__tool', {})).toBeNull();
  });
});

describe('the tool token on a read-only turn', () => {
  it('can read and make concept art, and nothing else that changes the project', () => {
    for (const operation of ['asset:edit', 'asset:grid', 'asset:tag', 'checkpoint:write', 'game:scaffold', 'game:tuning:write', 'media:scaffold']) {
      expect(READ_ONLY_TURN_TOOL_OPERATIONS).not.toContain(operation);
    }
    expect(READ_ONLY_TURN_TOOL_OPERATIONS).toContain('media:generate');
    expect(READ_ONLY_TURN_TOOL_OPERATIONS).toContain('approvals:request');
    for (const operation of READ_ONLY_TURN_TOOL_OPERATIONS) expect(CHAT_TOOL_OPERATIONS).toContain(operation);
  });
});

describe('OpenCode on a read-only turn', () => {
  it('denies edits and all shell commands except the host CLI and read-only probes', () => {
    const permission = readOnlyTurnOpenCodeConfig().permission as Record<string, unknown>;
    expect(permission.edit).toBe('deny');
    const bash = permission.bash as Record<string, string>;
    expect(Object.entries(bash)[0]).toEqual(['*', 'deny']);
    expect(bash['*PIXO_BIN*']).toBe('allow');
  });

  it('merges with provider config and keeps the run\'s directory grants', () => {
    const merged = readOnlyTurnOpenCodeConfig({ provider: { x: {} }, permission: { webfetch: 'allow' } });
    expect(merged.provider).toEqual({ x: {} });
    expect((merged.permission as Record<string, unknown>).webfetch).toBe('allow');
    const content = JSON.parse(buildOpenCodeMcpConfigContent([], {}, { allowedDirectories: ['/game'], extraConfig: merged })!);
    expect(content.permission.edit).toBe('deny');
    expect(content.permission.external_directory).toBeDefined();
  });
});
