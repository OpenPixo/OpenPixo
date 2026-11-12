import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { CAPABILITY_CELLS, type AgentCapabilitiesResponse } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

const USAGE = `Usage: ${PRODUCT_CLI_NAME} agent capabilities [--agent <id>] [--json] [--daemon-url <url>]\n`;

export async function runAgentCapabilitiesCli(args: string[]): Promise<void> {
  try {
    const { values } = parseArgs({
      args,
      options: {
        agent: { type: 'string' }, json: { type: 'boolean' },
        'daemon-url': { type: 'string' }, help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) { process.stdout.write(USAGE); return; }
    const base = (await resolveDaemonUrl(values['daemon-url'] ? { flagUrl: values['daemon-url'] } : {})).replace(/\/+$/, '');
    const token = process.env.PIXO_API_TOKEN?.trim();
    const response = await fetch(`${base}/api/agents/capabilities`, {
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Capability request failed (${response.status})`);
    const result = await response.json() as AgentCapabilitiesResponse;
    if (values.agent !== undefined) {
      if (!Object.hasOwn(result.matrix, values.agent)) throw new Error(`Unknown agent: ${values.agent}`);
      result.matrix = { [values.agent]: result.matrix[values.agent]! };
      result.runtimes = { [values.agent]: result.runtimes[values.agent] ?? {} };
    }
    if (values.json) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return; }
    const runtimes = Object.entries(result.matrix);
    const rows = [
      ['Capability', ...runtimes.map(([id]) => `${id}${result.runtimes[id]?.installedVersion ? ` (${result.runtimes[id]?.installedVersion})` : ''}`)],
      ...CAPABILITY_CELLS.map(cell => [cell, ...runtimes.map(([, cells]) => cells[cell].state)]),
    ];
    const widths = rows[0]!.map((_, index) => Math.max(...rows.map(row => row[index]!.length)));
    process.stdout.write(`${rows.map(row => row.map((value, index) => value.padEnd(widths[index]!)).join('  ').trimEnd()).join('\n')}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } })}\n`);
    process.exitCode = 1;
  }
}
