import { MOTION_API_ERROR_CODES, type MotionApiErrorCode, type MotionErrorResponse } from '@openpixo/contracts';
import { AccountError } from '../account/errors.js';

const ERRORS: Record<MotionApiErrorCode, [status: number, message: string]> = {
  ACCOUNT_SIGNED_OUT: [401, 'Sign in to your OpenPixo account first.'],
  CLOUD_UNAVAILABLE: [503, 'OpenPixo cloud is temporarily unavailable. Please try again.'],
  INSUFFICIENT_CREDITS: [402, 'Not enough credits for this.'],
  MOTION_PAUSED: [503, 'Moving characters are temporarily paused.'],
  MOTION_REQUEST_INVALID: [400, 'This request is not valid.'],
  MOTION_REQUEST_CONFLICT: [409, 'This request id was already used for something else.'],
  MOTION_PICTURE_INVALID: [400, 'The picture must be a PNG, JPEG or WebP of at most 8 MB.'],
  MOTION_NOT_FOUND: [404, 'There is no such moving character or portrait.'],
  MOTION_PORTRAIT_LIMIT: [429, 'No portraits are left for today. Try again tomorrow.'],
  MOTION_PORTRAIT_NOT_READY: [409, 'The portrait is not ready yet.'],
  MOTION_PORTRAIT_USED: [409, 'This portrait was already used for a character. Paint a new one.'],
  MOTION_PORTRAIT_EXPIRED: [409, 'This portrait has expired. Paint a new one.'],
  MOTION_BUSY: [409, 'Something is still being made. Try again when it is done.'],
  MOTION_RATE_LIMITED: [429, 'Too many requests. Wait a little.'],
  MOTION_CONTENT_BLOCKED: [422, 'This may not be used. Describe it in other words. Nothing was charged.'],
  MOTION_PAINTING_FAILED: [502, 'It could not be painted well enough. Nothing was charged.'],
  MOTION_BUILD_FAILED: [502, 'The character could not be put together. Nothing was charged.'],
  MOTION_TIMED_OUT: [502, 'It took too long. Nothing was charged.'],
  MOTION_NOT_CONFIGURED: [503, 'Moving characters are not available in this build.'],
  MOTION_USER_ONLY: [403, 'Only the user can do this, on the Moving character page or in their own terminal.'],
  MOTION_DOWNLOAD_FAILED: [502, 'The file could not be downloaded. Check your connection and try again.'],
  MOTION_INSTALL_FAILED: [409, 'The character could not be put into this game.'],
};

const KNOWN: ReadonlySet<string> = new Set(MOTION_API_ERROR_CODES);
export const isMotionCode = (value: unknown): value is MotionApiErrorCode => typeof value === 'string' && KNOWN.has(value);

/** Only our own codes and words cross the local API: never the cloud's message. */
export class MotionError extends Error {
  readonly status: number;
  constructor(readonly code: MotionApiErrorCode, message?: string) {
    super(message ?? ERRORS[code][1]);
    this.status = ERRORS[code][0];
  }
  response(): MotionErrorResponse { return { error: { code: this.code, message: this.message } }; }
}

export function motionError(error: unknown): MotionError {
  if (error instanceof MotionError) return error;
  if (error instanceof AccountError) {
    if (error.code === 'ACCOUNT_NOT_CONFIGURED') return new MotionError('MOTION_NOT_CONFIGURED');
    if (error.code === 'ACCOUNT_SIGNED_OUT' || error.code === 'ACCOUNT_SECURE_STORAGE_UNAVAILABLE') return new MotionError('ACCOUNT_SIGNED_OUT', error.message);
    return new MotionError('CLOUD_UNAVAILABLE');
  }
  console.error('[motion] request failed:', error);
  return new MotionError('CLOUD_UNAVAILABLE', 'Something went wrong. Try again.');
}
