/**
 * How long a folder pick waits for the daemon to accept the desktop's auth
 * secret.
 *
 * Every pick re-registers the secret before it mints a token (a restarted daemon
 * has forgotten it). The daemon answers that IPC on its main thread, and while an
 * agent run keeps it busy one answer took 354 ms and another 782 ms (prod-dev,
 * 2026-11-16) where an idle daemon answers in 1 ms. A single 800 ms try made every
 * pick fail with "desktop auth handshake with the daemon failed" until the desktop
 * was restarted at a quiet moment. A pick is something the user just did and can
 * wait a few seconds for; startup keeps its one quick try.
 */
export const PICK_DESKTOP_AUTH_TIMEOUTS_MS = [1_500, 4_000, 8_000] as const;

/** One registration attempt with its own IPC timeout; true when the daemon accepted it. */
export type RegisterDesktopAuthAttempt = (timeoutMs: number) => Promise<boolean>;

/** Try each timeout in turn and stop at the first accepted registration. */
export async function registerDesktopAuthPatiently(
  attempt: RegisterDesktopAuthAttempt,
  timeoutsMs: readonly number[] = PICK_DESKTOP_AUTH_TIMEOUTS_MS,
): Promise<boolean> {
  for (const timeoutMs of timeoutsMs) {
    if (await attempt(timeoutMs)) return true;
  }
  return false;
}
