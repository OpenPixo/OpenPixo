import fs from 'node:fs';
import path from 'node:path';
import type { McpServerConfig } from '@openpixo/contracts';
import {
  buildClaudeMcpJson,
  buildOpenCodeMcpConfigContent,
  type OpenCodeConfigBuildOptions,
} from '../mcp-config.js';
import { agentCapabilities } from './capabilities.js';
import { CLAUDE_APPROVAL_TIMEOUT_MS } from './claude-approvals.js';

export interface RuntimeExtensionInput {
  runId: string;
  /** Run-scoped scratch dir under the daemon data root (never the game folder). */
  runScratchDir: string;
  projectMcpServers: McpServerConfig[];
  globalMcpServers: McpServerConfig[];
  projectSkills: Array<{ id: string; dir: string; body: string }>;
  globalMcpTokens?: Record<string, string>;
  openCodeConfig?: OpenCodeConfigBuildOptions;
  codexProviderKey?: string;
  claudeApprovalServer?: { command: string; args: string[]; env: Record<string, string> };
}

export interface RuntimeExtensionPlan {
  args: string[];
  env: Record<string, string>;
  /** Written with owner-only permissions before spawn, removed when the run ends. */
  files: Array<{ path: string; content: string }>;
  /** Codex-only: native thread RPC config. */
  rpcConfig?: unknown;
  /** Exact strings to redact from run output. */
  secrets: string[];
  /** Cells this plan could not satisfy, surfaced as run warnings. */
  unsupported: Array<'project-mcp' | 'global-mcp' | 'skill-files'>;
}

export interface RuntimeExtensionInjector {
  readonly id: 'codex-rpc' | 'claude-mcp-config' | 'opencode-config-content';
  plan(input: RuntimeExtensionInput): RuntimeExtensionPlan;
}

export type CodexProjectMcpServer = {
  enabled: true;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  http_headers?: Record<string, string>;
};

export type CodexProjectMcpConfig = { mcp_servers?: Record<string, CodexProjectMcpServer> };

/** Native thread RPC configuration; credentials must never be serialized to argv. */
export function codexProjectMcpConfig(servers: readonly McpServerConfig[] = []): CodexProjectMcpConfig {
  const configured: Record<string, CodexProjectMcpServer> = {};
  for (const server of servers) {
    if (!server.enabled) continue;
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(server.id)) throw new Error('Invalid project MCP server id');
    let value: CodexProjectMcpServer;
    if (server.transport === 'stdio' && server.command?.trim()) {
      value = { enabled: true, command: server.command,
        ...(server.args ? { args: [...server.args] } : {}),
        ...(server.env ? { env: { ...server.env } } : {}),
      };
    } else if (server.transport === 'http' && server.url) {
      value = { enabled: true, url: server.url,
        ...(server.headers ? { http_headers: { ...server.headers } } : {}),
      };
    } else {
      throw new Error(`Project MCP ${server.id}: Codex requires a stdio command or streamable HTTP URL`);
    }
    configured[`openpixo_${server.id}`] = value;
  }
  return Object.keys(configured).length ? { mcp_servers: configured } : {};
}

export function codexOutputSecrets(servers: readonly McpServerConfig[], providerKey?: string): string[] {
  const sensitiveName = /key|token|secret|password|credential|authorization/iu;
  const values = [providerKey, ...servers.flatMap((server) => [
    ...Object.entries(server.env ?? {}).filter(([name]) => sensitiveName.test(name)).map(([, value]) => value),
    ...Object.entries(server.headers ?? {}).filter(([name]) => !/^(?:accept|content-type|user-agent|host)$/iu.test(name)).map(([, value]) => value),
  ])].filter((value): value is string => typeof value === 'string' && value.length > 0);
  return [...new Set(values.flatMap((value) => {
    const token = /^(?:Bearer|Basic)\s+(.+)$/iu.exec(value)?.[1];
    return token ? [value, token] : [value];
  }))];
}

