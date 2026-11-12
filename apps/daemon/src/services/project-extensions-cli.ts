import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolveDaemonUrl } from '../daemon-url.js';

const USAGE = `Usage:
  ${PRODUCT_CLI_NAME} extensions list --project <id> [--json]
  ${PRODUCT_CLI_NAME} extensions add --project <id> --kind skill --source <local-folder|GitHub-URL>
  ${PRODUCT_CLI_NAME} extensions add --project <id> --kind skill --catalog <skill-id>
  ${PRODUCT_CLI_NAME} extensions add --project <id> --kind mcp --source <local-JSON|GitHub-JSON-URL>
  ${PRODUCT_CLI_NAME} extensions add --project <id> --kind mcp --config-file <JSON-file|->
  ${PRODUCT_CLI_NAME} extensions <enable|disable|update|remove> <skill|mcp> <extension-id> --project <id>

Options: --daemon-url <URL>, --json. PIXO_PROJECT_ID may replace --project.
Changes apply to this project only. Removal preserves game files and source packages.
`;

async function readConfig(file: string): Promise<unknown> {
  if (file !== '-') {
    const text = await readFile(file, 'utf8');
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('MCP config exceeds 1 MiB');
    return JSON.parse(text);
  }
  let text = '';
  for await (const chunk of process.stdin) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('MCP config exceeds 1 MiB');
  }
  return JSON.parse(text);
}

export async function runProjectExtensionsCli(args: string[]): Promise<void> {
  try {
    const { positionals, values } = parseArgs({
      args, allowPositionals: true,
      options: {
        project: { type: 'string' }, kind: { type: 'string' }, source: { type: 'string' },
        catalog: { type: 'string' }, 'config-file': { type: 'string' }, 'daemon-url': { type: 'string' },
        json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      },
    });
    const command = positionals[0] ?? 'list';
    if (values.help) { process.stdout.write(USAGE); return; }
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error('--project or PIXO_PROJECT_ID is required');
    const base = await resolveDaemonUrl(values['daemon-url'] ? { flagUrl: values['daemon-url'] } : {});
    const origin = new URL(base).origin;
    const endpoint = `${base.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(projectId)}/extensions`;
    let url = endpoint;
    let method = 'GET';
    let body: unknown;
    if (command === 'add') {
      if (values.kind !== 'skill' && values.kind !== 'mcp') throw new Error('--kind must be skill or mcp');
      const sources = [values.source, values.catalog, values['config-file']].filter(value => value !== undefined);
      if (sources.length !== 1) throw new Error('Select exactly one of --source, --catalog or --config-file');
      method = 'POST';
      body = {
        kind: values.kind,
        ...(values.source ? { source: values.source } : {}),
        ...(values.catalog ? { catalogId: values.catalog } : {}),
        ...(values['config-file'] ? { server: await readConfig(values['config-file']) } : {}),
      };
    } else if (['enable', 'disable', 'update', 'remove'].includes(command)) {
      const [, kind, id] = positionals;
      if ((kind !== 'skill' && kind !== 'mcp') || !id || positionals.length !== 3) {
        throw new Error('Supply <skill|mcp> <extension-id>');
      }
      url = `${endpoint}/${kind}/${encodeURIComponent(id)}`;
      method = command === 'remove' ? 'DELETE' : 'POST';
      if (command !== 'remove') body = { action: command };
    } else if (command !== 'list' || positionals.length > 1) throw new Error('Unknown extensions command');
    const token = process.env.PIXO_API_TOKEN?.trim();
    const response = await fetch(url, {
      method,
      headers: {
        Origin: origin, Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `Extension request failed (${response.status})`);
    process.stdout.write(`${JSON.stringify(result, null, values.json ? 2 : 0)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } })}\n`);
    process.exitCode = 1;
  }
}
