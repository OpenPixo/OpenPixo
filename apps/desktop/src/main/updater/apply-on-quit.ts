import { DESKTOP_UPDATE_STATES } from "@openpixo/sidecar-proto";

import type { DesktopUpdater, DesktopUpdaterLogger } from "../updater.js";

const DEFAULT_APPLY_ON_QUIT_TIMEOUT_MS = 3000;

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

/**
 * A downloaded update the user never restarted for takes effect the next time
 * they open the app. Doing this as they quit means that launch opens the new
 * version directly, instead of opening the old one and restarting moments later.
 *
 * Quitting must stay fast and must never fail because of this, so every problem
 * is logged and skipped: the update stays downloaded and the startup path, or the
 * restart prompt, still delivers it. An explicit opt-out is honoured, so an
 * unreadable preference counts as "not now" rather than as consent.
 */
export async function applyDownloadedUpdateOnQuit(input: {
  logger?: DesktopUpdaterLogger;
  readAllowSilentUpdates: () => Promise<boolean | undefined>;
  timeoutMs?: number;
  updater: Pick<DesktopUpdater, "applyOnNextLaunch" | "snapshot">;
}): Promise<boolean> {
  const logger = input.logger ?? console;
  const timeoutMs = input.timeoutMs ?? DEFAULT_APPLY_ON_QUIT_TIMEOUT_MS;
  try {
    const status = input.updater.snapshot();
    if (status.state !== DESKTOP_UPDATE_STATES.DOWNLOADED || status.installResult != null) return false;
    if (status.artifact?.type !== "payload" || input.updater.applyOnNextLaunch == null) return false;
    const allowed = await withTimeout(input.readAllowSilentUpdates(), timeoutMs);
    if (allowed === false) return false;
    return await withTimeout(input.updater.applyOnNextLaunch(), timeoutMs);
  } catch (error) {
    logger.warn("[openpixo updater] could not apply the downloaded update while quitting", error);
    return false;
  }
}
