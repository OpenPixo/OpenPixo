import { parseArgs } from 'node:util';
import { PRODUCT_CLI_NAME, type ApiErrorResponse, type CloudSkillsResponse } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

const USAGE = `${PRODUCT_CLI_NAME} cloud-skills list [--json]
${PRODUCT_CLI_NAME} cloud-skills sync [--json]

Cloud skills are written and served by OpenPixo. Any signed-in account downloads them for free,
and the agent uses them only with OpenPixo's models. A local skill with the same name wins.
The list also shows the cloud tools those runs can call with \`${PRODUCT_CLI_NAME} tool\`.`;

export function formatCloudSkills(result: CloudSkillsResponse): string {
  const lines = result.skills.map((skill) => `${skill.name}\t${skill.title}${skill.active ? '' : '\t(a local skill with this name is used)'}`);
  if (!lines.length) lines.push(result.signedIn ? 'No cloud skills yet.' : 'Sign in to download cloud skills.');
  if (result.tools.length) lines.push('', 'Cloud tools:', ...result.tools.map((tool) => `${tool.id}\t${tool.description}`));
  lines.push('', result.syncedAt ? `Last sync: ${result.syncedAt}` : 'Not synced yet.');
  if (result.error) lines.push(`Last sync failed: ${result.error}`);
  return lines.join('\n');
}

export async function runCloudSkillsCli(args: string[]): Promise<void> {
  const json = args.includes('--json');
  try {
    if (!args.length || args.includes('--help') || args.includes('-h') || args[0] === 'help') { console.log(USAGE); return; }
    const command = args[0];
    if (command !== 'list' && command !== 'sync') throw new Error(USAGE);
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, 'daemon-url': { type: 'string' },
    } });
    if (positionals.length) throw new Error(USAGE);
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/u, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const response = await fetch(`${base}/api/cloud-skills${command === 'sync' ? '/sync' : ''}`, {
      method: command === 'sync' ? 'POST' : 'GET', headers });
    const result = await response.json().catch(() => ({})) as CloudSkillsResponse & ApiErrorResponse;
    if (!response.ok) throw new Error(result.error?.message ?? `Request failed (${response.status})`);
    console.log(json ? JSON.stringify(result, null, 2) : formatCloudSkills(result));
    if (command === 'sync' && result.error) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: { message } }));
    else console.error(message);
    process.exitCode = 1;
  }
}
