import type { GameCreationReasonCode } from '@openpixo/contracts';
import type { Dict } from '../i18n/types';

const REASONS: Record<GameCreationReasonCode, keyof Dict> = {
  INVALID_REQUEST: 'game.createFailed', INVALID_NAME: 'game.dialog.invalidName',
  PARENT_NOT_ABSOLUTE: 'game.dialog.locationRelative', PARENT_NOT_FOUND: 'game.dialog.locationNotFound',
  PARENT_NOT_DIRECTORY: 'game.dialog.parentNotDirectory', PARENT_UNREADABLE: 'game.dialog.parentUnreadable',
  TARGET_EXISTS: 'game.dialog.nameExists', TEMPLATE_NOT_FOUND: 'game.dialog.templateMissing',
  TARGET_REJECTED: 'game.dialog.targetRejected', PICKER_REQUIRED: 'game.dialog.locationPicker', CREATE_FAILED: 'game.createFailed',
};

export function gameCreationErrorKey(code?: string): keyof Dict | null {
  if (code === 'FORBIDDEN') return 'game.dialog.locationPicker';
  if (code === 'DESKTOP_AUTH_PENDING') return 'game.dialog.authorizationPending';
  return code && Object.hasOwn(REASONS, code) ? REASONS[code as GameCreationReasonCode] : null;
}

const SAVED_PARENT = 'pixo:new-game-parent';
export function rememberedGameParent(): string {
  try { return localStorage.getItem(SAVED_PARENT) ?? ''; } catch { return ''; }
}
export function rememberGameParent(value: string): void {
  try { localStorage.setItem(SAVED_PARENT, value); } catch { /* Saving a game works without browser storage. */ }
}
