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

const REPEAT_WINDOW_MS = 10 * 60_000;
const lastLogged = new Map<string, { at: number; repeats: number }>();

/**
 * Logs a checkpoint failure once per project and reason, then at most once every ten minutes with
 * how often it happened since. A checkpoint that cannot work on a game fails the same way on every
 * run and on every Changes-view read; the run goes on either way (checkpoints are observers), and
 * the log should say why once instead of burying everything else.
 */
export function warnCheckpointFailureOnce(
  warn: (message: string, detail: unknown) => void,
  scope: string,
  message: string,
  detail: Record<string, unknown>,
  error: unknown,
  now = Date.now(),
): void {
  const failure = checkpointFailureForLog(error);
  const key = `${scope}\0${message}\0${failureReason(failure)}`;
  const previous = lastLogged.get(key);
  if (previous && now - previous.at < REPEAT_WINDOW_MS) { previous.repeats += 1; return; }
  lastLogged.set(key, { at: now, repeats: 0 });
  warn(message, { ...detail, error: failure, ...(previous?.repeats ? { repeatedSinceLastLog: previous.repeats } : {}) });
}

/** Same reason: same exit code or signal and the same first error line, numbers aside (temp file names). */
function failureReason(failure: unknown): string {
  if (!failure || typeof failure !== 'object') return String(failure);
  const { message, stderr, code, killed, signal } = failure as { message?: unknown; stderr?: unknown; code?: unknown; killed?: unknown; signal?: unknown };
  const firstError = typeof stderr === 'string' ? stderr.split('\n').find(line => /^(error|fatal):/u.test(line)) ?? '' : '';
  const ownMessage = typeof message === 'string' && !message.startsWith('Command failed:') ? message : '';
  return [code, signal, killed, firstError.replace(/\d+/gu, '#'), ownMessage].map(String).join('|');
}
