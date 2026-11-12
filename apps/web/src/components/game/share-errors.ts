import { OPENPIXO_ACCOUNT_ERROR_CODES, type OpenPixoAccountErrorCode } from '@openpixo/contracts';

import type { Dict, Locale } from '../../i18n/types';
import { accountErrorCodeMessage, type Translate } from '../account/account-format';

/** What the daemon says went wrong with a publish or a rooms call. */
export interface ShareError {
  code?: string | null;
  message?: string | null;
}

const SHARE_ERROR_KEYS: Readonly<Record<string, keyof Dict>> = {
  PUBLISH_PAUSED: 'gameShare.error.paused',
  PUBLISH_REFUSED: 'gameShare.error.refused',
  PUBLISH_QUOTA: 'gameShare.error.quota',
  PUBLISH_PLAN_REQUIRED: 'gameShare.error.planRequired',
  PUBLISH_EXTRA_GAME_REQUIRED: 'gameShare.error.extraGameRequired',
  SHARE_TERMS_REQUIRED: 'gameShare.error.termsRequired',
  SHARE_NOT_FOUND: 'gameShare.error.notFound',
  NOT_FOUND: 'gameShare.error.noLink',
  VALIDATION_FAILED: 'gameShare.error.notPublishable',
  CONFLICT: 'gameShare.error.conflict',
  PUBLISH_NO_OUTPUT: 'gameShare.error.noOutput',
  PUBLISH_BUILD_FAILED: 'gameShare.error.buildFailed',
  PUBLISH_FAILED: 'gameShare.error.failed',
  PUBLISH_FILES_CHANGED: 'gameShare.error.filesChanged',
  PUBLISH_UPLOAD_FAILED: 'gameShare.error.uploadFailed',
  PUBLISH_UPLOAD_REJECTED: 'gameShare.error.uploadRejected',
};

const ACCOUNT_CODES: ReadonlySet<string> = new Set(OPENPIXO_ACCOUNT_ERROR_CODES);

/**
 * The words the Share dialog shows for a failure, or null when there are none.
 * The daemon and the cloud write English with the specifics in it (a size, a
 * file, which limit), so an English UI shows them as written. Any other UI shows
 * the translation for the code, and the raw words only for a code it has never
 * heard of. A failed build keeps its output after the translation: that is a log.
 */
export function shareErrorMessage(error: ShareError | null | undefined, t: Translate, locale: Locale): string | null {
  const raw = error?.message?.trim() || null;
  if (locale === 'en' && raw) return raw;
  const code = error?.code;
  if (!code) return raw;
  if (ACCOUNT_CODES.has(code)) return accountErrorCodeMessage(code as OpenPixoAccountErrorCode, t);
  const key = SHARE_ERROR_KEYS[code];
  if (!key) return raw;
  const log = code === 'PUBLISH_BUILD_FAILED' ? raw?.split('\n').slice(1).join('\n').trim() : '';
  return log ? `${t(key)}\n${log}` : t(key);
}
