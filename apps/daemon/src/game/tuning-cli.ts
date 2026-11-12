import { parseArgs } from 'node:util';
import { PRODUCT_CLI_NAME, type GameTuningListResponse, type GameTuningParameter, type GameTuningSetResponse, type GameTuningValue } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

export const GAME_TUNING_USAGE = `${PRODUCT_CLI_NAME} game tuning list [--project <projectId>] [--json]
${PRODUCT_CLI_NAME} game tuning set <id> <value> [--project <projectId>] [--file-hash <sha256>] [--json]
Project defaults to PIXO_PROJECT_ID. Values are numbers, true/false, strings or #rrggbbaa colors.`;

/** Keep the existing game dispatcher (including other concurrent capabilities) intact. */
export async function runGameTuningDispatch(args: string[], fallback: (args: string[]) => Promise<void>): Promise<void> {
  if (args[0] === 'tuning') return runGameTuningCli(args.slice(1));
  await fallback(args);
  if (args.length === 0 || ['--help', '-h'].includes(args[0] ?? '')) console.log(GAME_TUNING_USAGE);
}

function valueFor(parameter: GameTuningParameter, raw: string): GameTuningValue {
  if (parameter.type === 'int' || parameter.type === 'float') {
    if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error('A finite numeric value is required');
    return Number(raw);
  }
  if (parameter.type === 'bool') {
    if (raw !== 'true' && raw !== 'false') throw new Error('Boolean values must be true or false');
    return raw === 'true';
  }
  if (raw.startsWith('"')) {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'string') throw new Error('A string value is required');
    return value;
  }
  return raw;
}

/** The CLI and UI share the HTTP boundary; this command never edits files directly. */
export async function runGameTuningCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') { console.log(GAME_TUNING_USAGE); return; }
    const action = args[0];
    if (action !== 'list' && action !== 'set') throw new Error(`Usage: ${GAME_TUNING_USAGE}`);
    // Extract set's value before parseArgs so negative jump velocities are positional values.
    const id = action === 'set' ? args[1] : undefined;
    const raw = action === 'set' ? args[2] : undefined;
    if (action === 'set' && (!id || id.startsWith('--') || raw === undefined || raw.startsWith('--'))) throw new Error(`Usage: ${GAME_TUNING_USAGE}`);
    const { values, positionals } = parseArgs({ args: args.slice(action === 'set' ? 3 : 1), allowPositionals: true, options: {
      project: { type: 'string' }, json: { type: 'boolean' }, 'daemon-url': { type: 'string' }, 'file-hash': { type: 'string' },
    } });
    json = values.json === true;
    if (positionals.length > (action === 'list' ? 1 : 0)) throw new Error(`Usage: ${GAME_TUNING_USAGE}`);
    const projectId = values.project ?? positionals[0] ?? process.env.PIXO_PROJECT_ID;
    if (!projectId) throw new Error('Project id required: use --project <id> or PIXO_PROJECT_ID');
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/$/, '');
    const url = `${base}/api/projects/${encodeURIComponent(projectId)}/game/tuning`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    async function request<T>(method: 'GET' | 'PATCH', body?: unknown): Promise<T> {
      const response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json() as T & { error?: { code?: string; message?: string } };
      if (!response.ok) throw Object.assign(new Error(result.error?.message ?? `Tuning request failed (${response.status})`), { code: result.error?.code });
      return result;
    }
    const list = await request<GameTuningListResponse>('GET');
    if (action === 'list') {
      if (json) process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
      else {
        for (const item of list.parameters) console.log(`${item.id}  ${item.group} / ${item.key} = ${JSON.stringify(item.value)}  (${item.filePath}:${item.line}${item.nodePath ? ` · ${item.nodePath}` : ''})`);
        if (!list.parameters.length) console.log('No tunables. Use Godot @export literals, or src/tuning.json / tuning.json.');
        for (const warning of list.warnings) console.error(`${warning.code}: ${warning.filePath}`);
      }
      return;
    }
    const parameter = list.parameters.find(item => item.id === id);
    if (!parameter) throw Object.assign(new Error('Tunable parameter not found; run tuning list first'), { code: 'TUNING_NOT_FOUND' });
    const result = await request<GameTuningSetResponse>('PATCH', { id, value: valueFor(parameter, raw!), fileHash: values['file-hash'] ?? parameter.fileHash });
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else console.log(`${result.parameter.key} = ${JSON.stringify(result.parameter.value)} (${result.parameter.filePath}:${result.parameter.line})`);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const code = (caught as { code?: string })?.code;
    if (json) process.stdout.write(`${JSON.stringify({ error: { ...(code ? { code } : {}), message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
