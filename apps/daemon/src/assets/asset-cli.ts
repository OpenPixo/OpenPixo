import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import type { AssetListResponse, AssetProvenanceResponse, ProjectAsset } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';
import { ASSET_OP_COMMANDS, runAssetOpCli } from './ops/asset-ops-cli.js';
import { runImageEditCli } from './image-edit-cli.js';

const USAGE = `${PRODUCT_CLI_NAME} asset list [--project <id>] [--kind <kind>] [--tag <tag>] [--origin generated|processed|imported] [--semantic <type>] [--query <text>] [--cursor <cursor>] [--limit <n>] [--json]
${PRODUCT_CLI_NAME} asset info <rel-path> [--project <id>] [--json]
${PRODUCT_CLI_NAME} asset tag <rel-path...> --add <tag> | --remove <tag> [--project <id>] [--json]
${PRODUCT_CLI_NAME} asset provenance <rel-path> [--project <id>] [--json]
${PRODUCT_CLI_NAME} asset edit <projectId> <path> [--crop x,y,w,h] [--resize WxH|N%] [--nearest] [--trim] [--pad WxH|pot] [--flip h|v] [--rotate 90] [--out <name>] [--json]

list shows media assets and sprite/tilemap data by default. Pass --kind all to include project files.`;

export async function runAssetCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    const command = args[0];
    if (command === 'edit') { await runImageEditCli(args.slice(1)); return; }
    if (command && ASSET_OP_COMMANDS.has(command)) { await runAssetOpCli(args); return; }
    if (!command || command === '--help' || command === '-h' || args.includes('--help')) { console.log(USAGE); return; }
    if (!['list', 'info', 'tag', 'provenance'].includes(command)) throw new Error(`Usage: ${USAGE}`);
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      project: { type: 'string' }, kind: { type: 'string' }, tag: { type: 'string' }, origin: { type: 'string' },
      semantic: { type: 'string' }, query: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'string' },
      add: { type: 'string', multiple: true }, remove: { type: 'string', multiple: true }, json: { type: 'boolean' },
      'daemon-url': { type: 'string' }, workspace: { type: 'string' }, 'workspace-member': { type: 'string' },
    } });
    json = values.json === true;
    const projectId = values.project ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error('Pass --project <id> or set PIXO_PROJECT_ID');
    if (command === 'list' && positionals.length) throw new Error('asset list does not take paths');
    if (['info', 'provenance'].includes(command) && positionals.length !== 1) throw new Error(`${command} requires one asset path`);
    if (command === 'tag' && (!positionals.length || !(values.add?.length || values.remove?.length))) throw new Error('tag requires paths and --add or --remove');
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const query = new URLSearchParams();
    if (command === 'list') {
      for (const key of ['kind', 'tag', 'origin', 'semantic', 'query', 'cursor', 'limit'] as const) if (values[key] !== undefined) query.set(key, values[key]);
    } else if (command !== 'tag') query.set('path', positionals[0]!);
    const suffix = command === 'list' ? '' : command === 'tag' ? '/tags' : `/${command}`;
    const response = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/assets${suffix}?${query}`, {
      headers, method: command === 'tag' ? 'POST' : 'GET',
      ...(command === 'tag' ? { body: JSON.stringify({ paths: positionals, ...(values.add ? { add: values.add } : {}), ...(values.remove ? { remove: values.remove } : {}) }) } : {}),
    });
    const data = await response.json() as (AssetListResponse | ProjectAsset | AssetProvenanceResponse) & { error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message ?? `Asset request failed (${response.status})`);
    if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    else if ('assets' in data) {
      for (const asset of data.assets) console.log(`${asset.relPath}\t${asset.kind}\t${asset.size}\t${asset.origin}\t${asset.tags.join(', ')}`);
      if (data.nextCursor) console.log(`Next cursor: ${data.nextCursor}`);
    } else if ('provenance' in data) {
      for (const record of data.provenance) console.log(`${record.origin}\t${record.model ?? ''}\t${record.runId ?? ''}\t${record.promptText ?? ''}${record.modifiedSinceProvenance ? '\t(modified since provenance)' : ''}`);
      if (!data.provenance.length) console.log('No provenance recorded');
    } else console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
