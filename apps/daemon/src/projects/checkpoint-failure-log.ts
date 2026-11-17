/**
 * What a failed checkpoint operation logs: Git's errors, not its line-ending warnings.
 *
 * `git add` prints one `warning: in the working copy of '…', LF will be replaced by CRLF` line per
 * file before the real error. On a game with thousands of assets one failure logged ~480 KB and
 * buried the cause. A Git process the daemon stopped (its timeout) prints nothing, so `killed` and
 * `signal` say so. Non-Git errors keep their message and code.
 */
export function checkpointFailureForLog(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const stderr = (error as { stderr?: unknown }).stderr;
  const lines = typeof stderr === 'string'
    ? stderr.split(/\r?\n/u).filter(line => line.trim() && !/^warning: in the working copy of /u.test(line))
    : [];
  const { code, killed, signal } = error as { code?: unknown; killed?: unknown; signal?: unknown };
  return { message: error.message.split('\n')[0]?.slice(0, 300), stderr: lines.slice(-20).join('\n'), code, killed, signal };
}
