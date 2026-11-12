import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../src/runtimes/capabilities.js';
import { codexOutputSecrets } from '../src/runtimes/codex-output.js';
import { claudeAgentDef } from '../src/runtimes/defs/claude.js';
import { opencodeAgentDef } from '../src/runtimes/defs/opencode.js';
import { byokOpenCodeAgentDef } from '../src/runtimes/defs/byok-opencode.js';
import { validateRunToolBundleForAgent } from '../src/run-tool-bundle.js';
import {
  cleanupRuntimeExtensionFiles,
  codexProjectMcpConfig,
  runtimeExtensionInjectors,
  writeRuntimeExtensionFiles,
  type RuntimeExtensionInput,
} from '../src/runtimes/extension-injection.js';
import { cleanupRuntimeExtensionsAfterDaemonRestart } from '../src/runtimes/run-restart-recovery.js';

const temporaryDirs: string[] = [];
const originalClaudeCapabilities = agentCapabilities.get('claude');

function input(overrides: Partial<RuntimeExtensionInput> = {}): RuntimeExtensionInput {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixo-extension-injection-'));
  temporaryDirs.push(dataDir);
  return {
    runId: 'run-1',
    runScratchDir: path.join(dataDir, 'runs', 'run-1', 'extensions', 'attempt-1'),
    projectMcpServers: [],
    globalMcpServers: [],
    projectSkills: [],
    ...overrides,
  };
}

