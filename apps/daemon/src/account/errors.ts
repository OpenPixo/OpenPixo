import type { OpenPixoAccountErrorCode, OpenPixoAccountErrorResponse, PublishErrorCode, PublishErrorResponse } from '@openpixo/contracts';

const ERRORS: Record<OpenPixoAccountErrorCode, { status: number; message: string }> = {
  ACCOUNT_NOT_CONFIGURED: { status: 503, message: 'OpenPixo cloud is not configured. Local features remain available.' },
  ACCOUNT_SECURE_STORAGE_UNAVAILABLE: { status: 503, message: 'OS-encrypted account storage is unavailable on this device.' },
  ACCOUNT_SIGNED_OUT: { status: 401, message: 'Sign in to your OpenPixo account first.' },
  ACCOUNT_EMAIL_INVALID: { status: 400, message: 'Enter a valid email address.' },
  ACCOUNT_OTP_INVALID: { status: 400, message: 'The email code is invalid or expired. Request a new code and try again.' },
  ACCOUNT_OTP_RATE_LIMITED: { status: 429, message: 'Please wait before requesting another email code.' },
  ACCOUNT_LOGIN_EXPIRED: { status: 410, message: 'This sign-in attempt has expired. Start sign-in again.' },
  ACCOUNT_LOGIN_FAILED: { status: 400, message: 'Sign-in could not be completed. Start sign-in again.' },
  CLOUD_UNAVAILABLE: { status: 503, message: 'OpenPixo cloud is temporarily unavailable. Please try again.' },
  BILLING_SKU_UNKNOWN: { status: 400, message: 'This product is unavailable. Refresh the catalog and try again.' },
  BILLING_PAUSED: { status: 503, message: 'New purchases are temporarily paused.' },
  BILLING_ALREADY_SUBSCRIBED: { status: 409, message: 'This account already has a plan. Change it with pixo credits change-plan, or cancel it in the billing portal.' },
  BILLING_NOT_SUBSCRIBED: { status: 409, message: 'This account has no plan to change. Buy one first.' },
  BILLING_PLAN_ENDING: { status: 409, message: 'This plan is set to end. Renew it in the billing portal before changing plan.' },
  BILLING_PLAN_PAST_DUE: { status: 409, message: 'The last payment for this plan failed. Update your payment method in the billing portal first.' },
  BILLING_PLAN_CHANGE_PENDING: { status: 409, message: 'Another plan change is waiting for payment. Finish or abandon it first.' },
  BILLING_PLAN_QUOTE_CHANGED: { status: 409, message: 'The price of this change is no longer current. Review it again.' },
  INSUFFICIENT_CREDITS: { status: 402, message: 'Not enough credits for this item.' },
  STORE_PURCHASE_UNAVAILABLE: { status: 503, message: 'Buying Workshop items with credits opens soon.' },
  STORE_ITEM_NOT_OWNED: { status: 402, message: 'Buy this pack before downloading it.' },
  GENERATION_PAUSED: { status: 503, message: 'Hosted generation is temporarily paused. Local and own-key providers still work.' },
  GENERATION_SERVICE_UNKNOWN: { status: 404, message: 'This hosted generation service is unavailable.' },
  GENERATION_PARAMS_INVALID: { status: 400, message: 'The prompt or options are not supported by this hosted service.' },
  GENERATION_QUOTE_INVALID: { status: 409, message: 'This price quote does not match the request or was already used. Get a new quote.' },
  GENERATION_QUOTE_EXPIRED: { status: 409, message: 'This price quote has expired. Get a new quote.' },
  GENERATION_IDEMPOTENCY_CONFLICT: { status: 409, message: 'This request id was already used for a different request.' },
  GENERATION_RATE_LIMITED: { status: 429, message: 'Too many hosted generations at once. Wait for running jobs to finish.' },
  GENERATION_JOB_NOT_FOUND: { status: 404, message: 'Hosted generation job not found.' },
  GENERATION_CONFIRMATION_REQUIRED: { status: 403, message: 'Hosted generation spends credits. Confirm the quote in OpenPixo, or run pixo media generate yourself.' },
  AGENT_PAUSED: { status: 503, message: 'The OpenPixo agent is temporarily paused. Your own API key or a local agent still works.' },
  AGENT_RATE_LIMITED: { status: 429, message: 'Too many OpenPixo agent requests at once. Wait a moment and retry.' },
  AGENT_REQUEST_INVALID: { status: 400, message: 'The OpenPixo agent model rejected this request.' },
  AGENT_UPSTREAM_FAILED: { status: 502, message: 'The OpenPixo agent model failed to answer. Retry in a moment.' },
};

