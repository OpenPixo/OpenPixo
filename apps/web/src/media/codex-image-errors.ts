import type { CodexImageReasonCode } from '@openpixo/contracts';
import type { Dict } from '../i18n/types';
const reasonKeys = {
  CODEX_CLI_NOT_FOUND: 'settings.codexImageMissing',
  CODEX_CLI_AUTH_REQUIRED: 'settings.codexImageSignIn',
  CODEX_CLI_AUTH_UNKNOWN: 'settings.codexImageUnknown',
  CODEX_IMAGE_RATE_LIMITED: 'settings.codexImageRateLimited',
  CODEX_IMAGE_QUOTA_EXCEEDED: 'settings.codexImageQuota',
  CODEX_IMAGE_NO_OUTPUT: 'settings.codexImageNoOutput',
  CODEX_IMAGE_TIMEOUT: 'settings.codexImageTimeout',
  CODEX_IMAGE_CANCELLED: 'settings.codexImageCancelled',
  CODEX_IMAGE_FAILED: 'settings.codexImageFailed',
} satisfies Record<CodexImageReasonCode, keyof Dict>;
/** Never display a Codex diagnostic sentence as translated UI copy. */
export function codexImageReasonKey(code: unknown): keyof Dict {
  return typeof code === 'string' && Object.hasOwn(reasonKeys, code)
    ? reasonKeys[code as CodexImageReasonCode] : 'settings.codexImageUnknown';
}
