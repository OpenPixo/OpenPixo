import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../src/runtimes/capabilities.js';
import { claudeAgentDef } from '../../src/runtimes/defs/claude.js';
import { runtimeExtensionInjectors } from '../../src/runtimes/extension-injection.js';

const original = agentCapabilities.get('claude');
afterEach(() => {
  if (original) agentCapabilities.set('claude', original);
  else agentCapabilities.delete('claude');
});

describe('Claude effort', () => {
  it('passes the chosen effort only to a build that lists the flag', () => {
    expect(claudeAgentDef.capabilityFlags['--effort']).toBe('effort');
    agentCapabilities.set('claude', { effort: true });
    expect(claudeAgentDef.buildArgs('', [], [], { reasoning: 'max' }, {})).toEqual(expect.arrayContaining(['--effort', 'max']));
    expect(claudeAgentDef.buildArgs('', [], [], { reasoning: 'default' }, {})).not.toContain('--effort');
    agentCapabilities.set('claude', {});
    expect(claudeAgentDef.buildArgs('', [], [], { reasoning: 'max' }, {})).not.toContain('--effort');
  });
});

describe('Claude approval launch', () => {
  it('uses the permission prompt tool when both help-probed flags are supported', () => {
    expect(claudeAgentDef.capabilityFlags['--permission-prompt-tool']).toBe('permissionPromptTool');
    agentCapabilities.set('claude', { mcpConfig: true, permissionPromptTool: true });
    const args = claudeAgentDef.buildArgs('', [], [], {}, { approvalMode: 'in-app' });
    expect(args.slice(-4)).toEqual(['--permission-mode', 'default', '--permission-prompt-tool', 'mcp__openpixo_approvals__request']);
    expect(args).not.toContain('bypassPermissions');
  });

  it.each([
    { caps: { mcpConfig: true, permissionPromptTool: false }, mode: 'in-app' as const },
    { caps: { mcpConfig: false, permissionPromptTool: true }, mode: 'in-app' as const },
    { caps: {}, mode: 'in-app' as const },
    { caps: { mcpConfig: true, permissionPromptTool: true }, mode: 'skip' as const },
  ])('retains bypassPermissions for unsupported flags or an explicit skip ($mode, $caps)', ({ caps, mode }) => {
    agentCapabilities.set('claude', caps);
    const args = claudeAgentDef.buildArgs('', [], [], {}, { approvalMode: mode });
    expect(args.slice(-2)).toEqual(['--permission-mode', 'bypassPermissions']);
    expect(args).not.toContain('--permission-prompt-tool');
  });

  it('injects the approval server even without user MCP servers and keeps the token out of argv', () => {
    agentCapabilities.set('claude', { mcpConfig: true, permissionPromptTool: true });
    const server = { command: 'node', args: [`${PRODUCT_CLI_NAME}.mjs`, 'mcp', 'approvals'], env: { PIXO_DAEMON_URL: 'http://127.0.0.1:1234', PIXO_TOOL_TOKEN: 'pixott_test-secret', ELECTRON_RUN_AS_NODE: '1' } };
    const plan = runtimeExtensionInjectors['claude-mcp-config'].plan({
      runId: 'run-1', runScratchDir: 'daemon-run-scratch', projectMcpServers: [], globalMcpServers: [], projectSkills: [], claudeApprovalServer: server,
    });
    expect(plan.files).toHaveLength(1);
    expect(JSON.parse(plan.files[0]!.content)).toEqual({ mcpServers: { openpixo_approvals: { type: 'stdio', ...server } } });
    expect(plan.args).toEqual(['--mcp-config', plan.files[0]!.path]);
    expect(plan.args.join(' ')).not.toContain('pixott_test-secret');
    expect(plan.secrets).toContain('pixott_test-secret');
  });
});
