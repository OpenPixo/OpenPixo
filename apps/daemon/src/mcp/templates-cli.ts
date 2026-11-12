import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import type { McpServerConfig, McpServersResponse } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

const HELP = `Usage:
  ${PRODUCT_CLI_NAME} mcp templates [--category <category>] [--json]
  ${PRODUCT_CLI_NAME} mcp add --template <id> [--id <server-id>] [--env KEY=VALUE] [--header KEY=VALUE] [--json]

Both commands use /api/mcp/servers, the same endpoint as Settings > External MCP.
--env and --header can be repeated. --daemon-url <url> selects the daemon.
Adding a preset only saves configuration. Install its dependencies manually first.`;

function assignments(values: string[] = []): Record<string, string> {
  return Object.fromEntries(values.map((value) => {
    const equals = value.indexOf('=');
    if (equals <= 0) throw new Error('Expected KEY=VALUE for --env / --header');
    return [value.slice(0, equals), value.slice(equals + 1)];
  }));
}

/** CLI face of the existing MCP preset picker and config API; never starts a server. */
export async function runMcpTemplateCli(args: string[]): Promise<void> {
  try {
    const { values, positionals } = parseArgs({
      args, allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'daemon-url': { type: 'string' },
        category: { type: 'string' },
        template: { type: 'string' },
        id: { type: 'string' },
        env: { type: 'string', multiple: true },
        header: { type: 'string', multiple: true },
      },
    });
    if (values.help) { console.log(HELP); return; }
    const command = positionals[0];
    if (positionals.length !== 1 || (command !== 'templates' && command !== 'add')) throw new Error(HELP);
    if (command === 'add' && !values.template) throw new Error('--template is required');
    const env = assignments(values.env);
    const headers = assignments(values.header);
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const response = await fetch(`${base}/api/mcp/servers`);
    if (!response.ok) throw new Error(`MCP configuration request failed (HTTP ${response.status})`);
    const config = await response.json() as McpServersResponse;

    if (command === 'templates') {
      const templates = config.templates.filter((template) => !values.category || template.category === values.category);
      if (values.json) console.log(JSON.stringify({ templates }, null, 2));
      else for (const template of templates) console.log(`${template.id}\t${template.label}\t${template.category}\n${template.description}`);
      return;
    }

    const template = config.templates.find((entry) => entry.id === values.template);
    if (!template) throw new Error(`Unknown MCP template: ${values.template}`);
    const id = values.id ?? template.id;
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) throw new Error('Invalid MCP server id');
    if (config.servers.some((server) => server.id === id)) throw new Error(`MCP server already exists: ${id}`);
    for (const field of template.envFields ?? []) {
      if (field.required && !env[field.key]?.trim()) throw new Error(`--env ${field.key}=VALUE is required`);
    }
    for (const field of template.headerFields ?? []) {
      if (field.required && !headers[field.key]?.trim()) throw new Error(`--header ${field.key}=VALUE is required`);
    }
    const server: McpServerConfig = {
      id, templateId: template.id, label: template.label, transport: template.transport, enabled: true,
    };
    if (template.transport === 'stdio') {
      if (!template.command) throw new Error('MCP template has no command');
      server.command = template.command;
      if (template.args) server.args = template.args;
      server.env = env;
    } else {
      if (!template.url) throw new Error('MCP template has no URL');
      server.url = template.url;
      if (template.authMode) server.authMode = template.authMode;
      server.headers = headers;
    }
    const saved = await fetch(`${base}/api/mcp/servers`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ servers: [...config.servers, server] }),
    });
    if (!saved.ok) throw new Error(`MCP configuration save failed (HTTP ${saved.status})`);
    const result = await saved.json() as McpServersResponse;
    const added = result.servers.find((entry) => entry.id === id);
    if (!added) throw new Error('The daemon rejected the MCP server configuration');
    if (values.json) console.log(JSON.stringify({ server: added }, null, 2));
    else console.log(`Added ${id}. ${template.description}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
