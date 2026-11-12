import { parseArgs } from 'node:util';
import {
  PRODUCT_CLI_NAME,
  SETTINGS_EXECUTION_PATH,
  SETTINGS_GAME_ENGINES_PATH,
  SETTINGS_MEDIA_PROVIDERS_PATH,
} from '@openpixo/contracts';
import type { DoctorCheck, DoctorResponse } from '@openpixo/contracts';
import { resolveDaemonUrl } from './daemon-url.js';

const USAGE = `Usage: ${PRODUCT_CLI_NAME} doctor [--json] [--daemon-url <url>]

Check local agents, game engines, media tools, and generation settings.
Exit code is 1 when any check is missing or reports an error.
`;

const GROUP_LABELS: Record<DoctorCheck['group'], string> = {
  agents: 'Agents',
  engines: 'Game engines',
  'media-tools': 'Media tools',
  providers: 'Providers',
};

const TITLE_LABELS: Record<DoctorCheck['title']['code'], string> = {
  agent: 'Agent',
  godot: 'Godot',
  node: 'Node.js',
  npm: 'npm',
  ffmpeg: 'FFmpeg',
  'image-provider': 'Image generation',
  'audio-provider': 'Audio generation',
};

const DETAIL_LABELS: Record<DoctorCheck['detail']['code'], string> = {
  available: 'Available',
  'not-found': 'Not found',
  'signed-in': 'Signed in',
  'sign-in-required': 'Sign in required',
  'auth-unknown': 'Sign-in status unknown',
  configured: 'Configured',
  'not-configured': 'Not configured',
  'probe-failed': 'Check failed',
  'probe-timeout': 'Check timed out',
  'invalid-path': 'Custom path unavailable',
};

const SETTINGS_PATHS = {
  execution: SETTINGS_EXECUTION_PATH,
  gameEngines: SETTINGS_GAME_ENGINES_PATH,
  media: SETTINGS_MEDIA_PROVIDERS_PATH,
};

function fixHint(check: DoctorCheck): string {
  if (check.status === 'ok') return '—';
  let hint: string;
  switch (check.fix.kind) {
    case 'install-url': hint = `Install: ${check.fix.value}`; break;
    case 'command': hint = `Run: ${check.fix.value}`; break;
    case 'settings': hint = `Open ${SETTINGS_PATHS[check.fix.value]}`; break;
  }
  return check.title.code === 'ffmpeg'
    ? `${hint}; restore bundled FFmpeg or set HYPERFRAMES_FFMPEG_PATH`
    : hint;
}

function detailText(check: DoctorCheck): string {
  const parts = [DETAIL_LABELS[check.detail.code]];
  const params = check.detail.params;
  if (params?.version) parts.push(params.version);
  if (params?.source) {
    parts.push({ configured: 'custom path', path: 'PATH', bundled: 'bundled' }[params.source]);
  }
  return parts.join(' · ');
}

/** Keep every check and its repair hint together in terminal output. */
export function formatDoctorReport(result: DoctorResponse): string {
  const headers = ['', 'Group', 'Check', 'Detail', 'Fix'];
  const rows = result.checks.map((check) => [
    { ok: '✓', warn: '!', missing: '✗', error: '✗' }[check.status],
    GROUP_LABELS[check.group],
    check.title.params?.name ?? TITLE_LABELS[check.title.code],
    detailText(check),
    fixHint(check),
  ].map((value) => value.replace(/[\r\n\t]/gu, ' ')));
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]!.length)));
  const line = (cells: string[]) => cells.map((cell, index) => index === cells.length - 1
    ? cell : cell.padEnd(widths[index]!)).join('  ');
  return ['Environment check', line(headers), ...rows.map(line)].join('\n');
}

/** The doctor command is a read-only client of the same report shown in Settings. */
export async function runDoctorCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    const { values } = parseArgs({ args, options: {
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      'daemon-url': { type: 'string' },
    } });
    json = values.json === true;
    if (values.help) {
      process.stdout.write(USAGE);
      return;
    }
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/+$/u, '');
    const headers: Record<string, string> = { Accept: 'application/json', Origin: new URL(base).origin };
    if (process.env.PIXO_TOOL_TOKEN) headers.Authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
    const response = await fetch(`${base}/api/doctor`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as DoctorResponse & { error?: string | { message?: string } };
    if (!response.ok) {
      const message = typeof result.error === 'string' ? result.error : result.error?.message;
      throw new Error(message ?? `Environment check failed (${response.status})`);
    }
    const failed = result.checks.some((check) => check.status === 'missing' || check.status === 'error');
    process.stdout.write(`${json ? JSON.stringify(result, null, 2) : formatDoctorReport(result)}\n`);
    if (failed) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ error: { message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
