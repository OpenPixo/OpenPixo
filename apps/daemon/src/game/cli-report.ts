import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * `--report <file>` on `pixo game verify` and `pixo game playtest`: the command saves the
 * JSON it would print with `--json`, so an agent keeps the report without wrapping the
 * command in a pipe, a redirect or a variable. Each wrapper is a new shape to approve, and
 * Codex asked the user about every one (C20, 2026-11-21).
 *
 * The path is relative to the current folder, like every other path the CLI takes. The
 * file is written by this process, inside the caller's own sandbox.
 */
export function gameReportPathFromArgs(args: string[]): string | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.startsWith('--report=')) return arg.slice('--report='.length) || null;
    if (arg === '--report') return args[index + 1] && !args[index + 1]!.startsWith('--') ? args[index + 1]! : null;
  }
  return null;
}

async function writeReport(file: string, value: unknown): Promise<string> {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

/**
 * Saves the report and returns its absolute path. A file that cannot be written is
 * said on stderr and loses nothing else: the result is still printed and keeps its exit code.
 */
export async function writeGameReport(file: string | undefined, value: unknown): Promise<string | null> {
  if (!file) return null;
  try { return await writeReport(file, value); } catch (error) {
    process.stderr.write(`Could not save the report to ${file}: ${error instanceof Error ? error.message : String(error)}\n`);
    return null;
  }
}

/** A failure is saved too, so the agent reading the file learns why nothing ran. */
export async function writeGameErrorReport(file: string | null, error: { message: string; code?: string }): Promise<void> {
  if (!file) return;
  try { await writeReport(file, { error }); } catch { /* the error itself is still printed */ }
}
