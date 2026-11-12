import type { GameRunStatus } from '@openpixo/contracts';
import type { Dict } from '../../i18n/types';

const RUN_REASONS: Record<NonNullable<GameRunStatus['reasonCode']>, keyof Dict> = {
  UNSUPPORTED_ENGINE: 'gameRun.reason.UNSUPPORTED_ENGINE', DEPENDENCIES_MISSING: 'gameRun.reason.DEPENDENCIES_MISSING',
  MISSING_TOOL: 'gameRun.reason.MISSING_TOOL', START_FAILED: 'gameRun.reason.START_FAILED',
  START_TIMEOUT: 'gameRun.reason.START_TIMEOUT', PROCESS_EXITED: 'gameRun.reason.PROCESS_EXITED',
  NODE_MISSING: 'gameRun.reason.NODE_MISSING', PACKAGE_MANAGER_MISSING: 'gameRun.reason.PACKAGE_MANAGER_MISSING', INSTALL_BUSY: 'gameRun.reason.INSTALL_BUSY',
};
const REASONS: Record<string, keyof Dict> = { ...RUN_REASONS,
  INSTALL_FAILED: 'gameRun.reason.INSTALL_FAILED', INSTALL_TIMEOUT: 'gameRun.reason.INSTALL_TIMEOUT', INSTALL_CANCELLED: 'gameRun.reason.INSTALL_CANCELLED',
  FORBIDDEN: 'gameRun.localSessionRequired', PROJECT_NOT_FOUND: 'gameRun.projectMissing',
};
const VERIFICATION_REASONS: Record<string, keyof Dict> = {
  SCREENSHOT_HOST_UNAVAILABLE: 'gameVerify.screenshotHostUnavailable',
  RUN_COMMAND_UNAVAILABLE: 'gameVerify.stepUnavailableHint',
  UNSUPPORTED_ENGINE: 'gameVerify.stepUnavailableHint',
};
const PLAYTEST_REASONS: Record<string, keyof Dict> = {
  UNSUPPORTED_ENGINE: 'gamePlaytest.unsupported', RUN_COMMAND_UNAVAILABLE: 'gamePlaytest.noRun',
  SCRIPT_UNSUPPORTED: 'gamePlaytest.scriptUnsupported', SCREENSHOT_HOST_UNAVAILABLE: 'gamePlaytest.hostUnavailable',
  CAPTURE_UNAVAILABLE: 'gamePlaytest.captureUnavailable', GODOT_CAPTURE_UNAVAILABLE: 'gamePlaytest.godotUnavailable',
};
export function gameRunErrorKey(code?: string, context: 'run' | 'verify' | 'playtest' = 'run'): keyof Dict {
  const specific = context === 'playtest' ? PLAYTEST_REASONS : context === 'verify' ? VERIFICATION_REASONS : {};
  if (code && Object.hasOwn(specific, code)) return specific[code]!;
  return code && Object.hasOwn(REASONS, code) ? REASONS[code]! : 'gameRun.unknownError';
}

export async function readGameResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(cause => {
    if (response.ok) throw cause;
    return null;
  });
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? `HTTP ${response.status}`), { code: body?.error?.details?.reasonCode ?? body?.error?.code });
  return body as T;
}

export function gameRequestError(caught: unknown): { code?: string; detail: string } {
  return { code: typeof (caught as { code?: unknown })?.code === 'string' ? (caught as { code: string }).code : undefined,
    detail: caught instanceof Error ? caught.message : String(caught) };
}
