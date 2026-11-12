import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PRODUCT_CLI_NAME } from '@openpixo/contracts';
import type { CheckpointDiffTarget, ProjectCheckpointFileDiff } from '@openpixo/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

const USAGE = `Usage:
  ${PRODUCT_CLI_NAME} project checkpoint list <projectId> [--json]
  ${PRODUCT_CLI_NAME} project checkpoint show <projectId> <checkpointId> [--json]
  ${PRODUCT_CLI_NAME} project checkpoint diff <projectId> <checkpointId> [--path <rel>] [--json]
  ${PRODUCT_CLI_NAME} project checkpoint file <projectId> <checkpointId> --path <rel> --side before|after --out <file|->
  ${PRODUCT_CLI_NAME} project checkpoint restore <projectId> <checkpointId> --yes [--json]
  ${PRODUCT_CLI_NAME} project checkpoint enable <projectId> --yes [--json]

Options: --project <projectId> (instead of the positional project), --daemon-url <url>
Diff shows the run's own change: the project when the run started against the run's end
(or the current files while the run is still going). File writes one side of a changed file.
Restore saves another checkpoint first. Enable creates a local Git repository and initial commit.
`;

const ACTIONS = ['list', 'show', 'diff', 'file', 'restore', 'enable'] as const;
type Action = typeof ACTIONS[number];

interface CliError { code?: string; message?: string }

/** A thin client of exactly the same checkpoint endpoints as the web UI. */
export async function runProjectCheckpointCli(args: string[]): Promise<void> {
  let json = args.includes('--json');
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      json: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' }, project: { type: 'string' }, 'daemon-url': { type: 'string' },
      path: { type: 'string' }, side: { type: 'string' }, out: { type: 'string' },
    } });
    json = values.json === true;
    if (values.help || !positionals.length) { process.stdout.write(USAGE); return; }
    const [rawAction, ...targets] = positionals;
    const action = rawAction as Action;
    const projectId = values.project ?? targets.shift();
    const checkpointId = targets.shift();
    const needsCheckpoint = action === 'show' || action === 'restore' || action === 'diff' || action === 'file';
    if (!ACTIONS.includes(action) || !projectId?.trim()
      || (needsCheckpoint ? !checkpointId : Boolean(checkpointId)) || targets.length) throw new Error(USAGE.trim());
    if (values.path !== undefined && action !== 'diff' && action !== 'file') throw new Error(USAGE.trim());
    if (action === 'file' && (!values.path || (values.side !== 'before' && values.side !== 'after') || !values.out)) {
      throw Object.assign(new Error('file needs --path <rel>, --side before|after and --out <file|->'), { code: 'CHECKPOINT_PATH_INVALID' });
    }
    const writes = action === 'restore' || action === 'enable';
    if (writes && !values.yes) throw Object.assign(new Error('Review the checkpoint with show, then confirm with --yes. Enabling protection also requires --yes.'), { code: 'CHECKPOINT_CONFIRM_REQUIRED' });
    const base = (await resolveDaemonUrl({ flagUrl: values['daemon-url'] ?? null })).replace(/\/+$/u, '');
    const query = new URLSearchParams();
    if (values.path !== undefined) query.set('path', values.path);
    if (action === 'file') query.set('side', values.side!);
    const suffix = needsCheckpoint
      ? `/${encodeURIComponent(checkpointId!)}${action === 'show' ? '' : `/${action}`}`
      : action === 'enable' ? '/enable' : '';
    const endpoint = `${base}/api/projects/${encodeURIComponent(projectId)}/checkpoints${suffix}${query.toString() ? `?${query.toString()}` : ''}`;
    const response = await fetch(endpoint, {
      method: writes ? 'POST' : 'GET', headers: { Accept: action === 'file' ? '*/*' : 'application/json', Origin: new URL(base).origin,
        ...(process.env.PIXO_TOOL_TOKEN ? { authorization: `Bearer ${process.env.PIXO_TOOL_TOKEN}` } : {}),
        ...(writes ? { 'Content-Type': 'application/json' } : {}) },
      ...(writes ? { body: JSON.stringify({ confirmed: true }) } : {}), signal: AbortSignal.timeout(60_000),
    });
    if (action === 'file' && response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (values.out === '-') process.stdout.write(bytes);
      else {
        await writeFile(values.out!, bytes);
        process.stderr.write(`Wrote ${bytes.length} bytes to ${values.out}\n`);
      }
      return;
    }
    const result = await response.json() as Record<string, unknown> & { error?: string | CliError };
    if (!response.ok) {
      const failure = typeof result.error === 'string' ? { message: result.error } : result.error;
      throw Object.assign(new Error(failure?.message ?? `Checkpoint request failed (${response.status})`), { code: failure?.code });
    }
    // JSON mode is stable machine output; the readable form retains file paths and metadata.
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (result.status === 'unavailable') process.stdout.write(`Version protection unavailable: ${String(result.reason)}\n`);
    else if (action === 'diff') process.stdout.write(formatCheckpointDiff(result));
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const failure = error as Error & CliError;
    if (json) process.stdout.write(`${JSON.stringify({ error: { code: failure.code ?? 'CHECKPOINT_FAILED', message: failure.message ?? String(error) } })}\n`);
    else process.stderr.write(`${failure.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}

/** Unified-diff text for one file or every file of a checkpoint diff response. */
export function formatCheckpointDiff(result: Record<string, unknown>): string {
  const target = result.target as CheckpointDiffTarget;
  const files = Array.isArray(result.files) ? result.files as ProjectCheckpointFileDiff[] : [result as unknown as ProjectCheckpointFileDiff];
  const out: string[] = [target === 'run_end'
    ? '# Compared with the project as the run left it'
    : '# Compared with the current files (the run has not recorded its end state)'];
  if (files.length === 0) out.push('# No files changed');
  for (const file of files) {
    out.push(`diff --git a/${file.path} b/${file.path}`);
    if (file.status === 'added') out.push('new file');
    if (file.status === 'deleted') out.push('deleted file');
    out.push(`--- ${file.status === 'added' ? '/dev/null' : `a/${file.path}`}`, `+++ ${file.status === 'deleted' ? '/dev/null' : `b/${file.path}`}`);
    if (file.binary) out.push('Binary file changed');
    for (const hunk of file.hunks) {
      out.push(hunk.header);
      for (const line of hunk.lines) out.push(`${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`);
    }
    if (file.truncated) out.push('# (diff cut at the size cap)');
  }
  if (result.truncated === true) out.push('# (more files changed than one response lists)');
  return `${out.join('\n')}\n`;
}
