import { CHARACTER_ERROR_CODES, type CharacterErrorCode, type CharacterErrorResponse } from '@openpixo/contracts';
import { AccountError } from '../account/errors.js';

const ERRORS: Record<CharacterErrorCode, [status: number, message: string]> = {
  ACCOUNT_SIGNED_OUT: [401, 'Sign in to your OpenPixo account first.'],
  CLOUD_UNAVAILABLE: [503, 'OpenPixo cloud is temporarily unavailable. Please try again.'],
  INSUFFICIENT_CREDITS: [402, 'Not enough credits for this.'],
  CHARACTER_PAUSED: [503, 'Characters are temporarily paused.'],
  CHARACTER_REQUEST_INVALID: [400, 'This request is not valid.'],
  CHARACTER_REQUEST_CONFLICT: [409, 'This request id was already used for something else.'],
  CHARACTER_BRIEF_INVALID: [409, 'This price was already used or does not exist. Ask for a new one.'],
  CHARACTER_BRIEF_EXPIRED: [409, 'This price has expired. Ask for a new one.'],
  CHARACTER_TEXT_REFUSED: [422, 'This could not be turned into an original character. Describe it in other words.'],
  CHARACTER_NOT_FOUND: [404, 'There is no such character.'],
  CHARACTER_BUSY: [409, 'This character is being worked on. Try again when it is done.'],
  CHARACTER_FULL: [409, 'This character cannot hold more of this. Take something off it first.'],
  CHARACTER_UNCHANGED: [409, 'The newest package already holds every change.'],
  CHARACTER_NOT_FITTED: [409, 'This armour has to be drawn for this character first.'],
  CHARACTER_FITS: [409, 'This armour already fits this character.'],
  CHARACTER_RATE_LIMITED: [429, 'Too many requests. Wait a little.'],
  CHARACTER_DRAWING_FAILED: [502, 'It could not be drawn well enough. Nothing was charged.'],
  CHARACTER_CONTENT_BLOCKED: [502, 'What was drawn may not be used. Nothing was charged.'],
  CHARACTER_MOTION_FAILED: [502, 'The motion did not work out. Nothing was charged.'],
  CHARACTER_TIMED_OUT: [502, 'It took too long. Nothing was charged.'],
  CHARACTER_PACKING_FAILED: [502, 'The package could not be made. Nothing was charged.'],
  CHARACTER_NOT_CONFIGURED: [503, 'Characters are not available in this build.'],
  CHARACTER_USER_ONLY: [403, 'Only the user can do this, on the Characters page or in their own terminal.'],
  CHARACTER_DOWNLOAD_FAILED: [502, 'The character could not be downloaded. Check your connection and try again.'],
  CHARACTER_INSTALL_FAILED: [409, 'The character could not be put into this game.'],
  CHARACTER_PLAYER_EDITED: [409, 'The player script was changed by hand, so it was left alone.'],
};

const KNOWN: ReadonlySet<string> = new Set(CHARACTER_ERROR_CODES);
export const isCharacterCode = (value: unknown): value is CharacterErrorCode => typeof value === 'string' && KNOWN.has(value);

/** Only our own codes and words cross the local API: never the cloud's message. */
export class CharacterError extends Error {
  readonly status: number;
  constructor(readonly code: CharacterErrorCode, message?: string) {
    super(message ?? ERRORS[code][1]);
    this.status = ERRORS[code][0];
  }
  response(): CharacterErrorResponse { return { error: { code: this.code, message: this.message } }; }
}

export function characterError(error: unknown): CharacterError {
  if (error instanceof CharacterError) return error;
  if (error instanceof AccountError) {
    if (error.code === 'ACCOUNT_NOT_CONFIGURED') return new CharacterError('CHARACTER_NOT_CONFIGURED');
    if (error.code === 'ACCOUNT_SIGNED_OUT' || error.code === 'ACCOUNT_SECURE_STORAGE_UNAVAILABLE') return new CharacterError('ACCOUNT_SIGNED_OUT', error.message);
    return new CharacterError('CLOUD_UNAVAILABLE');
  }
  console.error('[characters] request failed:', error);
  return new CharacterError('CLOUD_UNAVAILABLE', 'Something went wrong. Try again.');
}