afterEach(() => {
  if (originalClaudeCapabilities) agentCapabilities.set('claude', originalClaudeCapabilities);
  else agentCapabilities.delete('claude');
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('runtime extension injection', () => {
  it('keeps Codex project RPC configuration and redaction byte-identical to the old exports', () => {
    const value = input({
      projectMcpServers: [
        { id: 'assets', enabled: true, transport: 'stdio', command: 'node', args: ['assets.ts'], env: { GAME_TOKEN: 'stdio-secret', DEBUG: '1' } },
        { id: 'remote', enabled: true, transport: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer project-secret' } },
      ],
      codexProviderKey: 'provider-secret',
    });
    const plan = runtimeExtensionInjectors['codex-rpc'].plan(value);
    expect(JSON.stringify(plan.rpcConfig)).toBe(JSON.stringify(codexProjectMcpConfig(value.projectMcpServers)));
    expect(plan.secrets).toEqual(codexOutputSecrets(value.projectMcpServers, value.codexProviderKey));
    expect(plan.args).toEqual([]);
    expect(plan.env).toEqual({});
    expect(plan.files).toEqual([]);
    expect(plan.unsupported).toEqual([]);
  });

  it('gives Claude global and project MCP through a private run file, with skill directories on argv', () => {
    agentCapabilities.set('claude', { mcpConfig: true, addDir: true });
    const value = input({
      globalMcpServers: [{ id: 'global', enabled: true, authMode: 'oauth', transport: 'http', url: 'https://example.test/global' }],
      globalMcpTokens: { global: 'global-oauth-token' },
      projectMcpServers: [{ id: 'project', enabled: true, transport: 'http', url: 'https://example.test/project', headers: { Authorization: 'Bearer project-token' } }],
      projectSkills: [{ id: 'skill', dir: path.join(os.tmpdir(), 'project-skill'), body: 'Skill instructions' }],
    });
    const plan = runtimeExtensionInjectors['claude-mcp-config'].plan(value);
    const configPath = plan.args[plan.args.indexOf('--mcp-config') + 1]!;
    expect(path.dirname(configPath)).toBe(value.runScratchDir);
    expect(plan.args).toEqual(['--add-dir', value.projectSkills[0]!.dir, '--mcp-config', configPath]);
    expect(plan.args.join(' ')).not.toMatch(/global-oauth-token|project-token|--strict-mcp-config/u);
    expect(plan.secrets).toEqual(expect.arrayContaining(['global-oauth-token', 'project-token', 'Bearer project-token']));
    writeRuntimeExtensionFiles(plan, value.runScratchDir);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({ mcpServers: {
      global: { type: 'http', url: 'https://example.test/global', headers: { Authorization: 'Bearer global-oauth-token' } },
      project: { type: 'http', url: 'https://example.test/project', headers: { Authorization: 'Bearer project-token' } },
    } });
    if (process.platform !== 'win32') expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('passes global OAuth MCP through Codex RPC and reports unsupported global SSE', () => {
    const value = input({
      globalMcpServers: [
        { id: 'global', enabled: true, authMode: 'oauth', transport: 'http', url: 'https://example.test/mcp' },
        { id: 'legacy', enabled: true, transport: 'sse', url: 'https://example.test/sse' },
      ],
      globalMcpTokens: { global: 'global-token' },
    });
    const plan = runtimeExtensionInjectors['codex-rpc'].plan(value);
    expect(plan.rpcConfig).toEqual(codexProjectMcpConfig([
      { ...value.globalMcpServers[0]!, headers: { Authorization: 'Bearer global-token' } },
    ]));
    expect(plan.secrets).toEqual(['Bearer global-token', 'global-token']);
    expect(plan.args).toEqual([]);
    expect(plan.unsupported).toEqual(['global-mcp']);
  });

  it('reports unsupported MCP cells without creating a Claude config when the flag is absent', () => {
    agentCapabilities.set('claude', { mcpConfig: false });
    const value = input({ projectMcpServers: [{ id: 'project', enabled: true, transport: 'stdio', command: 'node' }] });
    const plan = runtimeExtensionInjectors['claude-mcp-config'].plan(value);
    expect(plan.unsupported).toEqual(['project-mcp', 'global-mcp']);
    expect(plan.args).toEqual([]);
    expect(plan.files).toEqual([]);
    writeRuntimeExtensionFiles(plan, value.runScratchDir);
    expect(fs.existsSync(value.runScratchDir)).toBe(false);
  });

  it('never lends a global OAuth token to a different project server with the same id', () => {
    agentCapabilities.set('claude', { mcpConfig: true });
    const value = input({
      globalMcpServers: [{ id: 'shared', enabled: true, authMode: 'oauth', transport: 'http', url: 'https://global.test/mcp' }],
      globalMcpTokens: { shared: 'global-only-token' },
      projectMcpServers: [{ id: 'shared', enabled: true, authMode: 'oauth', transport: 'http', url: 'https://project.test/mcp' }],
    });
    const plan = runtimeExtensionInjectors['claude-mcp-config'].plan(value);
    expect(JSON.parse(plan.files[0]!.content)).toEqual({ mcpServers: {
      shared: { type: 'http', url: 'https://project.test/mcp' },
    } });
  });

  it('merges project MCP into OpenCode env content and retains directory and BYOK configuration', () => {
    const value = input({
      globalMcpServers: [{ id: 'global', enabled: true, authMode: 'oauth', transport: 'http', url: 'https://example.test/global' }],
      globalMcpTokens: { global: 'global-token' },
      projectMcpServers: [{ id: 'project', enabled: true, transport: 'stdio', command: 'node', args: ['project.ts'], env: { GAME_TOKEN: 'project-token' } }],
      openCodeConfig: { allowedDirectories: [os.tmpdir()], extraConfig: { provider: { byok: { name: 'BYOK' } } } },
    });
    const plan = runtimeExtensionInjectors['opencode-config-content'].plan(value);
    const config = JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT!);
    expect(config.mcp).toEqual({
      global: { type: 'remote', url: 'https://example.test/global', headers: { Authorization: 'Bearer global-token' }, enabled: true },
      project: { type: 'local', command: ['node', 'project.ts'], environment: { GAME_TOKEN: 'project-token' }, enabled: true },
    });
    expect(config.provider).toEqual({ byok: { name: 'BYOK' } });
    expect(config.permission.external_directory[path.resolve(os.tmpdir())]).toBe('allow');
    expect(plan.secrets).toEqual(expect.arrayContaining(['project-token', 'global-token']));
    expect(plan.args).toEqual([]);
    expect(plan.files).toEqual([]);
  });

  it('cleans scratch files per attempt and removes leftovers on restart without removing run records', () => {
    const value = input();
    const sibling = path.join(path.dirname(value.runScratchDir), 'attempt-2');
    const file = path.join(value.runScratchDir, 'mcp.json');
    const plan = { args: [], env: {}, secrets: [], unsupported: [], files: [{ path: file, content: '{}' }] };
    writeRuntimeExtensionFiles(plan, value.runScratchDir);
    writeRuntimeExtensionFiles({ ...plan, files: [{ path: path.join(sibling, 'mcp.json'), content: '{}' }] }, sibling);
    cleanupRuntimeExtensionFiles(value.runScratchDir);
    cleanupRuntimeExtensionFiles(value.runScratchDir);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(sibling, 'mcp.json'))).toBe(true);
    const runDir = path.dirname(path.dirname(value.runScratchDir));
    const state = path.join(runDir, 'state.json');
    fs.writeFileSync(state, '{}');
    cleanupRuntimeExtensionsAfterDaemonRestart(path.dirname(runDir));
    expect(fs.existsSync(path.dirname(sibling))).toBe(false);
    expect(fs.existsSync(state)).toBe(true);
  });

  it('accepts run-scoped MCP for imported projects using the new Claude and OpenCode delivery paths', () => {
    const bundle = { mcpServers: [{ id: 'remote', enabled: true, transport: 'http' as const, url: 'https://example.test/mcp' }] };
    expect(claudeAgentDef.capabilityFlags['--mcp-config']).toBe('mcpConfig');
    for (const agent of [claudeAgentDef, opencodeAgentDef, byokOpenCodeAgentDef]) {
      expect(validateRunToolBundleForAgent(bundle, agent, { deliveryTarget: 'external-project' })).toEqual({ ok: true });
    }
  });
});