const CLOUD_SERVICE_MESSAGE = 'OpenPixo cloud could not complete this request. Try again, and contact support if it keeps happening.';

/** Provider messages and exception causes must never cross the local API boundary. */
export class AccountError extends Error {
  readonly status: number;
  constructor(readonly code: OpenPixoAccountErrorCode, readonly retryAfterSec?: number, readonly reason?: 'service') {
    super(reason === 'service' ? CLOUD_SERVICE_MESSAGE : ERRORS[code].message);
    this.status = ERRORS[code].status;
  }
  response(): OpenPixoAccountErrorResponse {
    return { error: { code: this.code, message: this.message,
      ...(this.retryAfterSec === undefined ? {} : { retryAfterSec: this.retryAfterSec }),
      ...(this.reason === undefined ? {} : { reason: this.reason }) } };
  }
}

const PUBLISH_ERRORS: Record<PublishErrorCode, { status: number; message: string }> = {
  PUBLISH_PAUSED: { status: 503, message: 'Public links are not open yet.' },
  PUBLISH_REFUSED: { status: 422, message: 'This build cannot be published.' },
  PUBLISH_QUOTA: { status: 429, message: 'This account has reached its publishing limit. Try again tomorrow, or remove a game you no longer need.' },
  SHARE_TERMS_REQUIRED: { status: 409, message: 'Accept the sharing rules before your first publish.' },
  SHARE_NOT_FOUND: { status: 404, message: 'This public link no longer exists on this account.' },
  PUBLISH_PLAN_REQUIRED: { status: 402, message: 'Publishing a link needs a subscription. Links you already published stay online.' },
  PUBLISH_EXTRA_GAME_REQUIRED: { status: 402, message: "Your plan's public games are all in use. Publishing another one costs credits, charged once; updates stay free." },
};

/** The daemon's words for the extra-game offer when the cloud gave none, or the daemon refuses before asking it. */
export function extraGameRequiredMessage(credits: number | undefined): string {
  return credits === undefined ? PUBLISH_ERRORS.PUBLISH_EXTRA_GAME_REQUIRED.message
    : `Your plan's public games are all in use. Publishing this one costs ${credits} credits, charged once; updates stay free.`;
}

/** Refusals written by OpenPixo Cloud itself. Only the refusal, quota and extra-game reasons may keep the cloud's words. */
export class PublishCloudError extends Error {
  readonly status: number;
  constructor(readonly code: PublishErrorCode, cloudMessage?: unknown, readonly refusedFiles?: string[],
    /** The one-time price, with PUBLISH_EXTRA_GAME_REQUIRED. */
    readonly credits?: number) {
    const usable = (code === 'PUBLISH_REFUSED' || code === 'PUBLISH_QUOTA' || code === 'PUBLISH_EXTRA_GAME_REQUIRED') && typeof cloudMessage === 'string'
      && cloudMessage.trim() && cloudMessage.length <= 500 && !/[\x00-\x08\x0b-\x1f\x7f]/u.test(cloudMessage);
    super(usable ? (cloudMessage as string).trim()
      : code === 'PUBLISH_EXTRA_GAME_REQUIRED' ? extraGameRequiredMessage(credits) : PUBLISH_ERRORS[code].message);
    this.status = PUBLISH_ERRORS[code].status;
  }
  response(): PublishErrorResponse {
    return { error: { code: this.code, message: this.message, ...(this.refusedFiles?.length ? { refusedFiles: this.refusedFiles } : {}),
      ...(this.credits === undefined ? {} : { credits: this.credits }) } };
  }
}

/** The cloud answered, but with a failure or a reply that cannot be read. The same code keeps retries unchanged. */
export function cloudServiceError(): AccountError {
  return new AccountError('CLOUD_UNAVAILABLE', undefined, 'service');
}

export function accountError(error: unknown): AccountError {
  return error instanceof AccountError ? error : new AccountError('CLOUD_UNAVAILABLE');
}