function resolvedGlobalMcpServers(input: RuntimeExtensionInput): McpServerConfig[] {
  // Resolve global OAuth before merging so a project server with the same id
  // cannot receive a token issued for a different endpoint.
  const globalConfig = buildClaudeMcpJson(input.globalMcpServers, input.globalMcpTokens) as {
    mcpServers: Record<string, { headers?: Record<string, string> }>;
  } | null;
  return input.globalMcpServers.map((server) => ({
    ...server,
    ...(globalConfig?.mcpServers[server.id]?.headers
      ? { headers: globalConfig.mcpServers[server.id]!.headers }
      : {}),
  }));
}

export const runtimeExtensionInjectors: Record<RuntimeExtensionInjector['id'], RuntimeExtensionInjector> = {
  'codex-rpc': {
    id: 'codex-rpc',
    plan(input) {
      const globalServers = resolvedGlobalMcpServers(input);
      const unsupportedGlobal = input.globalMcpServers.some((server) => server.enabled && server.transport === 'sse');
      return {
        args: [], env: {}, files: [],
        rpcConfig: codexProjectMcpConfig([
          ...globalServers.filter((server) => server.transport !== 'sse'),
          ...input.projectMcpServers,
        ]),
        secrets: codexOutputSecrets([...globalServers, ...input.projectMcpServers], input.codexProviderKey),
        unsupported: unsupportedGlobal ? ['global-mcp'] : [],
      };
    },
  },
  'claude-mcp-config': {
    id: 'claude-mcp-config',
    plan(input) {
      const servers = [...resolvedGlobalMcpServers(input), ...input.projectMcpServers];
      const plan: RuntimeExtensionPlan = {
        args: [], env: {}, files: [], secrets: codexOutputSecrets(servers), unsupported: [],
      };
      const caps = agentCapabilities.get('claude') ?? {};
      const skillDirs = [...new Set(input.projectSkills.map((skill) => skill.dir).filter(Boolean))];
      if (skillDirs.length > 0) {
        if (caps.addDir === false) plan.unsupported.push('skill-files');
        else plan.args.push('--add-dir', ...skillDirs);
      }
      if (!caps.mcpConfig) {
        plan.unsupported.push('project-mcp', 'global-mcp');
        return plan;
      }
      let config = buildClaudeMcpJson(servers) as { mcpServers: Record<string, unknown> } | null;
      if (input.claudeApprovalServer && caps.permissionPromptTool) {
        config ??= { mcpServers: {} };
        config.mcpServers.openpixo_approvals = { type: 'stdio', ...input.claudeApprovalServer };
        // Claude Code times out MCP tool calls on its own clock; outlast the daemon's approval window.
        plan.env.MCP_TOOL_TIMEOUT = String(CLAUDE_APPROVAL_TIMEOUT_MS + 60_000);
        plan.secrets.push(...codexOutputSecrets([{ id: 'openpixo_approvals', enabled: true, transport: 'stdio', ...input.claudeApprovalServer }]));
      }
      if (config) {
        const filePath = path.join(input.runScratchDir, 'mcp.json');
        plan.files.push({ path: filePath, content: JSON.stringify(config, null, 2) });
        plan.args.push('--mcp-config', filePath);
      }
      return plan;
    },
  },
  'opencode-config-content': {
    id: 'opencode-config-content',
    plan(input) {
      const servers = [...resolvedGlobalMcpServers(input), ...input.projectMcpServers];
      const content = buildOpenCodeMcpConfigContent(servers, {}, input.openCodeConfig);
      return {
        args: [], env: content ? { OPENCODE_CONFIG_CONTENT: content } : {}, files: [],
        secrets: codexOutputSecrets(servers), unsupported: [],
      };
    },
  },
};

export function writeRuntimeExtensionFiles(plan: RuntimeExtensionPlan, runScratchDir: string): void {
  for (const file of plan.files) {
    const relative = path.relative(path.resolve(runScratchDir), path.resolve(file.path));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Runtime extension files must stay inside the run scratch directory');
    }
    fs.mkdirSync(path.dirname(file.path), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file.path, file.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
}

export function cleanupRuntimeExtensionFiles(runScratchDir: string): void {
  try {
    fs.rmSync(runScratchDir, { recursive: true, force: true });
  } catch {
    console.warn('[runtime-extensions] failed to remove run scratch files');
  }
}
