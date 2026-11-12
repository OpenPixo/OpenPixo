import type { TrackingRunTerminalTrigger } from '@openpixo/contracts/analytics';
import fs from 'node:fs';
import path from 'node:path';
import { cleanupRuntimeExtensionFiles } from './extension-injection.js';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

export const RESTART_ERROR_CODE = 'DAEMON_RESTARTED';
export const RESTART_ERROR_MESSAGE =
  'Run interrupted because the daemon restarted.';

/** Called before accepting new runs, including for terminal or unreadable snapshots. */
export function cleanupRuntimeExtensionsAfterDaemonRestart(runsLogDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsLogDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) cleanupRuntimeExtensionFiles(path.join(runsLogDir, entry.name, 'extensions'));
  }
}

export interface RestartRecoverableDurableRunState {
  error?: string | null;
  errorCode?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  status: string;
  terminalTrigger?: TrackingRunTerminalTrigger | null;
  terminalRecoveryReason?: 'daemon_restart' | 'analytics_incomplete';
  terminalAt?: number | null;
  updatedAt: number;
}

export function interruptDurableRunAfterDaemonRestart(
  state: RestartRecoverableDurableRunState,
  now = Date.now(),
): boolean {
  if (TERMINAL_STATUSES.has(state.status)) return false;
  state.status = 'failed';
  state.updatedAt = now;
  state.terminalAt = now;
  state.exitCode = 1;
  state.signal = null;
  state.error = RESTART_ERROR_MESSAGE;
  state.errorCode = RESTART_ERROR_CODE;
  state.terminalTrigger = 'daemon_restart';
  state.terminalRecoveryReason = 'daemon_restart';
  return true;
}
